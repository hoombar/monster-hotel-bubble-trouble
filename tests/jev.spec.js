import { test, expect } from "@playwright/test";
import { askJev, connectRemote, observe, play } from "../scripts/play-jev.mjs";
import { createServer } from "vite";
import { buildDecisionContext } from "../src/jev-decision.js";

const state = {
  running: true, paused: false, score: 0,
  player: { x: 500, y: 600, facing: { x: 0, y: -1 }, carried: null },
  guests: [{ name: "Pip", item: "teddy", x: 175, delivered: 0 }, { name: "Yoyo", item: "pillow", x: 500, delivered: 0 }, { name: "Moss", item: "duck", x: 835, delivered: 0 }],
  toys: [{ item: "pillow", x: 650, y: 590, state: "free", velocity: { x: 0, y: 0 } }],
  bubbles: [], bubbleCooldownMs: 0,
};

test("Jev request defines bounded choices and validates the answer", async () => {
  let body;
  const result = await askJev(state, {
    apiKey: "test-only", actionMs: 250, signal: new AbortController().signal,
    fetchImpl: async (url, options) => {
      expect(url).toBe("https://api.typesafe.ai/v1/systemone");
      expect(options.headers.Authorization).toBe("Bearer test-only");
      body = JSON.parse(options.body);
      return Response.json({ answers: { action: { choice: "left_shoot", confidence: 0.8 } }, usage: { input_tokens: 500 } });
    },
  });
  expect(body.model).toBe("jev-latest");
  expect(Object.keys(body.questions.action.criteria)).toHaveLength(10);
  expect(body.state).toContain('"score":0');
  expect(result).toMatchObject({ action: "left_shoot", confidence: 0.8, usage: { input_tokens: 500 } });
  await expect(askJev(state, {
    apiKey: "test-only", actionMs: 250, signal: new AbortController().signal,
    fetchImpl: async () => Response.json({ answers: { action: { choice: "teleport" } } }),
  })).rejects.toThrow("invalid action");
});

test("authentication errors are not retried or exposed as response bodies", async () => {
  await expect(askJev(state, {
    apiKey: "test-only", actionMs: 250, signal: new AbortController().signal,
    fetchImpl: async () => new Response("secret echoed by provider", { status: 401 }),
  })).rejects.toMatchObject({ message: "Jev API returned HTTP 401", retryable: false });
});

test("the screenshot's carried pillow explicitly targets Yoyo, not Pip", () => {
  const context = buildDecisionContext({ ...state, player: { ...state.player, x: 146.3, y: 340, carried: "pillow" } }, 250);
  expect(context.phase).toBe("deliver");
  expect(context.destination).toEqual({ guest: "Yoyo", item: "pillow", x: 500 });
  expect(context.targets[0].directionsNeeded).toEqual(["right"]);
  expect(context.targets[0].verticalAlreadyAligned).toBe(true);
  expect(context.forecasts.up.movementBlocked).toBe(true);
  expect(context.forecasts.up.goalDistanceReduction).toBe(0);
  expect(context.forecasts.right.goalDistanceReduction).toBeGreaterThan(0);
  expect(context.forecasts.left.goalDistanceReduction).toBeLessThan(0);
  expect(context.forecasts.right_shoot.shooting.canFireDuringAction).toBe(false);
});

test("shot forecasts use the new movement direction, not previous facing", () => {
  const context = buildDecisionContext(state, 250);
  expect(context.forecasts.right_shoot.facingAfterAction).toEqual({ x: 1, y: 0 });
  expect(context.forecasts.right_shoot.shooting.firstBubbleOrigin).toEqual({ x: 535, y: 562 });
  expect(context.forecasts.right_shoot.shooting.toyIntersections).toEqual([{ item: "pillow", closestDistance: 0, mayCatch: true }]);
  expect(context.forecasts.left_shoot.shooting.toyIntersections[0].mayCatch).toBe(false);
  expect(context.forecasts.stay_shoot.facingAfterAction).toEqual({ x: 0, y: -1 });
  expect(context.forecasts.stay_shoot.shooting.toyIntersections[0].mayCatch).toBe(false);
});

test("collecting uses the actual pickup offset and ignores free toys", () => {
  const context = buildDecisionContext({ ...state, toys: [
    ...state.toys,
    { item: "teddy", x: 400, y: 500, state: "caught", velocity: { x: 0, y: 0 } },
  ] }, 250);
  expect(context.phase).toBe("collect");
  expect(context.targets).toHaveLength(1);
  expect(context.targets[0]).toMatchObject({ item: "teddy", guest: "Pip", pickupPlayerPosition: { x: 400, y: 507 }, deltaToPickup: { x: -100, y: -93 } });
});

