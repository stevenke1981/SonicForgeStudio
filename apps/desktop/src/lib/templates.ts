import type { Project, ProjectTrack } from "./tauri";
import type { TranslationKey } from "../i18n";

export type ProjectTemplateCategory = "starter" | "music" | "rhythm" | "electronic" | "sfx";

export interface ProjectTemplate {
  id: string;
  titleKey: TranslationKey;
  descriptionKey: TranslationKey;
  category: ProjectTemplateCategory;
  createProject: () => Project;
}

const SAMPLE_RATE = 48_000;
const PPQ = 960;

type InstrumentTrackOptions = {
  id: string;
  name: string;
  color: string;
  gain: number;
  pan: number;
  lengthBeats: number;
  notes: ProjectTrack["pattern"]["notes"];
  clipId: string;
  clipName: string;
  patternId: string;
  loopEnabled: boolean;
  waveform: ProjectTrack["waveform"];
};

function createBaseProject(id: string, name: string, bpm: number): Project {
  return {
    schemaVersion: 1,
    id,
    name,
    sampleRate: SAMPLE_RATE,
    ppq: PPQ,
    bpm,
    tempoMap: [{ tick: 0, bpm }],
    timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }],
    tracks: [],
    devices: [],
    automation: [],
    assets: [],
  };
}

function createInstrumentTrack(options: InstrumentTrackOptions): ProjectTrack {
  return {
    id: options.id,
    name: options.name,
    kind: "instrument",
    color: options.color,
    gain: options.gain,
    pan: options.pan,
    muted: false,
    solo: false,
    armed: false,
    pattern: {
      lengthBeats: options.lengthBeats,
      notes: options.notes,
    },
    clips: [{
      id: options.clipId,
      name: options.clipName,
      startTick: 0,
      lengthTicks: options.lengthBeats * PPQ,
      patternId: options.patternId,
      loopEnabled: options.loopEnabled,
    }],
    waveform: options.waveform,
  };
}

function createInstrumentDevice(trackId: string, preset: string, parameters: Record<string, number> = {}): Project["devices"][number] {
  return {
    id: `instrument-${trackId}`,
    kind: `builtin.instrument.${preset}`,
    parameters,
  };
}

function createTwinkleProject(): Project {
  const project = createBaseProject("template-twinkle-twinkle", "Twinkle Twinkle Little Star", 100);
  const melody = [
    [60, 1], [60, 1], [67, 1], [67, 1], [69, 1], [69, 1], [67, 2],
    [65, 1], [65, 1], [64, 1], [64, 1], [62, 1], [62, 1], [60, 2],
    [67, 1], [67, 1], [65, 1], [65, 1], [64, 1], [64, 1], [62, 2],
    [67, 1], [67, 1], [65, 1], [65, 1], [64, 1], [64, 1], [62, 2],
    [60, 1], [60, 1], [67, 1], [67, 1], [69, 1], [69, 1], [67, 2],
    [65, 1], [65, 1], [64, 1], [64, 1], [62, 1], [62, 1], [60, 2],
  ] as const;
  let startBeat = 0;

  const track: ProjectTrack = {
    id: "twinkle-lead",
    name: "Twinkle Lead",
    kind: "instrument",
    color: "#60d9d2",
    gain: 0.72,
    pan: 0,
    muted: false,
    solo: false,
    armed: false,
    pattern: {
      lengthBeats: 48,
      notes: melody.map(([midiNote, lengthBeats]) => {
        const note = { startBeat, lengthBeats, midiNote, velocity: 0.78 };
        startBeat += lengthBeats;
        return note;
      }),
    },
    clips: [{
      id: "twinkle-clip",
      name: "Twinkle Melody",
      startTick: 0,
      lengthTicks: 48 * PPQ,
      patternId: "twinkle-pattern",
      loopEnabled: false,
    }],
    waveform: "triangle",
  };

  return {
    ...project,
    tracks: [track],
    devices: [{ id: "instrument-twinkle-lead", kind: "builtin.instrument.soft-keys", parameters: {} }],
  };
}

