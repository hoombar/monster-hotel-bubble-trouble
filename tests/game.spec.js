import { test, expect } from "@playwright/test";

test("music plays, toggles independently, and follows pause and resume", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator("#start")).toBeEnabled();
  const track = page.locator("#background-music");
  const button = page.locator("#music");
  await expect(button).toHaveAttribute("aria-pressed", "true");
  expect(await track.evaluate((audio) => audio.paused)).toBe(true);
  await page.locator("#start").click();
  await expect(button).toHaveText("Music on");
  await expect
    .poll(() => track.evaluate((audio) => audio.currentTime))
    .toBeGreaterThan(0);
  expect(await track.evaluate((audio) => audio.loop)).toBe(true);
  await expect(page.locator("#sound")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#sound").click();
  await expect(page.locator("#sound")).toHaveAttribute("aria-pressed", "false");
  expect(await track.evaluate((audio) => audio.paused)).toBe(false);
  await page.locator("#pause").click();
  expect(await track.evaluate((audio) => audio.paused)).toBe(true);
  await expect(button).toHaveAttribute("aria-pressed", "true");
  const position = await track.evaluate((audio) => audio.currentTime);
  await page.locator("#resume").click();
  await expect
    .poll(() => track.evaluate((audio) => audio.currentTime))
    .toBeGreaterThan(position);
  await button.click();
  await expect(button).toHaveText("Music off");
  expect(await track.evaluate((audio) => audio.paused)).toBe(true);
  await page.locator("#pause").click();
  await page.locator("#resume").click();
  expect(await track.evaluate((audio) => audio.paused)).toBe(true);
  expect(errors).toEqual([]);
});

test("music can be disabled before starting the game", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#start")).toBeEnabled();
  await page.locator("#music").click();
  await page.locator("#start").click();
  await expect(page.locator("#music")).toHaveAttribute("aria-pressed", "false");
  expect(
    await page.locator("#background-music").evaluate((audio) => audio.paused),
  ).toBe(true);
});

test("unavailable music fails gracefully without breaking the game", async ({
  page,
}) => {
  await page.route("**/music/chiptune.mp3*", (route) =>
    route.request().resourceType() === "media"
      ? route.abort()
      : route.continue(),
  );
  await page.goto("/");
  await expect(page.locator("#start")).toBeEnabled();
  await page.locator("#start").click();
  await expect(page.locator("#music")).toHaveText("Music off");
  await expect(page.locator("#music")).toHaveAttribute(
    "title",
    /could not play/,
  );
  await expect(page.locator("#intro")).toBeHidden();
});

test("opens, moves, catches, delivers six toys, celebrates, and restarts", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator("#start")).toBeEnabled();
  await page.screenshot({ path: "test-results/welcome-desktop.png" });
  await page.locator("#start").focus();
  await page.keyboard.press("Space");
  await expect(page.locator("#intro")).toBeHidden();
  const initial = await page.evaluate(() => window.__hotel.playerPos.x);
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(220);
  await page.keyboard.up("ArrowRight");
  expect(await page.evaluate(() => window.__hotel.playerPos.x)).toBeGreaterThan(
    initial + 15,
  );

  await page.locator("#pause").click();
  await expect(page.locator("#paused")).toBeVisible();
  const pausedX = await page.evaluate(() => window.__hotel.playerPos.x);
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(150);
  await page.keyboard.up("ArrowRight");
  expect(await page.evaluate(() => window.__hotel.playerPos.x)).toBe(pausedX);
  await page.keyboard.press("Space");
  await expect(page.locator("#paused")).toBeHidden();

  for (let i = 0; i < 6; i++) {
    // Place a live wandering toy ahead of the helper, then use the real input
    // and collision path. Deterministic staging avoids chasing random routes.
    const targetIndex = await page.evaluate(() => {
      const scene = window.__hotel;
      const toy = scene.toys[0];
      scene.toys.forEach((other, index) => {
        other.x = 90 + index * 80;
        other.y = 660;
        other.direction = 0;
        other.turnAt = Infinity;
      });
      scene.playerPos.set(500, 570);
      scene.facing.set(0, -1);
      toy.x = 500;
      toy.y = 454;
      toy.direction = 0;
      toy.turnAt = Infinity;
      scene.lastBubble = -1000;
      return toy.index;
    });
    await page.keyboard.down("Space");
    await expect
      .poll(() =>
        page.evaluate(
          (index) => window.__hotel.toys.find((t) => t.index === index)?.state,
          targetIndex,
        ),
      )
      .toBe("caught");
    await page.keyboard.up("Space");
    if (i === 0) {
      await page.screenshot({ path: "test-results/playing-desktop.png" });
      await page.waitForTimeout(1400);
      expect(
        await page.evaluate(
          (index) => window.__hotel.toys.find((t) => t.index === index).state,
          targetIndex,
        ),
      ).toBe("caught");
    }
    await page.keyboard.down("ArrowUp");
    await expect
      .poll(() => page.evaluate(() => window.__hotel.carried?.index))
      .toBe(targetIndex);
    await page.keyboard.up("ArrowUp");
    // A wrong door must not accept the delivery.
    await page.evaluate((index) => {
      const s = window.__hotel;
      s.playerPos.set(s.guests[(index + 1) % 3].x, 355);
    }, targetIndex);
    await page.waitForTimeout(80);
    expect(await page.evaluate(() => window.__hotel.score)).toBe(i);
    await page.evaluate((index) => {
      const s = window.__hotel;
      s.playerPos.set(s.guests[index].x, 355);
    }, targetIndex);
    await expect(page.locator("#score")).toHaveText(`${i + 1} / 6`);
  }
  await expect(page.locator("#finished")).toBeVisible();
  await page.screenshot({ path: "test-results/finished-desktop.png" });
  await page.keyboard.press("Space");
  await expect(page.locator("#finished")).toBeHidden();
  await expect(page.locator("#score")).toHaveText("0 / 6");
  await expect
    .poll(() => page.evaluate(() => window.__hotel.running))
    .toBe(true);
  expect(await page.evaluate(() => window.__hotel.toys.length)).toBe(3);
  await page.keyboard.press("Escape");
  await expect(page.locator("#paused")).toBeVisible();
  await page.evaluate(() =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        keyCode: 27,
        repeat: true,
        bubbles: true,
      }),
    ),
  );
  await expect(page.locator("#paused")).toBeVisible();
  expect(errors).toEqual([]);
});

test("mobile fits the screen and pointer controls work", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("#start")).toBeEnabled();
  await page.screenshot({ path: "test-results/welcome-mobile.png" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await page.locator("#start").click();
  await page.evaluate(() =>
    window.__hotel.toys.forEach((toy) => {
      toy.x = 100;
      toy.y = 450;
    }),
  );
  const startX = await page.evaluate(() => window.__hotel.playerPos.x);
  const right = await page.locator('[data-key="right"]').boundingBox();
  await page.mouse.move(right.x + right.width / 2, right.y + right.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(220);
  await page.mouse.up();
  expect(await page.evaluate(() => window.__hotel.playerPos.x)).toBeGreaterThan(
    startX + 15,
  );
  const blow = await page.locator('[data-key="bubble"]').boundingBox();
  await page.mouse.move(blow.x + blow.width / 2, blow.y + blow.height / 2);
  await page.mouse.down();
  await expect
    .poll(() => page.evaluate(() => window.__hotel.bubbles.length))
    .toBeGreaterThan(0);
  await page.mouse.up();
  await page.screenshot({ path: "test-results/playing-mobile.png" });
});
