export interface PianoNote {
  id: number;
  pitch: number;
  tick: number;
  duration: number;
  velocity: number;
  ghost?: boolean;
}

export const initialPianoNotes: PianoNote[] = [
  { id: 1, pitch: 60, tick: 0, duration: 4, velocity: 92 },
  { id: 2, pitch: 62, tick: 4, duration: 4, velocity: 78 },
  { id: 3, pitch: 64, tick: 8, duration: 8, velocity: 108 },
  { id: 4, pitch: 59, tick: 16, duration: 4, velocity: 68 },
  { id: 5, pitch: 60, tick: 20, duration: 8, velocity: 96 },
];
