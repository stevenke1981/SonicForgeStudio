import { describe, expect, it } from "vitest";
import { createDemoProject } from "./tauri";
import {
  factoryInstruments,
  instrumentDeviceId,
  instrumentIdFromDeviceKind,
  resolveTrackInstrument,
} from "./instruments";

describe("factory instruments", () => {
  it("defines ten audible starter presets with playable notes", () => {
    expect(factoryInstruments).toHaveLength(10);
    expect(new Set(factoryInstruments.map((preset) => preset.id)).size).toBe(10);
    expect(factoryInstruments.every((preset) => preset.notes.length > 0)).toBe(true);
  });

  it("round-trips the stable project device convention", () => {
    for (const preset of factoryInstruments) {
      expect(instrumentIdFromDeviceKind(preset.deviceKind)).toBe(preset.id);
    }
    expect(instrumentDeviceId("lead-synth")).toBe("instrument-lead-synth");
  });

  it("resolves explicit devices before waveform compatibility fallbacks", () => {
    const project = createDemoProject();
    const track = project.tracks[0];
    project.devices = [{
      id: instrumentDeviceId(track.id),
      kind: "builtin.instrument.bell",
      parameters: {},
    }];
    expect(resolveTrackInstrument(project, track)).toEqual({
      id: "bell",
      explicitDeviceKind: "builtin.instrument.bell",
    });
  });

  it("keeps legacy colon device IDs readable", () => {
    const project = createDemoProject();
    const track = project.tracks[0];
    project.devices = [{
      id: `instrument:${track.id}`,
      kind: "builtin.instrument.warm-pad",
      parameters: {},
    }];

    expect(resolveTrackInstrument(project, track)).toEqual({
      id: "warm-pad",
      explicitDeviceKind: "builtin.instrument.warm-pad",
    });
  });
});