test("delivery forecasts detect passing through the matching door", () => {
  const context = buildDecisionContext({ ...state, player: { ...state.player, x: 380, y: 360, carried: "pillow" } }, 1000);
  expect(context.forecasts.right.passesCorrectDeliveryRegion).toBe(true);
  expect(context.forecasts.left.passesCorrectDeliveryRegion).toBe(false);
});

test("cooldown and toy velocity are included in shot forecasts", () => {
  const cooldown = buildDecisionContext({ ...state, bubbleCooldownMs: 420 }, 250);
  expect(cooldown.forecasts.right_shoot.shooting.canFireDuringAction).toBe(false);
  const moving = buildDecisionContext({ ...state, toys: [{ ...state.toys[0], velocity: { x: 0, y: -29 } }] }, 250);
  expect(moving.forecasts.right_shoot.shooting.toyIntersections[0].closestDistance).toBeGreaterThan(0);
});

test("real-time controller keeps toys moving during inference and releases keys", async ({ page }) => {
  await page.addInitScript(() => { window.__hotelAutomation = true; });
  await page.goto("/");
  await page.locator("#start").click();
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  expect((await observe(page)).paused).toBe(false);
  const before = await observe(page);
  const logs = [];
  const result = await play(page, {
    apiKey: "test-only", actionMs: 250, maxRequests: 1,
    signal: new AbortController().signal, log: (line) => logs.push(line),
    decide: async (state, options) => {
      await page.waitForTimeout(300);
      const during = await observe(page);
      expect(during.player.x).toBe(state.player.x);
      expect(during.toys.some((toy, i) => toy.x !== state.toys[i].x || toy.y !== state.toys[i].y)).toBe(true);
      return askJev(state, { ...options, fetchImpl: async () => Response.json({ answers: { action: { choice: "right_shoot", confidence: 0.9 } } }) });
    },
  });
  expect(result).toBe("limit");
  expect((await observe(page)).player.x).toBeGreaterThan(before.player.x + 20);
  expect(await page.evaluate(() => window.__hotel.keys.right.isDown || window.__hotel.keys.space.isDown)).toBe(false);
  expect(logs.some((line) => line.includes("action=right_shoot"))).toBe(true);
  await page.locator("#pause").click();
  expect((await observe(page)).paused).toBe(true);
});

test("interrupting an active action releases all controls", async ({ page }) => {
  await page.goto("/");
  await page.locator("#start").click();
  const controller = new AbortController();
  const run = play(page, {
    apiKey: "test-only", actionMs: 1000, maxRequests: 1, signal: controller.signal,
    decide: async () => ({ action: "left_shoot" }), log: () => {},
  });
  await expect.poll(() => page.evaluate(() => window.__hotel.keys.left.isDown)).toBe(true);
  controller.abort(new Error("test stop"));
  await expect(run).rejects.toThrow();
  expect(await page.evaluate(() => window.__hotel.keys.left.isDown || window.__hotel.keys.space.isDown)).toBe(false);
});

test("remote mode controls the browser game over the dev websocket", async ({ page }) => {
  const server = await createServer({ server: { host: "127.0.0.1", port: 0 } });
  const controller = new AbortController();
  try {
    await server.listen();
    const token = "test-session-token";
    const connection = connectRemote(server, {
      token, signal: controller.signal, onDisconnect: () => controller.abort(new Error("disconnected")),
    });
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?jev=${token}`);
    await page.locator("#start").click();
    const driver = await connection;
    const before = await driver.observe();
    const result = await play(null, {
      driver, apiKey: "test-only", maxRequests: 1, actionMs: 250,
      signal: controller.signal, log: () => {},
      decide: async (state) => {
        await page.waitForTimeout(300);
        const during = await driver.observe();
        expect(during.toys.some((toy, i) => toy.x !== state.toys[i].x || toy.y !== state.toys[i].y)).toBe(true);
        return { action: "right_shoot" };
      },
    });
    expect(result).toBe("limit");
    expect((await driver.observe()).player.x).toBeGreaterThan(before.player.x + 20);
    expect(await page.evaluate(() => window.__hotel.keys.right.isDown || window.__hotel.keys.space.isDown)).toBe(false);
    const hold = driver.hold("left_shoot", 1000);
    await expect.poll(() => page.evaluate(() => window.__hotel.keys.left.isDown)).toBe(true);
    controller.abort(new Error("test stop"));
    await expect(hold).rejects.toThrow("test stop");
    await driver.release();
    await expect.poll(() => page.evaluate(() => window.__hotel.keys.left.isDown || window.__hotel.keys.space.isDown)).toBe(false);
  } finally {
    controller.abort();
    await page.close();
    await server.close();
  }
});
