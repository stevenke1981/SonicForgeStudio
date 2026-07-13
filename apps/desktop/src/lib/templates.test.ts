import { describe, expect, it } from "vitest";
import type { Project } from "./tauri";
import { projectTemplates } from "./templates";

const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function expectValidProject(project: Project): void {
  expect(project.schemaVersion).toBe(1);
  expect(project.id).toMatch(SAFE_ID);
  expect(project.name.trim()).not.toBe("");
  expect(project.sampleRate).toBeGreaterThanOrEqual(8_000);
  expect(project.sampleRate).toBeLessThanOrEqual(384_000);
  expect(project.ppq).toBeGreaterThanOrEqual(24);
  expect(project.ppq).toBeLessThanOrEqual(9_600);
  expect(project.bpm).toBeGreaterThanOrEqual(20);
  expect(project.bpm).toBeLessThanOrEqual(400);
  expect(project.tempoMap[0]?.tick).toBe(0);
  expect(project.tempoMap.every(({ bpm }) => Number.isFinite(bpm) && bpm >= 20 && bpm <= 400)).toBe(true);
  expect(project.timeSignatures.every(({ numerator, denominator }) => (
    numerator > 0 && denominator > 0 && (denominator & (denominator - 1)) === 0
  ))).toBe(true);
  expect(project.assets).toEqual([]);

  const projectIds = [project.id];
  for (const track of project.tracks) {
    projectIds.push(track.id, ...track.clips.map(({ id }) => id));
    expect(track.id).toMatch(SAFE_ID);
    expect(track.name.trim()).not.toBe("");
    expect(Number.isFinite(track.gain) && track.gain >= 0 && track.gain <= 2).toBe(true);
    expect(Number.isFinite(track.pan) && track.pan >= -1 && track.pan <= 1).toBe(true);
    expect(Number.isFinite(track.pattern.lengthBeats) && track.pattern.lengthBeats > 0).toBe(true);

    for (const note of track.pattern.notes) {
      expect(Number.isFinite(note.startBeat) && note.startBeat >= 0).toBe(true);
      expect(Number.isFinite(note.lengthBeats) && note.lengthBeats > 0).toBe(true);
      expect(note.startBeat + note.lengthBeats).toBeLessThanOrEqual(track.pattern.lengthBeats);
      expect(Number.isInteger(note.midiNote) && note.midiNote >= 0 && note.midiNote <= 127).toBe(true);
      expect(Number.isFinite(note.velocity) && note.velocity >= 0 && note.velocity <= 1).toBe(true);
    }

    for (const clip of track.clips) {
      expect(clip.id).toMatch(SAFE_ID);
      expect(clip.name.trim()).not.toBe("");
      expect(Number.isSafeInteger(clip.startTick) && clip.startTick >= 0).toBe(true);
      expect(Number.isSafeInteger(clip.lengthTicks) && clip.lengthTicks > 0).toBe(true);
      if (clip.patternId !== null) expect(clip.patternId).toMatch(SAFE_ID);
    }
  }

  for (const device of project.devices) {
    projectIds.push(device.id);
    expect(device.id).toMatch(SAFE_ID);
    expect(device.kind.trim()).not.toBe("");
    expect(Object.values(device.parameters).every(Number.isFinite)).toBe(true);
  }

  expect(new Set(projectIds).size).toBe(projectIds.length);
}

describe("project templates", () => {
  it("has unique, safe template IDs", () => {
    const ids = projectTemplates.map(({ id }) => id);
    expect(projectTemplates).toHaveLength(5);
    expect(ids.every((id) => SAFE_ID.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("creates independent schema version 1 projects that satisfy the Rust model invariants", () => {
    for (const template of projectTemplates) {
      expect(template.titleKey.trim()).not.toBe("");
      expect(template.descriptionKey.trim()).not.toBe("");
      expect(template.category.trim()).not.toBe("");
      expectValidProject(template.createProject());
      expect(template.createProject()).not.toBe(template.createProject());
    }
  });

  it("keeps the public-domain Twinkle melody in score order", () => {
    const twinkle = projectTemplates.find(({ id }) => id === "twinkle-twinkle");
    expect(twinkle).toBeDefined();
    expect(twinkle?.createProject().tracks[0]?.pattern.notes.map(({ midiNote }) => midiNote)).toEqual([
      60, 60, 67, 67, 69, 69, 67,
      65, 65, 64, 64, 62, 62, 60,
      67, 67, 65, 65, 64, 64, 62,
      67, 67, 65, 65, 64, 64, 62,
      60, 60, 67, 67, 69, 69, 67,
      65, 65, 64, 64, 62, 62, 60,
    ]);
  });
});
