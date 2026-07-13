import { describe, expect, it } from "vitest";
import { createDemoProject } from "./tauri";
import { formatTransportTime, projectBeatToSamples, projectSamplesToBeat, projectTimelineBeats } from "./transportTime";

describe("transport time conversion", () => {
  it("converts constant-tempo beats and samples", () => {
    const project = createDemoProject();
    expect(projectBeatToSamples(project, 4)).toBe(96_000);
    expect(projectSamplesToBeat(project, 96_000)).toBeCloseTo(4);
  });

  it("round-trips across tempo-map segments", () => {
    const project = createDemoProject();
    project.tempoMap = [{ tick: 0, bpm: 120 }, { tick: 3_840, bpm: 60 }];
    const samples = projectBeatToSamples(project, 8);
    expect(samples).toBe(288_000);
    expect(projectSamplesToBeat(project, samples)).toBeCloseTo(8);
  });

  it("uses the active device sample rate when it differs from the project", () => {
    const project = createDemoProject();
    project.sampleRate = 48_000;
    expect(projectBeatToSamples(project, 4, 96_000)).toBe(192_000);
    expect(projectSamplesToBeat(project, 192_000, 96_000)).toBeCloseTo(4, 6);
  });

  it("provides a ten-bar minimum timeline and readable timecode", () => {
    const project = createDemoProject();
    expect(projectTimelineBeats(project)).toBe(40);
    expect(formatTransportTime(5, 120)).toBe("00:02:50");
  });
});
