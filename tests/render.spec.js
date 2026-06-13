const { test, expect } = require("@playwright/test");

test("renders the N4520 visualizer with compositor reel layers", async ({ page }) => {
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });

  await page.goto("http://localhost:4173/standalone/", { waitUntil: "networkidle" });

  await expect(page.locator("#reelCanvas")).toBeHidden();
  await expect(page.locator(".reel-mount-left")).toBeVisible();
  await expect(page.locator(".reel-mount-right")).toBeVisible();
  await expect(page.locator(".vu-window-left")).toBeVisible();
  await expect(page.locator(".vu-window-right")).toBeVisible();

  const reelState = await page.locator(".reel-mount-left").evaluate((node) => {
    const { width, height, display, backgroundImage } = getComputedStyle(node.querySelector(".photo-reel"), "::before");
    return {
      width,
      height,
      display,
      hasImage: backgroundImage.includes("reel-front-face.png"),
    };
  });

  expect(Number.parseFloat(reelState.width)).toBeGreaterThan(0);
  expect(Number.parseFloat(reelState.height)).toBeGreaterThan(0);
  expect(reelState.display).not.toBe("none");
  expect(reelState.hasImage).toBe(true);
  expect(browserErrors).toEqual([]);

  await page.screenshot({ path: "test-results/n4520-render.png", fullPage: true });
});