function createFourBeatDrumsProject(): Project {
  const project = createBaseProject("template-four-beat-drums", "Four Beat Drum Kit", 120);
  const notes = [
    { startBeat: 0, lengthBeats: 0.25, midiNote: 36, velocity: 1 },
    { startBeat: 0, lengthBeats: 0.25, midiNote: 42, velocity: 0.62 },
    { startBeat: 0.5, lengthBeats: 0.25, midiNote: 42, velocity: 0.48 },
    { startBeat: 1, lengthBeats: 0.25, midiNote: 38, velocity: 0.92 },
    { startBeat: 1, lengthBeats: 0.25, midiNote: 42, velocity: 0.64 },
    { startBeat: 1.5, lengthBeats: 0.25, midiNote: 42, velocity: 0.48 },
    { startBeat: 2, lengthBeats: 0.25, midiNote: 36, velocity: 0.96 },
    { startBeat: 2, lengthBeats: 0.25, midiNote: 42, velocity: 0.62 },
    { startBeat: 2.5, lengthBeats: 0.25, midiNote: 42, velocity: 0.48 },
    { startBeat: 3, lengthBeats: 0.25, midiNote: 38, velocity: 0.92 },
    { startBeat: 3, lengthBeats: 0.25, midiNote: 42, velocity: 0.64 },
    { startBeat: 3.5, lengthBeats: 0.25, midiNote: 42, velocity: 0.48 },
  ];

  return {
    ...project,
    tracks: [{
      id: "four-beat-drums",
      name: "Four Beat Drums",
      kind: "instrument",
      color: "#f6b74a",
      gain: 0.8,
      pan: 0,
      muted: false,
      solo: false,
      armed: false,
      pattern: { lengthBeats: 4, notes },
      clips: [{
        id: "four-beat-drums-clip",
        name: "Four Beat Groove",
        startTick: 0,
        lengthTicks: 4 * PPQ,
        patternId: "four-beat-drums-pattern",
        loopEnabled: true,
      }],
      waveform: "square",
    }],
    devices: [{ id: "instrument-four-beat-drums", kind: "builtin.instrument.drum-kit", parameters: { gain: 0.8 } }],
  };
}

function createChiptuneLoopProject(): Project {
  const project = createBaseProject("template-chiptune-loop", "Chiptune Loop", 150);

  return {
    ...project,
    tracks: [
      {
        id: "chiptune-lead",
        name: "Pulse Lead",
        kind: "instrument",
        color: "#b88cff",
        gain: 0.58,
        pan: 0.12,
        muted: false,
        solo: false,
        armed: false,
        pattern: {
          lengthBeats: 8,
          notes: [72, 76, 79, 76, 74, 77, 81, 77].map((midiNote, startBeat) => ({
            startBeat,
            lengthBeats: 0.75,
            midiNote,
            velocity: 0.72,
          })),
        },
        clips: [{
          id: "chiptune-lead-clip",
          name: "Pulse Lead Loop",
          startTick: 0,
          lengthTicks: 8 * PPQ,
          patternId: "chiptune-lead-pattern",
          loopEnabled: true,
        }],
        waveform: "square",
      },
      {
        id: "chiptune-bass",
        name: "Chip Bass",
        kind: "instrument",
        color: "#60d9d2",
        gain: 0.66,
        pan: -0.08,
        muted: false,
        solo: false,
        armed: false,
        pattern: {
          lengthBeats: 8,
          notes: [48, 48, 45, 45].map((midiNote, index) => ({
            startBeat: index * 2,
            lengthBeats: 1.75,
            midiNote,
            velocity: 0.82,
          })),
        },
        clips: [{
          id: "chiptune-bass-clip",
          name: "Chip Bass Loop",
          startTick: 0,
          lengthTicks: 8 * PPQ,
          patternId: "chiptune-bass-pattern",
          loopEnabled: true,
        }],
        waveform: "square",
      },
    ],
    devices: [
      { id: "instrument-chiptune-lead", kind: "builtin.instrument.analog-lead", parameters: { pulseWidth: 0.25 } },
      { id: "instrument-chiptune-bass", kind: "builtin.instrument.electric-bass", parameters: { pulseWidth: 0.5 } },
    ],
  };
}

