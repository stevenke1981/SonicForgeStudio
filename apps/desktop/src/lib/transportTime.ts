import type { Project } from "./tauri";

function secondsAtTick(project: Project, tick: number): number {
  const target = Math.max(0, tick);
  let seconds = 0;
  let previousTick = 0;
  let bpm = project.tempoMap[0]?.bpm ?? project.bpm;
  for (const point of project.tempoMap.slice(1)) {
    if (point.tick >= target) break;
    seconds += (point.tick - previousTick) * 60 / (bpm * project.ppq);
    previousTick = point.tick;
    bpm = point.bpm;
  }
  return seconds + (target - previousTick) * 60 / (bpm * project.ppq);
}

export function projectBeatToSamples(project: Project, beat: number, sampleRate = project.sampleRate): number {
  const seconds = secondsAtTick(project, Math.max(0, beat) * project.ppq);
  return Math.max(0, Math.round(seconds * sampleRate));
}

export function projectSamplesToBeat(project: Project, samples: number, sampleRate = project.sampleRate): number {
  const targetSeconds = Math.max(0, samples) / sampleRate;
  let seconds = 0;
  let previousTick = 0;
  let bpm = project.tempoMap[0]?.bpm ?? project.bpm;
  for (const point of project.tempoMap.slice(1)) {
    const segmentSeconds = (point.tick - previousTick) * 60 / (bpm * project.ppq);
    if (seconds + segmentSeconds >= targetSeconds) break;
    seconds += segmentSeconds;
    previousTick = point.tick;
    bpm = point.bpm;
  }
  const remainingTicks = (targetSeconds - seconds) * bpm * project.ppq / 60;
  return Math.max(0, (previousTick + remainingTicks) / project.ppq);
}

export function projectTimelineBeats(project: Project): number {
  const noteEnd = project.tracks.flatMap((track) => track.pattern.notes)
    .reduce((maximum, note) => Math.max(maximum, note.startBeat + note.lengthBeats), 0);
  const patternEnd = project.tracks.reduce((maximum, track) => Math.max(maximum, track.pattern.lengthBeats), 0);
  return Math.max(40, Math.ceil(Math.max(noteEnd, patternEnd) / 4) * 4);
}

export function formatTransportTime(beat: number, bpm: number): string {
  const totalSeconds = Math.max(0, beat) * 60 / Math.max(20, bpm);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const frames = Math.floor((totalSeconds - Math.floor(totalSeconds)) * 100);
  return [minutes, seconds, frames].map((value) => value.toString().padStart(2, "0")).join(":");
}
