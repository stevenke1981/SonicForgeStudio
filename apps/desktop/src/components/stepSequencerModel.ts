export const MAX_STEPS = 64;

export type Ratchet = 1 | 2 | 3 | 4;

export interface StepState {
  enabled: boolean;
  velocity: number;
  probability: number;
  microShift: number;
  ratchet: Ratchet;
}

export interface StepPattern {
  length: number;
  swing: number;
  steps: StepState[];
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function defaultStep(index: number, length: number): StepState {
  return {
    enabled: index < length && (index % 4 === 0 || index % 4 === 2),
    velocity: index % 4 === 0 ? 112 : 92,
    probability: 100,
    microShift: 0,
    ratchet: 1,
  };
}

export function createDefaultStepPattern(length = 16): StepPattern {
  const normalizedLength = clamp(Math.round(length), 1, MAX_STEPS);
  return {
    length: normalizedLength,
    swing: 0,
    steps: Array.from({ length: MAX_STEPS }, (_, index) => defaultStep(index, normalizedLength)),
  };
}
