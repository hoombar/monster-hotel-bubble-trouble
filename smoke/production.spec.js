import { test, expect } from "@playwright/test";

test("production game loads its assets and plays music under the site subfolder", async ({
  page,
  baseURL,
}) => {
  const failures = [];
  const localAssets = new Set();
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.origin !== new URL(baseURL).origin) return;
    if (response.status() >= 400)
      failures.push(`${response.status()} ${url.pathname}`);
    if (/\.(png|mp3|js|css)$/.test(url.pathname)) localAssets.add(url.pathname);
  });
  await page.goto("./");
  await expect(page.locator("#start")).toBeEnabled();
  expect(await page.evaluate(() => window.__hotel)).toBeUndefined();
  await page.locator("#start").click();
  await expect(page.locator("#intro")).toBeHidden();
  await expect
    .poll(() =>
      page.locator("#background-music").evaluate((audio) => audio.currentTime),
    )
    .toBeGreaterThan(0);
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(250);
  await page.keyboard.up("ArrowRight");
  await page.keyboard.press("Space");
  await page.locator("#pause").click();
  await expect(page.locator("#paused")).toBeVisible();
  expect(
    await page.locator("#background-music").evaluate((audio) => audio.paused),
  ).toBe(true);
  await page.locator("#resume").click();
  await expect(page.locator("#paused")).toBeHidden();
  expect([...localAssets].filter((url) => url.endsWith(".png"))).toHaveLength(
    8,
  );
  expect([...localAssets].some((url) => url.endsWith(".mp3"))).toBe(true);
  expect(
    [...localAssets].every((url) => url.startsWith("/monster-hotel/")),
  ).toBe(true);
  expect(failures).toEqual([]);
  await expect(page.locator("#ai-panel")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await expect(page.locator('[data-key="bubble"]')).toBeVisible();
});

test("production AI panel plays without exposing the scene globally", async ({ page }) => {
  const states = [];
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://openrouter.ai/api/alpha/decisions", (route) => {
    const body = route.request().postDataJSON();
    expect(body.model).toBe("typesafe/jev-1.13");
    states.push(JSON.parse(body.state.split("Current state:\n")[1]));
    return route.fulfill({
      headers: { "Access-Control-Allow-Origin": "*" },
      json: { answers: { action: { choice: "right_shoot", confidence: 0.9 } } },
    });
  });
  await page.goto("./?ai=1");
  await expect(page.locator("#ai-panel")).toBeVisible();
  await expect(page.locator("#start")).toBeEnabled();
  expect(await page.evaluate(() => window.__hotel)).toBeUndefined();
  await page.locator("#ai-key").fill("sk-or-test-not-real");
  await page.locator("#ai-limit").fill("1");
  await page.locator("#ai-start").click();
  await expect(page.locator("#ai-status")).toContainText("Request limit reached");
  await page.locator("#ai-start").click();
  await expect(page.locator("#ai-status")).toContainText("Request limit reached");
  expect(states).toHaveLength(2);
  expect(states[1].player.x).toBeGreaterThan(states[0].player.x + 20);
  await page.locator("#ai-inspector > summary").click();
  await expect(page.locator("#ai-request-select option")).toHaveCount(2);
  expect(JSON.parse(await page.locator("#ai-request-json").textContent()).model).toBe("typesafe/jev-1.13");
  expect(JSON.parse(await page.locator("#ai-response-json").textContent()).answers.action.choice).toBe("right_shoot");
  expect(await page.evaluate(() => window.__hotel)).toBeUndefined();
  expect(errors).toEqual([]);
});
