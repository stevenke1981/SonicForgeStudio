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

  return { ...project, tracks: [track] };
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
    devices: [{ id: "four-beat-drum-kit", kind: "builtin.drum-kit", parameters: { gain: 0.8 } }],
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
      { id: "chiptune-lead-synth", kind: "builtin.synth", parameters: { pulseWidth: 0.25 } },
      { id: "chiptune-bass-synth", kind: "builtin.synth", parameters: { pulseWidth: 0.5 } },
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
    }],
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
];