function createSfxStarterProject(): Project {
  const project = createBaseProject("template-sfx-starter", "SFX Starter", 120);

  return {
    ...project,
    tracks: [{
      id: "sfx-trigger",
      name: "SFX Trigger",
      kind: "instrument",
      color: "#ef7aa8",
      gain: 0.7,
      pan: 0,
      muted: false,
      solo: false,
      armed: false,
      pattern: {
        lengthBeats: 4,
        notes: [{ startBeat: 0, lengthBeats: 0.5, midiNote: 60, velocity: 0.85 }],
      },
      clips: [{
        id: "sfx-trigger-clip",
        name: "SFX Trigger",
        startTick: 0,
        lengthTicks: 4 * PPQ,
        patternId: "sfx-trigger-pattern",
        loopEnabled: false,
      }],
      waveform: "sine",
    }],
    devices: [{
      id: "sfx-recipe",
      kind: "builtin.recipe.laser",
      parameters: { seed: 42, durationMs: 600, startHz: 1800, endHz: 120, peak: 0.9 },
    }, { id: "instrument-sfx-trigger", kind: "builtin.instrument.pluck", parameters: {} }],
  };
}

function createPianoBalladProject(): Project {
  const project = createBaseProject("template-piano-ballad", "Piano Ballad", 76);
  const keysTrackId = "piano-ballad-keys";
  const padTrackId = "piano-ballad-pad";
  const keysChords = [
    [60, 64, 67, 71],
    [57, 60, 64, 69],
    [53, 57, 60, 64],
    [55, 59, 62, 67],
  ];
  const keysNotes = keysChords.flatMap((chord, chordIndex) => chord.map((midiNote) => ({
    startBeat: chordIndex * 4,
    lengthBeats: 3.75,
    midiNote,
    velocity: 0.62 + chordIndex * 0.03,
  })));
  const padNotes = [
    [48, 55, 60, 64],
    [45, 52, 57, 60],
    [41, 48, 53, 57],
    [43, 50, 55, 59],
  ].flatMap((chord, chordIndex) => chord.map((midiNote) => ({
    startBeat: chordIndex * 4,
    lengthBeats: 4,
    midiNote,
    velocity: 0.38,
  })));

  return {
    ...project,
    tracks: [
      createInstrumentTrack({
        id: keysTrackId,
        name: "Soft Keys",
        color: "#60d9d2",
        gain: 0.72,
        pan: -0.08,
        lengthBeats: 16,
        notes: keysNotes,
        clipId: "piano-ballad-keys-clip",
        clipName: "Ballad Keys",
        patternId: "piano-ballad-keys-pattern",
        loopEnabled: true,
        waveform: "sine",
      }),
      createInstrumentTrack({
        id: padTrackId,
        name: "Warm Pad",
        color: "#b88cff",
        gain: 0.46,
        pan: 0.08,
        lengthBeats: 16,
        notes: padNotes,
        clipId: "piano-ballad-pad-clip",
        clipName: "Warm Pad Bed",
        patternId: "piano-ballad-pad-pattern",
        loopEnabled: true,
        waveform: "triangle",
      }),
    ],
    devices: [
      createInstrumentDevice(keysTrackId, "soft-keys"),
      createInstrumentDevice(padTrackId, "warm-pad", { attack: 0.55, release: 0.72 }),
    ],
  };
}

