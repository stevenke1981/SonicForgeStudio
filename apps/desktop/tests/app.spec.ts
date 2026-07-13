import { expect, test } from "@playwright/test";

test("desktop shell switches modes and exposes keyboard-friendly controls", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page.getByText("OFFLINE MOCK")).toBeVisible();
  await page.getByRole("tab", { name: "SFX Lab" }).click();
  await expect(page.getByTestId("sfx-panel")).toBeVisible();
  await page.getByRole("button", { name: "Unlock seed" }).click();
  await page.getByRole("button", { name: /Randomize/i }).first().click();
  await page.screenshot({ path: "artifacts/screenshots/gui-sfx-lab.png", fullPage: true });
  await page.getByRole("button", { name: "Open command palette" }).click();
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
});

test("song editor and mixer expose the core workspace actions", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("song-editor")).toBeVisible();

  await page.getByRole("button", { name: "Select Lead Pattern 01" }).dragTo(page.getByTestId("song-editor"));
  await expect(page.getByRole("status")).toContainText("Clip moved on the grid");
  await page.getByRole("button", { name: /New clip/i }).click();
  await expect(page.getByRole("button", { name: "Select New Pattern" })).toBeVisible();
  const clipLength = page.getByRole("slider", { name: "Clip length" });
  await clipLength.fill("220");
  await expect(clipLength).toHaveValue("220");
  await page.getByRole("button", { name: /Duplicate/i }).click();
  await expect(page.getByRole("button", { name: /Select New Pattern copy/i })).toBeVisible();
  await page.getByRole("button", { name: /Split at playhead/i }).click();
  await expect(page.getByRole("button", { name: /Select New Pattern copy \/ B/i })).toBeVisible();

  await page.getByRole("tab", { name: "Mixer" }).click();
  const mixerPanel = page.getByTestId("mixer-panel");
  await expect(mixerPanel).toBeVisible();
  await mixerPanel.getByRole("button", { name: "Mute Lead Synth" }).click();
  await expect(mixerPanel.getByRole("button", { name: "Unmute Lead Synth" })).toBeVisible();
});
