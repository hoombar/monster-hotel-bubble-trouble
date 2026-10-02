import { test, expect } from "@playwright/test";

const endpoint = "https://openrouter.ai/api/alpha/decisions";
const fakeKey = "sk-or-test-not-a-real-key";
const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization,content-type" };
const answer = (action = "right_shoot") => ({
  answers: { action: { choice: action, confidence: 0.87, probabilities: { [action]: 0.9, stay: 0.1 } } },
  usage: { input_tokens: 400, cost: 0.0000168 },
});

async function openPanel(page) {
  await page.goto("/?ai=1");
  await expect(page.locator("#ai-panel")).toBeVisible();
  await expect(page.locator("#start")).toBeEnabled();
  await page.locator("#ai-key").fill(fakeKey);
}

test("the panel is opt-in and fits desktop and mobile", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#start")).toBeEnabled();
  await expect(page.locator("#ai-panel")).toHaveCount(0);
  await openPanel(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const game = await page.locator(".game-shell").boundingBox();
  const panel = await page.locator("#ai-panel").boundingBox();
  expect(panel.x).toBeGreaterThan(game.x + game.width);
  await page.screenshot({ path: "test-results/jev-panel-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await expect(page.locator("#ai-start")).toBeVisible();
  await page.screenshot({ path: "test-results/jev-panel-mobile.png", fullPage: true });
});

test("browser Jev uses OpenRouter and gameplay runs during inference", async ({ page }) => {
  const logs = [];
  page.on("console", (message) => { if (message.text().startsWith("[Jev]")) logs.push(message.text()); });
  let calls = 0;
  await page.route(endpoint, async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    calls++;
    expect(route.request().headers().authorization).toBe(`Bearer ${fakeKey}`);
    const body = route.request().postDataJSON();
    expect(body.model).toBe("typesafe/jev-1.13");
    expect(Object.keys(body.questions.action.criteria)).toHaveLength(10);
    const state = JSON.parse(body.state.split("Current state:\n")[1]);
    expect(state.decisionContext.phase).toBe("catch");
    expect(body.questions.action.criteria.right_shoot).toContain("firstBubbleOrigin");
    const before = await page.evaluate(() => window.__hotel.toys.map((t) => ({ x: t.x, y: t.y })));
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => window.__hotel.toys.map((t) => ({ x: t.x, y: t.y })));
    expect(after.some((toy, i) => toy.x !== before[i].x || toy.y !== before[i].y)).toBe(true);
    await route.fulfill({ headers, json: answer() });
  });
  await openPanel(page);
  await page.locator("#ai-limit").fill("1");
  await page.locator("#ai-start").click();
  await expect(page.locator("#ai-status")).toContainText("Request limit reached");
  expect(calls).toBe(1);
  expect(await page.evaluate(() => window.__hotel.playerPos.x)).toBeGreaterThan(520);
  await expect(page.locator("#ai-log")).toContainText("right_shoot");
  await expect(page.locator("#ai-log")).toContainText("$0.000017");
  expect(logs.join("\n")).not.toContain(fakeKey);
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
  await expect(page.locator("#ai-stop")).toBeDisabled();
});

test("remembering is tab-only and forgetting clears the key", async ({ page, context }) => {
  await openPanel(page);
  await page.reload();
  await expect(page.locator("#ai-key")).toHaveValue("");
  await page.locator("#ai-key").fill(fakeKey);
  await page.locator("#ai-remember").check();
  await page.reload();
  await expect(page.locator("#ai-key")).toHaveValue(fakeKey);
  await expect(page.locator("#ai-remember")).toBeChecked();
  const other = await context.newPage();
  await other.goto("/?ai=1");
  await expect(other.locator("#ai-key")).toHaveValue("");
  await other.close();
  await page.locator("#ai-forget").click();
  await expect(page.locator("#ai-key")).toHaveValue("");
  expect(await page.evaluate(() => sessionStorage.getItem("monster-hotel.openrouter-key"))).toBeNull();
  expect((await context.cookies()).some((cookie) => cookie.value.includes(fakeKey))).toBe(false);
});

test("Stop interrupts an active action and returns control to the player", async ({ page }) => {
  await page.route(endpoint, (route) => route.fulfill({ headers, json: answer() }));
  await openPanel(page);
  await page.locator("#ai-duration").fill("1000");
  await page.locator("#ai-start").click();
  await expect.poll(() => page.evaluate(() => window.__hotel.playerPos.x)).toBeGreaterThan(510);
  await page.locator("#ai-stop").click();
  await expect(page.locator("#ai-start")).toBeEnabled();
  const stopped = await page.evaluate(() => window.__hotel.playerPos.x);
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.__hotel.playerPos.x)).toBe(stopped);
  expect(await page.evaluate(() => window.__hotel.paused)).toBe(false);
  await page.locator("#game").focus();
  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(200);
  await page.keyboard.up("ArrowLeft");
  expect(await page.evaluate(() => window.__hotel.playerPos.x)).toBeLessThan(stopped - 20);
});