function createBassGrooveProject(): Project {
  const project = createBaseProject("template-bass-groove", "Bass Groove", 108);
  const bassTrackId = "bass-groove-bass";
  const drumsTrackId = "bass-groove-drums";
  const bassNotes = [
    [0, 36, 0.9], [1.5, 36, 0.4], [2.5, 43, 0.9], [3.5, 41, 0.4],
    [4, 36, 0.9], [5.5, 36, 0.4], [6.5, 45, 0.9], [7.5, 43, 0.4],
  ].map(([startBeat, midiNote, lengthBeats], index) => ({
    startBeat,
    lengthBeats,
    midiNote,
    velocity: index % 2 === 0 ? 0.86 : 0.68,
  }));
  const drumNotes = [
    { startBeat: 0, lengthBeats: 0.25, midiNote: 36, velocity: 0.98 },
    { startBeat: 0, lengthBeats: 0.12, midiNote: 42, velocity: 0.58 },
    { startBeat: 0.5, lengthBeats: 0.12, midiNote: 42, velocity: 0.46 },
    { startBeat: 1, lengthBeats: 0.25, midiNote: 38, velocity: 0.9 },
    { startBeat: 1, lengthBeats: 0.12, midiNote: 42, velocity: 0.62 },
    { startBeat: 1.5, lengthBeats: 0.12, midiNote: 42, velocity: 0.48 },
    { startBeat: 2, lengthBeats: 0.25, midiNote: 36, velocity: 0.94 },
    { startBeat: 2, lengthBeats: 0.12, midiNote: 42, velocity: 0.58 },
    { startBeat: 2.5, lengthBeats: 0.12, midiNote: 42, velocity: 0.46 },
    { startBeat: 3, lengthBeats: 0.25, midiNote: 38, velocity: 0.9 },
    { startBeat: 3, lengthBeats: 0.12, midiNote: 42, velocity: 0.62 },
    { startBeat: 3.5, lengthBeats: 0.12, midiNote: 42, velocity: 0.48 },
    { startBeat: 4, lengthBeats: 0.25, midiNote: 36, velocity: 0.98 },
    { startBeat: 4, lengthBeats: 0.12, midiNote: 42, velocity: 0.58 },
    { startBeat: 4.5, lengthBeats: 0.12, midiNote: 42, velocity: 0.46 },
    { startBeat: 5, lengthBeats: 0.25, midiNote: 38, velocity: 0.9 },
    { startBeat: 5, lengthBeats: 0.12, midiNote: 42, velocity: 0.62 },
    { startBeat: 5.5, lengthBeats: 0.12, midiNote: 42, velocity: 0.48 },
    { startBeat: 6, lengthBeats: 0.25, midiNote: 36, velocity: 0.94 },
    { startBeat: 6, lengthBeats: 0.12, midiNote: 42, velocity: 0.58 },
    { startBeat: 6.5, lengthBeats: 0.12, midiNote: 42, velocity: 0.46 },
    { startBeat: 7, lengthBeats: 0.25, midiNote: 38, velocity: 0.9 },
    { startBeat: 7, lengthBeats: 0.12, midiNote: 42, velocity: 0.62 },
    { startBeat: 7.5, lengthBeats: 0.12, midiNote: 42, velocity: 0.48 },
  ];

  return {
    ...project,
    tracks: [
      createInstrumentTrack({
        id: bassTrackId,
        name: "Electric Bass",
        color: "#f6b74a",
        gain: 0.78,
        pan: -0.12,
        lengthBeats: 8,
        notes: bassNotes,
        clipId: "bass-groove-bass-clip",
        clipName: "Bass Groove",
        patternId: "bass-groove-bass-pattern",
        loopEnabled: true,
        waveform: "square",
      }),
      createInstrumentTrack({
        id: drumsTrackId,
        name: "Drum Kit",
        color: "#f6b74a",
        gain: 0.74,
        pan: 0.04,
        lengthBeats: 8,
        notes: drumNotes,
        clipId: "bass-groove-drums-clip",
        clipName: "Pocket Drums",
        patternId: "bass-groove-drums-pattern",
        loopEnabled: true,
        waveform: "square",
      }),
    ],
    devices: [
      createInstrumentDevice(bassTrackId, "electric-bass", { drive: 0.18 }),
      createInstrumentDevice(drumsTrackId, "drum-kit", { gain: 0.82 }),
    ],
  };
}

