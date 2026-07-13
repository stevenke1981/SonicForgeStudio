import { expect, test } from "@playwright/test";

test("desktop shell switches modes and exposes keyboard-friendly controls", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page.getByText("OFFLINE MOCK")).toBeVisible();
  await page.getByRole("tab", { name: "SFX Lab" }).click();
  await expect(page.getByTestId("sfx-panel")).toBeVisible();
  await page.getByRole("button", { name: "Unlock seed" }).click();
  await page.getByRole("button", { name: /Randomize/i }).first().click();
  await page.screenshot({ path: testInfo.outputPath("gui-sfx-lab.png"), fullPage: true });
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

test("factory instruments create audible project tracks and the playhead seeks", async ({ page }, testInfo) => {
  const uiScale = testInfo.project.name.replace("dpi-", "");
  const scaleFactor = Number(uiScale) / 100;
  await page.setViewportSize({ width: Math.round(1440 * scaleFactor), height: Math.round(1000 * scaleFactor) });
  await page.goto("/");
  await page.getByRole("combobox", { name: "UI scale" }).selectOption(uiScale);
  await page.getByRole("button", { name: "Add instrument" }).click();
  const picker = page.getByRole("dialog", { name: "Add a playable instrument" });
  await expect(picker.getByRole("button", { name: /^Add / })).toHaveCount(10);
  await picker.getByRole("button", { name: "Add Drum Kit" }).click();
  await expect(page.locator(".track-label.selected")).toContainText("Drum Kit");
  await expect(page.getByRole("combobox", { name: "Track instrument" })).toHaveValue("drum-kit");

  const timeline = page.getByLabel("Song editor timeline");
  const box = await timeline.boundingBox();
  if (!box) throw new Error("timeline has no layout box");
  await timeline.click({ position: { x: (116 + 64 * 5) * scaleFactor, y: Math.min(180 * scaleFactor, box.height / 2) } });
  const playhead = page.getByTestId("playhead");
  await expect(playhead).toHaveAttribute("aria-valuenow", "20");
  await playhead.focus();
  await page.keyboard.press("ArrowRight");
  await expect(playhead).toHaveAttribute("aria-valuenow", "20.25");
  await page.keyboard.press("Home");
  await expect(playhead).toHaveAttribute("aria-valuenow", "0");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await expect.poll(async () => Number(await playhead.getAttribute("aria-valuenow"))).toBeGreaterThan(0);
  await page.getByRole("combobox", { name: "Track instrument" }).selectOption("bell");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
});

test("step sequencer edits 64 steps with bounded undo and transport controls", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Step Sequencer" }).click();
  const sequencer = page.getByTestId("step-sequencer");
  await expect(sequencer).toBeVisible();

  await sequencer.getByRole("slider", { name: "Pattern length" }).fill("64");
  await expect(sequencer.getByRole("button", { name: "Step 64 inactive" })).toBeVisible();

  const stepOne = sequencer.getByRole("button", { name: /Step 1 (active|inactive)$/ });
  await stepOne.click();
  await expect(stepOne).toHaveAttribute("aria-pressed", "false");
  await sequencer.getByRole("slider", { name: "Velocity" }).fill("80");
  await sequencer.getByRole("slider", { name: "Probability" }).fill("65");
  await sequencer.getByRole("slider", { name: "Micro-shift" }).fill("12");
  await sequencer.getByRole("slider", { name: "Ratchet" }).fill("4");
  await expect(sequencer.getByTestId("sequencer-dirty-state")).toHaveText("Unsaved changes");

  await sequencer.getByRole("button", { name: "Undo" }).click();
  await expect(sequencer.getByRole("slider", { name: "Ratchet" })).toHaveValue("1");
  await sequencer.getByRole("button", { name: "Redo" }).click();
  await expect(sequencer.getByRole("slider", { name: "Ratchet" })).toHaveValue("4");

  await sequencer.getByRole("button", { name: "Undo" }).focus();
  await page.keyboard.press("Control+Z");
  await expect(sequencer.getByRole("slider", { name: "Ratchet" })).toHaveValue("1");
  await page.keyboard.press("Control+Shift+Z");
  await expect(sequencer.getByRole("slider", { name: "Ratchet" })).toHaveValue("4");
  await page.keyboard.press("Control+Y");
  await expect(sequencer.getByRole("slider", { name: "Ratchet" })).toHaveValue("4");

  await sequencer.getByRole("button", { name: "Play pattern" }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
});

test("piano roll Canvas supports editing transforms, scale, and ghost notes", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Piano Roll" }).click();
  const pianoRoll = page.getByTestId("piano-roll");
  await expect(pianoRoll).toBeVisible();
  await expect(page.getByTestId("note-count")).toHaveText("5 NOTES");

  await page.getByRole("button", { name: /draw/i }).click();
  await pianoRoll.getByRole("application").click({ position: { x: 310, y: 120 } });
  await expect(page.getByTestId("note-count")).toHaveText("6 NOTES");
  await page.getByRole("slider", { name: "Note length" }).fill("12");
  await page.getByRole("slider", { name: "Note velocity" }).fill("115");
  await page.getByRole("button", { name: "Quantize 1/16" }).click();
  await page.getByRole("button", { name: "+1" }).click();
  await pianoRoll.getByRole("button", { name: "Duplicate" }).click();
  await expect(page.getByTestId("note-count")).toHaveText("7 NOTES");
  await page.getByRole("button", { name: "Legato" }).click();
  await expect(page.getByText("8/16")).toBeVisible();
  await page.getByRole("combobox", { name: "Piano Roll scale" }).selectOption("C Minor");
  await page.getByRole("checkbox", { name: "Ghost notes" }).uncheck();
  await expect(pianoRoll.locator(".piano-state")).toContainText("C Minor · Ghosts off");

  await page.getByRole("button", { name: /erase/i }).click();
  await pianoRoll.getByRole("application").click({ position: { x: 310, y: 120 } });
  await expect(page.getByLabel("Project save status")).toHaveText("Unsaved changes");
  await page.screenshot({ path: testInfo.outputPath("piano-roll.png"), fullPage: true });
});