test("pausing aborts an in-flight request and late responses cannot move the player", async ({ page }) => {
  let pending;
  await page.route(endpoint, async (route) => { pending = route; });
  await openPanel(page);
  await page.locator("#ai-start").click();
  await expect.poll(() => Boolean(pending)).toBe(true);
  await page.locator("#pause").click();
  await expect(page.locator("#ai-start")).toBeEnabled();
  await expect(page.locator("#ai-status")).toContainText("Game paused");
  await pending.fulfill({ headers, json: answer() }).catch(() => {});
  await page.locator("#resume").click();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__hotel.playerPos.x)).toBe(500);
});

test("invalid answers and authentication errors fail without leaking response bodies", async ({ page }) => {
  let calls = 0;
  await page.route(endpoint, (route) => {
    calls++;
    if (calls === 1) return route.fulfill({ headers, json: answer("teleport") });
    if (calls === 2) return route.fulfill({ status: 401, headers, body: fakeKey });
    return route.fulfill({ headers, body: fakeKey });
  });
  await openPanel(page);
  await page.locator("#ai-start").click();
  await expect(page.locator("#ai-status")).toContainText("invalid action");
  expect(await page.evaluate(() => window.__hotel.playerPos.x)).toBe(500);
  await page.locator("#ai-start").click();
  await expect(page.locator("#ai-status")).toContainText("HTTP 401");
  expect(calls).toBe(2);
  await page.locator("#ai-start").click();
  await expect(page.locator("#ai-status")).toContainText("unreadable response");
  expect(calls).toBe(3);
  await expect(page.locator("#ai-log")).not.toContainText(fakeKey);
});

test("hiding the tab stops the controller before another request", async ({ page }) => {
  let calls = 0;
  await page.route(endpoint, (route) => {
    calls++;
    return route.fulfill({ headers, json: answer() });
  });
  await openPanel(page);
  await page.locator("#ai-duration").fill("1000");
  await page.locator("#ai-start").click();
  await expect.poll(() => page.evaluate(() => window.__hotel.playerPos.x)).toBeGreaterThan(510);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator("#ai-start")).toBeEnabled();
  expect(await page.evaluate(() => window.__hotel.paused)).toBe(true);
  await page.waitForTimeout(250);
  expect(calls).toBe(1);
});

test("temporary failures retry with a fresh observation within the request limit", async ({ page }) => {
  let calls = 0;
  const states = [];
  await page.route(endpoint, (route) => {
    calls++;
    states.push(route.request().postDataJSON().state);
    return calls === 1
      ? route.fulfill({ status: 429, headers })
      : route.fulfill({ headers, json: answer("stay") });
  });
  await openPanel(page);
  await page.locator("#ai-limit").fill("2");
  await page.locator("#ai-start").click();
  await expect(page.locator("#ai-status")).toContainText("Request limit reached");
  expect(calls).toBe(2);
  expect(states[0]).not.toBe(states[1]);
  await expect(page.locator("#ai-log")).toContainText("Retrying with fresh state");
});

test("requests include the previous action's actual outcome", async ({ page }) => {
  const states = [];
  await page.route(endpoint, (route) => {
    const body = route.request().postDataJSON();
    states.push(JSON.parse(body.state.split("Current state:\n")[1]));
    return route.fulfill({ headers, json: answer("right") });
  });
  await openPanel(page);
  await page.locator("#ai-limit").fill("2");
  await page.locator("#ai-start").click();
  await expect(page.locator("#ai-status")).toContainText("Request limit reached");
  expect(states[0].recentOutcomes).toEqual([]);
  expect(states[1].recentOutcomes).toHaveLength(1);
  expect(states[1].recentOutcomes[0]).toMatchObject({ action: "right", carriedBefore: null, carriedAfter: null, deliveries: 0 });
  expect(states[1].recentOutcomes[0].moved).toBeGreaterThan(20);
  await expect(page.locator("#ai-log")).toContainText("Observed goal");
});

test("a pickup during inference invalidates an old shooting decision", async ({ page }) => {
  let calls = 0;
  await page.route(endpoint, async (route) => {
    calls++;
    await page.evaluate(() => {
      const scene = window.__hotel;
      const pillow = scene.toys.find((toy) => scene.guests[toy.index].item === "pillow");
      pillow.state = "carried";
      scene.carried = pillow;
    });
    await route.fulfill({ headers, json: answer("right_shoot") });
  });
  await openPanel(page);
  await page.locator("#ai-limit").fill("1");
  await page.locator("#ai-start").click();
  await expect(page.locator("#ai-status")).toContainText("Request limit reached");
  expect(calls).toBe(1);
  expect(await page.evaluate(() => window.__hotel.playerPos.x)).toBe(500);
  await expect(page.locator("#ai-log")).toContainText("discarding the stale action");
});