function createSynthwaveProject(): Project {
  const project = createBaseProject("template-synthwave", "Synthwave", 112);
  const leadTrackId = "synthwave-lead";
  const bassTrackId = "synthwave-bass";
  const drumsTrackId = "synthwave-drums";
  const leadNotes = [72, 79, 81, 79, 74, 81, 84, 81].map((midiNote, startBeat) => ({
    startBeat,
    lengthBeats: 0.75,
    midiNote,
    velocity: 0.76,
  }));
  const bassNotes = [36, 36, 43, 41].map((midiNote, index) => ({
    startBeat: index * 2,
    lengthBeats: 1.75,
    midiNote,
    velocity: 0.82,
  }));
  const drumNotes = [
    ...[0, 2, 4, 6].map((startBeat) => ({ startBeat, lengthBeats: 0.25, midiNote: 36, velocity: 0.95 })),
    ...[1, 3, 5, 7].map((startBeat) => ({ startBeat, lengthBeats: 0.25, midiNote: 38, velocity: 0.86 })),
    ...Array.from({ length: 16 }, (_, index) => ({
      startBeat: index * 0.5,
      lengthBeats: 0.12,
      midiNote: 42,
      velocity: index % 2 === 0 ? 0.64 : 0.46,
    })),
  ];

  return {
    ...project,
    tracks: [
      createInstrumentTrack({
        id: leadTrackId,
        name: "Analog Lead",
        color: "#60d9d2",
        gain: 0.62,
        pan: 0.14,
        lengthBeats: 8,
        notes: leadNotes,
        clipId: "synthwave-lead-clip",
        clipName: "Neon Lead",
        patternId: "synthwave-lead-pattern",
        loopEnabled: true,
        waveform: "saw",
      }),
      createInstrumentTrack({
        id: bassTrackId,
        name: "Electric Bass",
        color: "#b88cff",
        gain: 0.7,
        pan: -0.12,
        lengthBeats: 8,
        notes: bassNotes,
        clipId: "synthwave-bass-clip",
        clipName: "Neon Bass",
        patternId: "synthwave-bass-pattern",
        loopEnabled: true,
        waveform: "square",
      }),
      createInstrumentTrack({
        id: drumsTrackId,
        name: "Drum Kit",
        color: "#f6b74a",
        gain: 0.72,
        pan: 0,
        lengthBeats: 8,
        notes: drumNotes,
        clipId: "synthwave-drums-clip",
        clipName: "Neon Drums",
        patternId: "synthwave-drums-pattern",
        loopEnabled: true,
        waveform: "square",
      }),
    ],
    devices: [
      createInstrumentDevice(leadTrackId, "analog-lead", { pulseWidth: 0.34 }),
      createInstrumentDevice(bassTrackId, "electric-bass", { pulseWidth: 0.5 }),
      createInstrumentDevice(drumsTrackId, "drum-kit", { gain: 0.8 }),
    ],
  };
}