test("project and real-time audio settings use visible command states", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Piano Roll" }).click();
  await page.getByTestId("piano-roll").getByRole("button", { name: "Duplicate" }).click();
  await expect(page.getByLabel("Project save status")).toHaveText("Unsaved changes");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByLabel("Project save status")).toHaveText("Saved");
  await expect(page.getByRole("button", { name: "Open", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.getByText("Loaded SonicForge Demo")).toBeVisible();
  await page.getByRole("combobox", { name: "Autosave interval" }).selectOption("5");

  await page.getByRole("button", { name: "Open audio settings" }).click();
  await expect(page.getByRole("dialog", { name: "Audio settings" })).toBeVisible();
  await page.getByRole("combobox", { name: "Audio sample rate" }).selectOption("96000");
  await page.getByRole("combobox", { name: "Audio buffer size" }).selectOption("512");
  await expect(page.getByText("5.3 ms")).toBeVisible();
  await page.getByRole("button", { name: "Apply & start" }).click();
  await expect(page.getByRole("button", { name: "Stop audio" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Open audio settings" })).toContainText("512f");
});

test("Canvas backing store tracks CSS size across independent DPI and UI scales", async ({ page }) => {
  await page.goto("/");
  const shell = page.getByTestId("app-shell");
  await expect(page.getByRole("tab", { name: "Music" })).toBeVisible();
  await page.getByRole("tab", { name: "Piano Roll" }).click();
  await expect(page.getByTestId("piano-roll")).toBeVisible();
  await expect(page.getByRole("button", { name: /draw/i })).toBeVisible();
  const canvas = page.getByTestId("piano-roll").getByRole("application");
  const expectedPixelRatio = await page.evaluate(() => Math.min(window.devicePixelRatio || 1, 2));

  for (const scale of ["100", "125", "150", "200"]) {
    await page.getByRole("combobox", { name: "UI scale" }).selectOption(scale);
    await expect(shell).toHaveAttribute("data-ui-scale", scale);
    await expect.poll(async () => canvas.evaluate((element, expected) => {
      const target = element as HTMLCanvasElement;
      const rect = target.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return Number.POSITIVE_INFINITY;
      return Math.max(
        Math.abs(target.width / rect.width - expected),
        Math.abs(target.height / rect.height - expected),
      );
    }, expectedPixelRatio)).toBeLessThan(0.02);
  }

  const box = await shell.boundingBox();
  expect(box?.width).toBeLessThanOrEqual(1367);
  expect(box?.height).toBeLessThanOrEqual(769);
});

test("language switch and public-domain templates update the visible project", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Language" }).selectOption("zh-TW");
  await expect(page.getByRole("tab", { name: /音樂/ })).toBeVisible();
  await page.getByRole("button", { name: /範本/ }).click();
  const dialog = page.getByRole("dialog", { name: "從範本開始" });
  await expect(dialog).toBeVisible();
  const card = dialog.getByRole("heading", { name: "小星星" }).locator("..");
  await card.getByRole("button", { name: "使用範本" }).click();
  await expect(page.getByTestId("piano-roll")).toBeVisible();
  await expect(page.getByTestId("note-count")).toContainText("42");
  await expect(page.getByText("Twinkle Twinkle Little Star")).toBeVisible();
  if (testInfo.project.name === "dpi-100") {
    await page.screenshot({ path: testInfo.outputPath("multilingual-templates.png"), fullPage: true });
  }
});

test("SFX, Mixer, Save As, WAV export, and expanded templates are usable", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "SFX Lab" }).click();
  const recipes = ["Laser Pulse", "Deep Impact", "Fast Whoosh", "Soft UI Click", "Rain Ambience"];
  for (const recipe of recipes) {
    await page.getByRole("button", { name: `Preview ${recipe}` }).click();
    await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
    await page.getByRole("button", { name: `Stop ${recipe}` }).click();
    await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  }

  await page.getByRole("tab", { name: "Mixer" }).click();
  const mixer = page.getByTestId("mixer-panel");
  await mixer.getByRole("button", { name: "Play", exact: true }).click();
  await expect(mixer.locator(".mixer-transport-state")).toHaveText("PLAYING");
  await mixer.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(mixer.locator(".mixer-transport-state")).toHaveText("READY");

  await page.getByRole("button", { name: "Save As", exact: true }).click();
  const saveAs = page.getByRole("dialog", { name: "Save project as" });
  await saveAs.getByRole("textbox", { name: "Project name" }).fill("E2E Copy");
  await saveAs.getByRole("textbox", { name: "Safe project ID" }).fill("e2e-copy");
  await saveAs.getByRole("button", { name: "Save As", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Saved projects" })).toHaveValue("e2e-copy");

  await page.getByRole("button", { name: /Export WAV/ }).click();
  const exportDialog = page.getByRole("dialog", { name: "Export WAV" });
  await exportDialog.getByRole("textbox", { name: "Safe file name" }).fill("e2e-render");
  await exportDialog.getByRole("button", { name: "Export WAV", exact: true }).click();
  await expect(exportDialog.getByRole("status")).toContainText("browser-preview://exports/e2e-render.wav");
  await exportDialog.getByRole("button", { name: "Close export", exact: true }).first().click();

  await page.getByRole("button", { name: /Templates/ }).click();
  await expect(page.getByRole("dialog", { name: "Start from a template" }).locator(".template-card")).toHaveCount(9);
});
