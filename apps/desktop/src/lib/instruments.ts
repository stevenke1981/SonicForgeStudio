import type { TranslationKey } from "../i18n";
import type { NoteEvent, Project, ProjectTrack, Waveform } from "./tauri";

export const FACTORY_INSTRUMENT_PREFIX = "builtin.instrument.";
export const TRACK_INSTRUMENT_DEVICE_PREFIX = "instrument-";
const LEGACY_TRACK_INSTRUMENT_DEVICE_PREFIX = "instrument:";

export interface FactoryInstrumentPreset {
  id: FactoryInstrumentId;
  deviceKind: `${typeof FACTORY_INSTRUMENT_PREFIX}${string}`;
  nameKey: TranslationKey;
  descriptionKey: TranslationKey;
  icon: string;
  color: "cyan" | "amber" | "violet";
  waveform: Waveform;
  notes: readonly NoteEvent[];
}

export const factoryInstruments = [
  {
    id: "analog-lead",
    deviceKind: "builtin.instrument.analog-lead",
    nameKey: "instrument.analogLead",
    descriptionKey: "instrument.analogLead.description",
    icon: "◌",
    color: "cyan",
    waveform: "saw",
    notes: [60, 64, 67, 72].map((midiNote, startBeat) => ({ startBeat, lengthBeats: 0.85, midiNote, velocity: 0.78 })),
  },
  {
    id: "warm-pad",
    deviceKind: "builtin.instrument.warm-pad",
    nameKey: "instrument.warmPad",
    descriptionKey: "instrument.warmPad.description",
    icon: "≋",
    color: "violet",
    waveform: "triangle",
    notes: [48, 55, 60, 64].map((midiNote) => ({ startBeat: 0, lengthBeats: 4, midiNote, velocity: 0.46 })),
  },
  {
    id: "electric-bass",
    deviceKind: "builtin.instrument.electric-bass",
    nameKey: "instrument.electricBass",
    descriptionKey: "instrument.electricBass.description",
    icon: "♩",
    color: "amber",
    waveform: "square",
    notes: [36, 36, 43, 41].map((midiNote, index) => ({ startBeat: index, lengthBeats: 0.9, midiNote, velocity: 0.82 })),
  },
  {
    id: "soft-keys",
    deviceKind: "builtin.instrument.soft-keys",
    nameKey: "instrument.softKeys",
    descriptionKey: "instrument.softKeys.description",
    icon: "▤",
    color: "cyan",
    waveform: "sine",
    notes: [60, 64, 67, 72].map((midiNote, startBeat) => ({ startBeat, lengthBeats: 0.8, midiNote, velocity: 0.7 })),
  },
  {
    id: "bell",
    deviceKind: "builtin.instrument.bell",
    nameKey: "instrument.bell",
    descriptionKey: "instrument.bell.description",
    icon: "◇",
    color: "violet",
    waveform: "sine",
    notes: [72, 76, 79, 84].map((midiNote, startBeat) => ({ startBeat, lengthBeats: 0.9, midiNote, velocity: 0.72 })),
  },
  {
    id: "pluck",
    deviceKind: "builtin.instrument.pluck",
    nameKey: "instrument.pluck",
    descriptionKey: "instrument.pluck.description",
    icon: "⌁",
    color: "cyan",
    waveform: "triangle",
    notes: [67, 70, 74, 77].map((midiNote, index) => ({ startBeat: index, lengthBeats: 0.45, midiNote, velocity: 0.8 })),
  },
  {
    id: "drum-kit",
    deviceKind: "builtin.instrument.drum-kit",
    nameKey: "instrument.drumKit",
    descriptionKey: "instrument.drumKit.description",
    icon: "◈",
    color: "amber",
    waveform: "square",
    notes: [
      { startBeat: 0, lengthBeats: 0.25, midiNote: 36, velocity: 0.95 },
      { startBeat: 0, lengthBeats: 0.12, midiNote: 42, velocity: 0.62 },
      { startBeat: 0.5, lengthBeats: 0.12, midiNote: 42, velocity: 0.48 },
      { startBeat: 1, lengthBeats: 0.25, midiNote: 38, velocity: 0.9 },
      { startBeat: 1, lengthBeats: 0.12, midiNote: 42, velocity: 0.64 },
      { startBeat: 1.5, lengthBeats: 0.12, midiNote: 42, velocity: 0.48 },
      { startBeat: 2, lengthBeats: 0.25, midiNote: 36, velocity: 0.92 },
      { startBeat: 2, lengthBeats: 0.12, midiNote: 42, velocity: 0.62 },
      { startBeat: 2.5, lengthBeats: 0.12, midiNote: 42, velocity: 0.48 },
      { startBeat: 3, lengthBeats: 0.25, midiNote: 38, velocity: 0.9 },
      { startBeat: 3, lengthBeats: 0.12, midiNote: 42, velocity: 0.64 },
      { startBeat: 3.5, lengthBeats: 0.12, midiNote: 42, velocity: 0.48 },
    ],
  },
  {
    id: "kick",
    deviceKind: "builtin.instrument.kick",
    nameKey: "instrument.kick",
    descriptionKey: "instrument.kick.description",
    icon: "●",
    color: "amber",
    waveform: "sine",
    notes: [0, 1, 2, 3].map((startBeat) => ({ startBeat, lengthBeats: 0.3, midiNote: 36, velocity: 0.95 })),
  },
  {
    id: "snare",
    deviceKind: "builtin.instrument.snare",
    nameKey: "instrument.snare",
    descriptionKey: "instrument.snare.description",
    icon: "◆",
    color: "amber",
    waveform: "square",
    notes: [1, 3].map((startBeat) => ({ startBeat, lengthBeats: 0.25, midiNote: 38, velocity: 0.9 })),
  },
  {
    id: "hi-hat",
    deviceKind: "builtin.instrument.hi-hat",
    nameKey: "instrument.hiHat",
    descriptionKey: "instrument.hiHat.description",
    icon: "✦",
    color: "amber",
    waveform: "square",
    notes: Array.from({ length: 8 }, (_, index) => ({ startBeat: index * 0.5, lengthBeats: 0.12, midiNote: 42, velocity: index % 2 === 0 ? 0.72 : 0.52 })),
  },
] as const satisfies readonly FactoryInstrumentPreset[];

