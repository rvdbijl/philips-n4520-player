const { test, expect } = require("@playwright/test");

test("renders the N4520 visualizer without a blank WebGL layer", async ({ page }) => {
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });

  await page.goto("http://localhost:4173/", { waitUntil: "networkidle" });

  const canvas = page.locator("#reelCanvas");
  await expect(canvas).toBeVisible();
  await expect(page.locator(".vu-photo-left")).toBeVisible();
  await expect(page.locator(".vu-photo-right")).toBeVisible();

  const canvasState = await canvas.evaluate((node) => {
    const dataUrl = node.toDataURL("image/png");
    return {
      width: node.width,
      height: node.height,
      bytes: dataUrl.length,
      blank: dataUrl.length < 5000,
    };
  });

  expect(canvasState.width).toBeGreaterThan(0);
  expect(canvasState.height).toBeGreaterThan(0);
  expect(canvasState.blank).toBe(false);
  expect(browserErrors).toEqual([]);

  await page.screenshot({ path: "test-results/n4520-render.png", fullPage: true });
});