function createCinematicProject(): Project {
  const project = createBaseProject("template-cinematic", "Cinematic", 68);
  const padTrackId = "cinematic-pad";
  const bellTrackId = "cinematic-bell";
  const pluckTrackId = "cinematic-pluck";
  const padNotes = [
    [48, 55, 60, 64],
    [46, 53, 58, 62],
    [43, 50, 55, 60],
    [41, 48, 53, 57],
  ].flatMap((chord, chordIndex) => chord.map((midiNote) => ({
    startBeat: chordIndex * 4,
    lengthBeats: 4,
    midiNote,
    velocity: 0.34,
  })));
  const bellNotes = [72, 79, 76, 84, 81, 76, 79, 86].map((midiNote, index) => ({
    startBeat: index * 2,
    lengthBeats: 1.25,
    midiNote,
    velocity: index % 4 === 0 ? 0.78 : 0.62,
  }));
  const pluckNotes = [60, 67, 64, 71, 62, 69, 65, 72].map((midiNote, index) => ({
    startBeat: index * 2,
    lengthBeats: 0.6,
    midiNote,
    velocity: 0.5,
  }));

  return {
    ...project,
    tracks: [
      createInstrumentTrack({
        id: padTrackId,
        name: "Warm Pad",
        color: "#b88cff",
        gain: 0.5,
        pan: 0,
        lengthBeats: 16,
        notes: padNotes,
        clipId: "cinematic-pad-clip",
        clipName: "Cinematic Bed",
        patternId: "cinematic-pad-pattern",
        loopEnabled: true,
        waveform: "triangle",
      }),
      createInstrumentTrack({
        id: bellTrackId,
        name: "Bell",
        color: "#60d9d2",
        gain: 0.58,
        pan: 0.16,
        lengthBeats: 16,
        notes: bellNotes,
        clipId: "cinematic-bell-clip",
        clipName: "Cinematic Bell",
        patternId: "cinematic-bell-pattern",
        loopEnabled: true,
        waveform: "sine",
      }),
      createInstrumentTrack({
        id: pluckTrackId,
        name: "Pluck",
        color: "#f6b74a",
        gain: 0.42,
        pan: -0.16,
        lengthBeats: 16,
        notes: pluckNotes,
        clipId: "cinematic-pluck-clip",
        clipName: "Cinematic Pulse",
        patternId: "cinematic-pluck-pattern",
        loopEnabled: true,
        waveform: "triangle",
      }),
    ],
    devices: [
      createInstrumentDevice(padTrackId, "warm-pad", { attack: 0.72, release: 0.9 }),
      createInstrumentDevice(bellTrackId, "bell", { decay: 0.82 }),
      createInstrumentDevice(pluckTrackId, "pluck", { decay: 0.46 }),
    ],
  };
}

export const projectTemplates: readonly ProjectTemplate[] = [
  {
    id: "blank-project",
    titleKey: "templates.blank.title",
    descriptionKey: "templates.blank.description",
    category: "starter",
    createProject: () => createBaseProject("template-blank-project", "Untitled Project", 120),
  },
  {
    id: "twinkle-twinkle",
    titleKey: "templates.twinkle.title",
    descriptionKey: "templates.twinkle.description",
    category: "music",
    createProject: createTwinkleProject,
  },
  {
    id: "four-beat-drums",
    titleKey: "templates.fourBeatDrums.title",
    descriptionKey: "templates.fourBeatDrums.description",
    category: "rhythm",
    createProject: createFourBeatDrumsProject,
  },
  {
    id: "chiptune-loop",
    titleKey: "templates.chiptune.title",
    descriptionKey: "templates.chiptune.description",
    category: "electronic",
    createProject: createChiptuneLoopProject,
  },
  {
    id: "sfx-starter",
    titleKey: "templates.sfxStarter.title",
    descriptionKey: "templates.sfxStarter.description",
    category: "sfx",
    createProject: createSfxStarterProject,
  },
  {
    id: "piano-ballad",
    titleKey: "templates.pianoBallad.title" as TranslationKey,
    descriptionKey: "templates.pianoBallad.description" as TranslationKey,
    category: "music",
    createProject: createPianoBalladProject,
  },
  {
    id: "bass-groove",
    titleKey: "templates.bassGroove.title" as TranslationKey,
    descriptionKey: "templates.bassGroove.description" as TranslationKey,
    category: "rhythm",
    createProject: createBassGrooveProject,
  },
  {
    id: "synthwave",
    titleKey: "templates.synthwave.title" as TranslationKey,
    descriptionKey: "templates.synthwave.description" as TranslationKey,
    category: "electronic",
    createProject: createSynthwaveProject,
  },
  {
    id: "cinematic",
    titleKey: "templates.cinematic.title" as TranslationKey,
    descriptionKey: "templates.cinematic.description" as TranslationKey,
    category: "music",
    createProject: createCinematicProject,
  },
];