export type FactoryInstrumentId =
  | "analog-lead"
  | "warm-pad"
  | "electric-bass"
  | "soft-keys"
  | "bell"
  | "pluck"
  | "drum-kit"
  | "kick"
  | "snare"
  | "hi-hat";

export function getFactoryInstrument(id: FactoryInstrumentId): FactoryInstrumentPreset {
  return factoryInstruments.find((preset) => preset.id === id) ?? factoryInstruments[0];
}

export function instrumentDeviceId(trackId: string): string {
  return `${TRACK_INSTRUMENT_DEVICE_PREFIX}${trackId}`;
}

export function instrumentIdFromDeviceKind(kind: string): FactoryInstrumentId | null {
  const id = kind.startsWith(FACTORY_INSTRUMENT_PREFIX) ? kind.slice(FACTORY_INSTRUMENT_PREFIX.length) : "";
  return factoryInstruments.some((preset) => preset.id === id) ? id as FactoryInstrumentId : null;
}

export function resolveTrackInstrument(project: Project, track: ProjectTrack): {
  id: FactoryInstrumentId;
  explicitDeviceKind?: string;
} {
  const device = project.devices.find((candidate) => candidate.id === instrumentDeviceId(track.id))
    ?? project.devices.find((candidate) => candidate.id === `${LEGACY_TRACK_INSTRUMENT_DEVICE_PREFIX}${track.id}`);
  const explicit = device ? instrumentIdFromDeviceKind(device.kind) : null;
  if (explicit && device) return { id: explicit, explicitDeviceKind: device.kind };
  const fallback: Record<Waveform, FactoryInstrumentId> = {
    sine: "soft-keys",
    triangle: "warm-pad",
    saw: "analog-lead",
    square: "electric-bass",
  };
  return { id: fallback[track.waveform] };
}
