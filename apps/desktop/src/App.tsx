import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import { AudioSettingsDialog } from "./components/AudioSettingsDialog";
import { PianoRoll } from "./components/PianoRoll";
import { ProjectControls } from "./components/ProjectControls";
import { StepSequencer } from "./components/StepSequencer";
import { createDefaultStepPattern } from "./components/stepSequencerModel";
import type { StepPattern } from "./components/stepSequencerModel";
import { TemplateGallery } from "./components/TemplateGallery";
import { I18nProvider, localeDisplayNames, locales, useI18n, useTranslation } from "./i18n";
import type { Locale, TranslationKey } from "./i18n";
import { BoundedHistory } from "./lib/history";
import {
  createDemoProject,
  exportProjectWav,
  getProjectDurationSamples,
  getTransportPosition,
  isSafeFileName,
  loadDesktopState,
  recoverProject,
  startTransport,
  transportPause,
  transportPlay,
  transportSeek,
  transportStop,
  writeRecoveryJournal,
} from "./lib/tauri";
import { initialPianoNotes } from "./lib/pianoRoll";
import type { PianoNote } from "./lib/pianoRoll";
import {
  factoryInstruments,
  getFactoryInstrument,
  instrumentDeviceId,
  resolveTrackInstrument,
} from "./lib/instruments";
import type { FactoryInstrumentId } from "./lib/instruments";
import {
  formatTransportTime,
  projectBeatToSamples,
  projectSamplesToBeat,
  projectTimelineBeats,
} from "./lib/transportTime";
import type { AudioStatus, DesktopState, ExportWavResult, Project, ProjectTrack, TransportPosition, Waveform } from "./lib/tauri";
import "./styles.css";

type Mode = "Music" | "SFX Lab" | "Mixer";
type MusicView = "Song Editor" | "Piano Roll" | "Step Sequencer";
type UiScale = 100 | 125 | 150 | 200;

type TransportCommand = "play" | "pause" | "stop";

type Clip = {
  id: number;
  modelId?: string;
  name: string;
  left: number;
  width: number;
  tone: "cyan" | "amber" | "violet";
  startTick?: number;
  lengthTicks?: number;
  patternId?: string | null;
  loopEnabled?: boolean;
};

type Track = {
  id: number;
  modelId?: string;
  name: string;
  icon: string;
  color: string;
  gain: number;
  pan: number;
  muted: boolean;
  clips: Clip[];
  instrumentId: FactoryInstrumentId;
  instrumentDeviceKind?: string;
  waveform: Waveform;
  patternNotes?: ProjectTrack["pattern"]["notes"];
};

const modes: Mode[] = ["Music", "SFX Lab", "Mixer"];

export type SfxRecipeId = "laserPulse" | "deepImpact" | "fastWhoosh" | "softUiClick" | "rainAmbience";
export type SfxMacros = { character: number; pitch: number; body: number; noise: number; space: number; length: number };

type SfxRecipe = {
  id: SfxRecipeId;
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
  instrumentId: FactoryInstrumentId;
  baseMidi: number;
  color: "cyan" | "amber" | "violet";
};

const SFX_RECIPES: readonly SfxRecipe[] = [
  { id: "laserPulse", labelKey: "browser.recipe.laserPulse", descriptionKey: "sfx.recipeDescription.laserPulse", instrumentId: "pluck", baseMidi: 76, color: "cyan" },
  { id: "deepImpact", labelKey: "browser.recipe.deepImpact", descriptionKey: "sfx.recipeDescription.deepImpact", instrumentId: "kick", baseMidi: 36, color: "amber" },
  { id: "fastWhoosh", labelKey: "browser.recipe.fastWhoosh", descriptionKey: "sfx.recipeDescription.fastWhoosh", instrumentId: "warm-pad", baseMidi: 55, color: "violet" },
  { id: "softUiClick", labelKey: "browser.recipe.softUiClick", descriptionKey: "sfx.recipeDescription.softUiClick", instrumentId: "bell", baseMidi: 84, color: "cyan" },
  { id: "rainAmbience", labelKey: "browser.recipe.rainAmbience", descriptionKey: "sfx.recipeDescription.rainAmbience", instrumentId: "hi-hat", baseMidi: 42, color: "violet" },
];

const DEFAULT_SFX_MACROS: SfxMacros = { character: 72, pitch: 68, body: 44, noise: 31, space: 58, length: 62 };

function stableSfxHash(recipeId: SfxRecipeId, seed: number, macros: SfxMacros): number {
  const input = `${recipeId}|${Math.round(seed)}|${Object.values(macros).map((value) => Math.round(value)).join(",")}`;
  let hash = 2166136261;
  for (const character of input) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
}

function createSfxPreviewProject(base: Project, recipeId: SfxRecipeId, seed: number, macros: SfxMacros): Project {
  const recipe = SFX_RECIPES.find((item) => item.id === recipeId) ?? SFX_RECIPES[0];
  const preset = getFactoryInstrument(recipe.instrumentId);
  const hash = stableSfxHash(recipe.id, seed, macros);
  const noteCount = 1 + (hash % 3);
  const spacing = 0.28 + (macros.space / 100) * 0.72;
  const pitchOffset = ((hash >>> 8) % 13) - 6 + Math.round((macros.pitch - 50) / 10);
  const notes = Array.from({ length: noteCount }, (_, index) => ({
    startBeat: Number((index * spacing).toFixed(4)),
    lengthBeats: Number(Math.max(0.08, 0.16 + macros.length / 100 * 1.4 - index * 0.04).toFixed(4)),
    midiNote: Math.max(0, Math.min(127, recipe.baseMidi + pitchOffset + (index * ((hash >>> 16) % 5)))),
    velocity: Math.max(0.12, Math.min(1, 0.42 + macros.body / 180 + ((hash >>> (index * 3)) % 20) / 100)),
  }));
  const lengthBeats = Math.max(1, notes.reduce((maximum, note) => Math.max(maximum, note.startBeat + note.lengthBeats), 0) + 0.35 + macros.space / 200);
  const trackId = `sfx-preview-${recipe.id}`;
  return {
    ...base,
    id: `sfx-preview-${recipe.id}-${Math.round(seed)}-${hash}`,
    name: `SFX Preview ${recipe.id}`,
    tracks: [{
      id: trackId,
      name: `SFX ${recipe.id}`,
      kind: "instrument",
      color: recipe.color === "amber" ? "#f1bf70" : recipe.color === "violet" ? "#b99aff" : "#60d9d2",
      gain: 0.75,
      pan: 0,
      muted: false,
      solo: false,
      armed: false,
      pattern: { lengthBeats, notes },
      clips: [{ id: `${trackId}-clip`, name: `${recipe.id} preview`, startTick: 0, lengthTicks: Math.ceil(lengthBeats * base.ppq), patternId: `${trackId}-pattern`, loopEnabled: false }],
      waveform: preset.waveform,
    }],
    devices: [{
      id: instrumentDeviceId(trackId),
      kind: preset.deviceKind,
      parameters: { seed: Math.round(seed), character: macros.character, pitch: macros.pitch, body: macros.body, noise: macros.noise, space: macros.space, length: macros.length },
    }],
  };
}

const browserItems = [
  { label: "Starred", symbol: "✦" },
  { label: "Instruments", symbol: "◌" },
  { label: "Drum kits", symbol: "◈" },
  { label: "SFX recipes", symbol: "⌁" },
  { label: "Effects", symbol: "◎" },
  { label: "Samples", symbol: "▧" },
  { label: "Presets", symbol: "◇" },
];

const initialTracks: Track[] = [
  {
    id: 1,
    name: "Lead Synth",
    icon: "◌",
    color: "cyan",
    gain: 0.72,
    pan: 0,
    muted: false,
    instrumentId: "analog-lead",
    instrumentDeviceKind: "builtin.instrument.analog-lead",
    waveform: "saw",
    patternNotes: initialPianoNotes.map((note) => projectNoteFromPiano(note, [])),
    clips: [{ id: 11, name: "Lead Pattern 01", left: 12, width: 230, tone: "cyan" }],
  },
  {
    id: 2,
    name: "Drum Machine",
    icon: "◈",
    color: "amber",
    gain: 0.64,
    pan: -0.08,
    muted: false,
    instrumentId: "drum-kit",
    instrumentDeviceKind: "builtin.instrument.drum-kit",
    waveform: "square",
    patternNotes: getFactoryInstrument("drum-kit").notes.map((note) => ({ ...note })),
    clips: [{ id: 21, name: "Drum Pattern A", left: 112, width: 286, tone: "amber" }],
  },
  {
    id: 3,
    name: "Laser FX",
    icon: "⌁",
    color: "violet",
    gain: 0.54,
    pan: 0.18,
    muted: false,
    instrumentId: "pluck",
    instrumentDeviceKind: "builtin.instrument.pluck",
    waveform: "triangle",
    patternNotes: getFactoryInstrument("pluck").notes.map((note) => ({ ...note })),
    clips: [{ id: 31, name: "Laser Seed 42", left: 12, width: 130, tone: "violet" }],
  },
];

const fallbackAudio: AudioStatus = {
  state: "unavailable",
  deviceName: null,
  sampleRate: 48_000,
  bufferSize: 256,
  xrunCount: 0,
  engineAvailable: false,
};

function pianoNoteFromProject(note: ProjectTrack["pattern"]["notes"][number], index: number): PianoNote {
  return {
    id: index + 1,
    pitch: note.midiNote,
    tick: Math.round(note.startBeat * 4),
    duration: Math.max(1, Math.round(note.lengthBeats * 4)),
    velocity: Math.max(1, Math.min(127, Math.round(note.velocity * 127))),
  };
}

function projectNoteFromPiano(note: PianoNote, baseNotes: ProjectTrack["pattern"]["notes"]): ProjectTrack["pattern"]["notes"][number] {
  const original = Number.isInteger(note.id) && note.id > 0 ? baseNotes[note.id - 1] : undefined;
  if (original) {
    const projected = pianoNoteFromProject(original, note.id - 1);
    if (
      projected.pitch === note.pitch
      && projected.tick === note.tick
      && projected.duration === note.duration
      && projected.velocity === note.velocity
    ) {
      return original;
    }
  }
  return {
    startBeat: note.tick / 4,
    lengthBeats: note.duration / 4,
    midiNote: note.pitch,
    velocity: note.velocity / 127,
  };
}

function notesFromStepPattern(pattern: StepPattern, bpm: number, existingNotes: ProjectTrack["pattern"]["notes"] = []): ProjectTrack["pattern"]["notes"] {
  const stepBeats = 4 / Math.max(1, pattern.length);
  const millisecondsPerBeat = 60_000 / Math.max(20, bpm);
  const fallbackMidiNote = existingNotes[0]?.midiNote ?? 36;
  return pattern.steps.slice(0, pattern.length).flatMap((step, index) => {
    if (!step.enabled || step.probability <= 0) return [];
    const ratchet = Math.max(1, Math.min(4, step.ratchet));
    const ratchetBeats = stepBeats / ratchet;
    const velocity = (step.velocity / 127) * (step.probability / 100);
    const existingAtStep = existingNotes.filter((note) =>
      Math.max(0, Math.min(pattern.length - 1, Math.round(note.startBeat / stepBeats))) === index,
    );
    const pitches = existingAtStep.length > 0
      ? existingAtStep.map((note) => note.midiNote)
      : [fallbackMidiNote];
    const outputCount = Math.max(ratchet, pitches.length);
    return Array.from({ length: outputCount }, (_, repeat) => ({
      startBeat: Math.max(0, index * stepBeats + (repeat % ratchet) * ratchetBeats + (step.microShift / millisecondsPerBeat)),
      lengthBeats: Math.max(0.03, ratchetBeats * 0.85),
      midiNote: pitches[repeat % pitches.length] ?? fallbackMidiNote,
      velocity,
    }));
  });
}

function stepPatternFromNotes(notes: ProjectTrack["pattern"]["notes"], bpm: number, length = 16): StepPattern {
  const pattern = createDefaultStepPattern(length);
  pattern.steps = pattern.steps.map((step) => ({ ...step, enabled: false, velocity: 1, ratchet: 1 }));
  const stepBeats = 4 / pattern.length;
  const millisecondsPerBeat = 60_000 / Math.max(20, bpm);
  const notesByStep = Array.from({ length: pattern.length }, () => [] as ProjectTrack["pattern"]["notes"]);
  for (const note of notes.filter((candidate) => candidate.startBeat < 4)) {
    const exactStep = note.startBeat / stepBeats;
    const index = Math.max(0, Math.min(pattern.length - 1, Math.round(exactStep)));
    notesByStep[index]?.push(note);
  }
  for (const [index, stepNotes] of notesByStep.entries()) {
    if (stepNotes.length === 0) continue;
    const step = pattern.steps[index];
    if (!step) continue;
    step.enabled = true;
    step.velocity = Math.max(1, ...stepNotes.map((note) => Math.round(note.velocity * 127)));
    step.probability = 100;
    const earliestStart = Math.min(...stepNotes.map((note) => note.startBeat));
    const exactStep = earliestStart / stepBeats;
    step.microShift = Math.max(-50, Math.min(50, Math.round((exactStep - index) * stepBeats * millisecondsPerBeat)));
    const distinctStarts = new Set(stepNotes.map((note) => note.startBeat.toFixed(6))).size;
    step.ratchet = Math.max(1, Math.min(4, distinctStarts)) as 1 | 2 | 3 | 4;
  }
  return pattern;
}

function sameStepState(left: StepPattern["steps"][number] | undefined, right: StepPattern["steps"][number] | undefined): boolean {
  return left?.enabled === right?.enabled
    && left?.velocity === right?.velocity
    && left?.probability === right?.probability
    && left?.microShift === right?.microShift
    && left?.ratchet === right?.ratchet;
}

function noteStepIndex(note: ProjectTrack["pattern"]["notes"][number], length: number): number {
  const safeLength = Math.max(1, length);
  const stepBeats = 4 / safeLength;
  return Math.max(0, Math.min(safeLength - 1, Math.round(note.startBeat / stepBeats)));
}

function clipStartTick(left: number, ppq: number): number {
  return Math.max(0, Math.round((left / 64) * ppq));
}

function clipLengthTicks(width: number, ppq: number): number {
  return Math.max(1, Math.round((width / 64) * ppq));
}

function nextClipNumericId(tracks: Track[]): number {
  return Math.max(0, ...tracks.flatMap((track) => track.clips.map((clip) => clip.id))) + 1;
}

function uniqueClipModelId(tracks: Track[], track: Track, numericId: number): string {
  const usedIds = new Set(tracks.flatMap((item) => item.clips.map((clip) => clip.modelId).filter((id): id is string => Boolean(id))));
  const stem = `${track.modelId ?? `track-${track.id}`}-clip-${numericId}`;
  let candidate = stem;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `${stem}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function buildProjectSnapshot(base: Project, bpm: number, tracks: Track[]): Project {
  const projectTracks: ProjectTrack[] = tracks.map((track, index) => {
    const baseTrack = (track.modelId ? base.tracks.find((item) => item.id === track.modelId) : undefined) ?? base.tracks[index];
    const modelTrackId = track.modelId ?? baseTrack?.id ?? `track-${track.id}`;
    const basePattern = baseTrack?.pattern;
    const notes = track.patternNotes ?? basePattern?.notes ?? [];
    const requiredPatternLength = notes.reduce((maximum, note) => Math.max(maximum, note.startBeat + note.lengthBeats), 0);
    return {
      id: modelTrackId,
      name: track.name,
      kind: baseTrack?.kind ?? "instrument",
      color: baseTrack?.color ?? (track.color === "amber" ? "#f1bf70" : track.color === "violet" ? "#b99aff" : "#60d9d2"),
      gain: track.gain,
      pan: track.pan,
      muted: track.muted,
      solo: baseTrack?.solo ?? false,
      armed: baseTrack?.armed ?? false,
      pattern: {
        lengthBeats: Math.max(basePattern?.lengthBeats ?? 16, requiredPatternLength),
        notes,
      },
      clips: track.clips.map((clip) => ({
        id: clip.modelId ?? `clip-${clip.id}`,
        name: clip.name,
        startTick: clip.startTick ?? clipStartTick(clip.left, base.ppq),
        lengthTicks: clip.lengthTicks ?? clipLengthTicks(clip.width, base.ppq),
        patternId: clip.patternId !== undefined ? clip.patternId : `${modelTrackId}-pattern`,
        loopEnabled: clip.loopEnabled ?? true,
      })),
      waveform: track.waveform,
    };
  });
  const explicitDeviceIds = new Set(
    projectTracks.flatMap((track, index) => tracks[index]?.instrumentDeviceKind
      ? [instrumentDeviceId(track.id), `instrument:${track.id}`]
      : []),
  );
  const factoryDevices = projectTracks.flatMap((track, index) => {
    const kind = tracks[index]?.instrumentDeviceKind;
    if (!kind) return [];
    const existing = base.devices.find((device) =>
      device.id === instrumentDeviceId(track.id) || device.id === `instrument:${track.id}`,
    );
    return [{ id: instrumentDeviceId(track.id), kind, parameters: existing?.parameters ?? {} }];
  });
  return {
    ...base,
    bpm,
    tempoMap: base.tempoMap.length > 0
      ? base.tempoMap.map((point, index) => index === 0 ? { ...point, bpm } : point)
      : [{ tick: 0, bpm }],
    tracks: projectTracks,
    devices: [
      ...base.devices.filter((device) => !explicitDeviceIds.has(device.id)),
      ...factoryDevices,
    ],
  };
}

function tracksFromProject(project: Project): Track[] {
  let nextClipId = 1;
  return project.tracks.map((track, index) => {
    const resolvedInstrument = resolveTrackInstrument(project, track);
    const preset = getFactoryInstrument(resolvedInstrument.id);
    return {
      id: index + 1,
      modelId: track.id,
      name: track.name,
      icon: track.kind === "audio" ? "▧" : track.kind === "bus" ? "▥" : preset.icon,
      color: track.color.toLowerCase().includes("bf70") ? "amber" : track.color.toLowerCase().includes("9aff") ? "violet" : "cyan",
      gain: track.gain,
      pan: track.pan,
      muted: track.muted,
      instrumentId: resolvedInstrument.id,
      instrumentDeviceKind: resolvedInstrument.explicitDeviceKind,
      waveform: track.waveform,
      patternNotes: track.pattern.notes.map((note) => ({ ...note })),
      clips: track.clips.map((clip) => ({
        id: nextClipId++,
        modelId: clip.id,
        name: clip.name,
        left: Math.round((clip.startTick / project.ppq) * 64),
        width: Math.max(40, Math.round((clip.lengthTicks / project.ppq) * 64)),
        tone: index % 3 === 1 ? "amber" : index % 3 === 2 ? "violet" : "cyan",
        startTick: clip.startTick,
        lengthTicks: clip.lengthTicks,
        patternId: clip.patternId,
        loopEnabled: clip.loopEnabled,
      })),
    };
  });
}

function usesNativeSpaceKey(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("input, select, button, textarea, [contenteditable]") !== null;
}

function usesNativeHistoryKey(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("input, select, textarea, [contenteditable]") !== null;
}

function AppContent() {
  const { locale, setLocale, t } = useI18n();
  const [mode, setMode] = useState<Mode>("Music");
  const [musicView, setMusicView] = useState<MusicView>("Song Editor");
  const [playing, setPlaying] = useState(false);
  const [transportPrepared, setTransportPrepared] = useState(false);
  const [transportProject, setTransportProject] = useState<Project | null>(null);
  const [, setTransportPosition] = useState<TransportPosition>({ positionSamples: 0, transportState: "stopped", deviceState: "stopped", durationSamples: 0 });
  const transportActivity = useRef({ playing: false, prepared: false });
  transportActivity.current = { playing, prepared: transportPrepared };
  const [playheadBeat, setPlayheadBeat] = useState(0);
  const [bpm, setBpm] = useState(120);
  const [tracks, setTracks] = useState<Track[]>(initialTracks);
  const [selectedTrackId, setSelectedTrackId] = useState(1);
  const [selectedClipId, setSelectedClipId] = useState(11);
  const [selectedBrowserItem, setSelectedBrowserItem] = useState("Starred");
  const [seed, setSeed] = useState(42);
  const [locked, setLocked] = useState(true);
  const [selectedSfxRecipe, setSelectedSfxRecipe] = useState<SfxRecipeId>("laserPulse");
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [timelineCleared, setTimelineCleared] = useState(false);
  const [toast, setToast] = useState(() => t("status.ready"));
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [audioSettingsOpen, setAudioSettingsOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [instrumentPickerOpen, setInstrumentPickerOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFileName, setExportFileName] = useState("");
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState("");
  const [exportResult, setExportResult] = useState<ExportWavResult | null>(null);
  const [uiScale, setUiScale] = useState<UiScale>(100);
  const [projectBase, setProjectBase] = useState<Project>(() => createDemoProject());
  const [transportSampleRate, setTransportSampleRate] = useState(projectBase.sampleRate);
  const [pianoNotes, setPianoNotes] = useState<PianoNote[]>(initialPianoNotes);
  const [projectLoadVersion, setProjectLoadVersion] = useState(0);
  const defaultStepPattern = useMemo(() => createDefaultStepPattern(16), []);
  const [stepPattern, setStepPattern] = useState<StepPattern>(defaultStepPattern);
  const stepHistory = useRef(new BoundedHistory<StepPattern>(defaultStepPattern, 200));
  const [desktop, setDesktop] = useState<DesktopState>({
    appInfo: {
      name: "SonicForge Studio",
      version: "0.1.0",
      platform: "browser-preview",
      shell: "web-preview",
    },
    audioStatus: fallbackAudio,
  });
  const nextClipId = useRef(nextClipNumericId(initialTracks));

  const announce = useCallback((message: string) => {
    setToast(message);
  }, []);

  const stopTransportForEdit = useCallback(() => {
    const shouldStop = transportActivity.current.playing || transportActivity.current.prepared;
    transportActivity.current = { playing: false, prepared: false };
    setTransportPrepared(false);
    setTransportProject(null);
    if (!shouldStop) return;
    setPlaying(false);
    void transportStop()
      .then((status) => setDesktop((current) => ({ ...current, audioStatus: status, error: undefined })))
      .catch(() => announce(t("status.audioUnavailable")));
  }, [announce, t]);

  const syncStepPatternToSelectedTrack = useCallback((nextPattern: StepPattern, previousPattern: StepPattern) => {
    const lengthChanged = nextPattern.length !== previousPattern.length;
    const changedSteps = new Set<number>();
    if (!lengthChanged) {
      for (let index = 0; index < nextPattern.length; index += 1) {
        if (!sameStepState(previousPattern.steps[index], nextPattern.steps[index])) {
          changedSteps.add(index);
        }
      }
    }

    setTracks((current) => current.map((track) => {
      if (track.id !== selectedTrackId) return track;
      if (lengthChanged) return track;
      const existingNotes = track.patternNotes ?? [];
      const sequencerWindow = existingNotes.filter((note) => note.startBeat < 4);
      const outsideWindow = existingNotes.filter((note) => note.startBeat >= 4);
      const rebuiltWindow = notesFromStepPattern(nextPattern, bpm, sequencerWindow);
      const nextNotes = [
        ...sequencerWindow.filter((note) => !changedSteps.has(noteStepIndex(note, previousPattern.length))),
        ...rebuiltWindow.filter((note) => changedSteps.has(noteStepIndex(note, nextPattern.length))),
      ];
      return {
        ...track,
        patternNotes: [...nextNotes, ...outsideWindow].sort((left, right) => left.startBeat - right.startBeat),
      };
    }));
  }, [bpm, selectedTrackId]);

  const applyStepPattern = useCallback((nextPattern: StepPattern, description: string) => {
    const selectedNotes = tracks.find((track) => track.id === selectedTrackId)?.patternNotes ?? [];
    const resolvedPattern = nextPattern.length === stepPattern.length
      ? nextPattern
      : { ...stepPatternFromNotes(selectedNotes, bpm, nextPattern.length), swing: nextPattern.swing };
    stepHistory.current.push(resolvedPattern);
    setStepPattern(resolvedPattern);
    syncStepPatternToSelectedTrack(resolvedPattern, stepPattern);
    stopTransportForEdit();
    setDirty(true);
    announce(description);
  }, [announce, bpm, selectedTrackId, stepPattern, stopTransportForEdit, syncStepPatternToSelectedTrack, tracks]);

  const undoStepPattern = useCallback(() => {
    const previous = stepHistory.current.undo();
    if (previous === undefined) return;
    setStepPattern(previous);
    syncStepPatternToSelectedTrack(previous, stepPattern);
    stopTransportForEdit();
    setDirty(stepHistory.current.canUndo);
    announce("Step change undone");
  }, [announce, stepPattern, stopTransportForEdit, syncStepPatternToSelectedTrack]);

  const redoStepPattern = useCallback(() => {
    const next = stepHistory.current.redo();
    if (next === undefined) return;
    setStepPattern(next);
    syncStepPatternToSelectedTrack(next, stepPattern);
    stopTransportForEdit();
    setDirty(true);
    announce("Step change redone");
  }, [announce, stepPattern, stopTransportForEdit, syncStepPatternToSelectedTrack]);

  useEffect(() => {
    let cancelled = false;
    loadDesktopState().then((state) => {
      if (!cancelled) {
        setDesktop(state);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const selectedTrack = useMemo(
    () => tracks.find((track) => track.id === selectedTrackId) ?? tracks[0],
    [selectedTrackId, tracks],
  );
  const selectedClip = selectedTrack?.clips.find((clip) => clip.id === selectedClipId);
  const audioStatus = desktop.audioStatus ?? fallbackAudio;
  const modeLabel = (value: Mode) => value === "Music" ? t("app.mode.music") : value === "SFX Lab" ? t("app.mode.sfxLab") : t("app.mode.mixer");
  const editorLabel = (value: MusicView) => value === "Song Editor" ? t("app.editor.song") : value === "Piano Roll" ? t("app.editor.pianoRoll") : t("app.editor.stepSequencer");
  const browserLabel = (value: string) => ({
    Starred: t("browser.starred"), Instruments: t("browser.instruments"), "Drum kits": t("browser.drumKits"),
    "SFX recipes": t("browser.sfxRecipes"), Effects: t("browser.effects"), Samples: t("browser.samples"), Presets: t("browser.presets"),
  })[value] ?? value;
  const projectSnapshot = useMemo(() => buildProjectSnapshot(projectBase, bpm, tracks), [bpm, projectBase, tracks]);
  const timelineBeats = useMemo(() => projectTimelineBeats(projectSnapshot), [projectSnapshot]);
  const previousProjectSnapshot = useRef(projectSnapshot);

  useEffect(() => {
    if (previousProjectSnapshot.current === projectSnapshot) return;
    previousProjectSnapshot.current = projectSnapshot;
    const shouldReleaseTransport = transportActivity.current.playing || transportActivity.current.prepared;
    setTransportPrepared(false);
    setTransportProject(null);
    if (!shouldReleaseTransport) return;
    setPlaying(false);
    void transportStop()
      .then((status) => setDesktop((current) => ({ ...current, audioStatus: status, error: undefined })))
      .catch(() => announce(t("status.audioUnavailable")));
  }, [announce, projectSnapshot, t]);

  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => {
      void writeRecoveryJournal(projectSnapshot).catch(() => undefined);
    }, 750);
    return () => window.clearTimeout(timer);
  }, [dirty, projectSnapshot]);

  const loadProjectIntoUi = useCallback((project: Project) => {
    stopTransportForEdit();
    setProjectBase(project);
    setBpm(project.bpm);
    setTransportSampleRate(project.sampleRate);
    const loadedTracks = tracksFromProject(project);
    nextClipId.current = nextClipNumericId(loadedTracks);
    setTracks(loadedTracks);
    if (loadedTracks.length > 0) {
      setSelectedTrackId(loadedTracks[0].id);
      setSelectedClipId(loadedTracks[0].clips[0]?.id ?? 0);
    } else {
      setSelectedTrackId(0);
      setSelectedClipId(0);
    }
    const loadedNotes = project.tracks[0]?.pattern.notes.map(pianoNoteFromProject);
    setPianoNotes(loadedNotes ?? []);
    const resetStepPattern = stepPatternFromNotes(project.tracks[0]?.pattern.notes ?? [], project.bpm);
    stepHistory.current.reset(resetStepPattern);
    setStepPattern(resetStepPattern);
    setPlayheadBeat(0);
    setTransportPrepared(false);
    setProjectLoadVersion((version) => version + 1);
  }, [stopTransportForEdit]);

  useEffect(() => {
    let cancelled = false;
    recoverProject().then((project) => {
      if (!cancelled && project) {
        loadProjectIntoUi(project);
        setDirty(true);
        announce(t("status.recovered"));
      }
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [announce, loadProjectIntoUi, t]);

  const markDirty = useCallback((message: string) => {
    stopTransportForEdit();
    setDirty(true);
    announce(message);
  }, [announce, stopTransportForEdit]);

  const selectTrack = useCallback((trackId: number) => {
    const track = tracks.find((candidate) => candidate.id === trackId);
    setSelectedTrackId(trackId);
    if (!track) return;
    const notes = track.patternNotes ?? [];
    setPianoNotes(notes.map(pianoNoteFromProject));
    const selectedPattern = stepPatternFromNotes(notes, bpm);
    stepHistory.current.reset(selectedPattern);
    setStepPattern(selectedPattern);
    if (track.clips[0]) setSelectedClipId(track.clips[0].id);
  }, [bpm, tracks]);

  const updateSelectedTrackPianoNotes = useCallback((nextNotes: PianoNote[]) => {
    setPianoNotes(nextNotes);
    setTracks((current) => current.map((track) => {
      if (track.id !== selectedTrackId) return track;
      const baseNotes = track.patternNotes ?? [];
      const patternNotes = nextNotes.map((note) => projectNoteFromPiano(note, baseNotes));
      const unchanged = patternNotes.length === baseNotes.length && patternNotes.every((note, index) => {
        const previous = baseNotes[index];
        return previous !== undefined
          && note.startBeat === previous.startBeat
          && note.lengthBeats === previous.lengthBeats
          && note.midiNote === previous.midiNote
          && note.velocity === previous.velocity;
      });
      return unchanged ? track : { ...track, patternNotes };
    }));
  }, [selectedTrackId]);

  const loadTemplate = useCallback((project: Project) => {
    loadProjectIntoUi(project);
    setMode("Music");
    setMusicView("Piano Roll");
    setDirty(true);
    setTemplatesOpen(false);
    announce(t("status.templateLoaded"));
  }, [announce, loadProjectIntoUi, t]);

  const updateTrack = (trackId: number, patch: Partial<Track>) => {
    stopTransportForEdit();
    setTracks((current) => current.map((track) => (track.id === trackId ? { ...track, ...patch } : track)));
    setDirty(true);
  };

  const updateClip = (trackId: number, clipId: number, patch: Partial<Clip>) => {
    stopTransportForEdit();
    setTracks((current) =>
      current.map((track) =>
        track.id === trackId
          ? {
              ...track,
              clips: track.clips.map((clip) => {
                if (clip.id !== clipId) return clip;
                const next = { ...clip, ...patch };
                if (patch.left !== undefined) next.startTick = clipStartTick(patch.left, projectBase.ppq);
                if (patch.width !== undefined) next.lengthTicks = clipLengthTicks(patch.width, projectBase.ppq);
                return next;
              }),
            }
          : track,
      ),
    );
    setDirty(true);
  };

  const addInstrument = (instrumentId: FactoryInstrumentId) => {
    stopTransportForEdit();
    const preset = getFactoryInstrument(instrumentId);
    const trackId = Math.max(0, ...tracks.map((track) => track.id)) + 1;
    const clipId = nextClipId.current++;
    const modelId = `factory-${instrumentId}-${trackId}`;
    const track: Track = {
      id: trackId,
      modelId,
      name: t(preset.nameKey),
      icon: preset.icon,
      color: preset.color,
      gain: instrumentId === "drum-kit" || instrumentId === "kick" || instrumentId === "snare" || instrumentId === "hi-hat" ? 0.72 : 0.58,
      pan: 0,
      muted: false,
      instrumentId,
      instrumentDeviceKind: preset.deviceKind,
      waveform: preset.waveform,
      patternNotes: preset.notes.map((note) => ({ ...note })),
      clips: [{
        id: clipId,
        modelId: `${modelId}-clip`,
        name: `${t(preset.nameKey)} Pattern`,
        left: 124,
        width: 256,
        tone: preset.color,
        startTick: 0,
        lengthTicks: 4 * projectBase.ppq,
        patternId: `${modelId}-pattern`,
        loopEnabled: true,
      }],
    };
    setTracks((current) => [...current, track]);
    setSelectedTrackId(trackId);
    setSelectedClipId(clipId);
    const pianoEditorNotes = track.patternNotes?.map(pianoNoteFromProject) ?? [];
    setPianoNotes(pianoEditorNotes);
    const sequencerPattern = stepPatternFromNotes(track.patternNotes ?? [], bpm);
    stepHistory.current.reset(sequencerPattern);
    setStepPattern(sequencerPattern);
    setTimelineCleared(false);
    setMode("Music");
    setMusicView("Song Editor");
    setInstrumentPickerOpen(false);
    setDirty(true);
    announce(t("template.instrumentAdded", { name: t(preset.nameKey) }));
  };

  const changeTrackInstrument = (trackId: number, instrumentId: FactoryInstrumentId) => {
    const preset = getFactoryInstrument(instrumentId);
    updateTrack(trackId, {
      instrumentId,
      instrumentDeviceKind: preset.deviceKind,
      waveform: preset.waveform,
      icon: preset.icon,
    });
    setPlaying(false);
    setTransportPrepared(false);
    announce(t("template.instrumentChanged", { name: t(preset.nameKey) }));
  };

  const addClip = () => {
    if (!selectedTrack) return;
    const id = nextClipId.current++;
    const left = 260;
    const width = 160;
    const clip: Clip = {
      id,
      modelId: uniqueClipModelId(tracks, selectedTrack, id),
      name: t("song.newPattern"),
      left,
      width,
      tone: "cyan",
      startTick: clipStartTick(left, projectBase.ppq),
      lengthTicks: clipLengthTicks(width, projectBase.ppq),
      patternId: `${selectedTrack.modelId ?? `track-${selectedTrack.id}`}-pattern`,
      loopEnabled: true,
    };
    setTracks((current) =>
      current.map((track) => (track.id === selectedTrackId ? { ...track, clips: [...track.clips, clip] } : track)),
    );
    setTimelineCleared(false);
    setSelectedClipId(id);
    markDirty(t("status.newClip"));
  };

  const duplicateClip = () => {
    if (!selectedTrack || !selectedClip) return;
    const id = nextClipId.current++;
    const left = selectedClip.left + selectedClip.width + 12;
    const copy = {
      ...selectedClip,
      id,
      modelId: uniqueClipModelId(tracks, selectedTrack, id),
      name: `${selectedClip.name} copy`,
      left,
      startTick: clipStartTick(left, projectBase.ppq),
    };
    updateTrack(selectedTrack.id, { clips: [...selectedTrack.clips, copy] });
    setSelectedClipId(id);
    markDirty(t("status.clipDuplicated"));
  };

  const splitClip = () => {
    if (!selectedTrack || !selectedClip || selectedClip.width < 44) return;
    const leftWidth = Math.round(selectedClip.width / 2 - 4);
    const rightId = nextClipId.current++;
    const rightLeft = selectedClip.left + leftWidth + 8;
    const rightWidth = selectedClip.width - leftWidth - 8;
    const right: Clip = {
      ...selectedClip,
      id: rightId,
      modelId: uniqueClipModelId(tracks, selectedTrack, rightId),
      name: `${selectedClip.name} / B`,
      left: rightLeft,
      width: rightWidth,
      startTick: clipStartTick(rightLeft, projectBase.ppq),
      lengthTicks: clipLengthTicks(rightWidth, projectBase.ppq),
    };
    updateTrack(selectedTrack.id, {
      clips: selectedTrack.clips.flatMap((clip) =>
        clip.id === selectedClip.id
          ? [{ ...clip, name: `${clip.name} / A`, width: leftWidth, lengthTicks: clipLengthTicks(leftWidth, projectBase.ppq) }, right]
          : [clip],
      ),
    });
    setSelectedClipId(rightId);
    markDirty(t("status.clipSplit"));
  };

  const moveClip = (event: DragEvent<HTMLButtonElement>, trackId: number, clipId: number) => {
    const clip = tracks.flatMap((track) => track.clips).find((item) => item.id === clipId);
    if (!clip) return;
    updateClip(trackId, clipId, { left: Math.max(8, clip.left + (event.clientX ? 16 : 0)) });
    markDirty(t("status.clipMoved"));
  };

  const randomize = () => {
    setSeed((value) => (locked ? value : value + 17));
    announce(locked ? t("status.seedLocked") : t("status.newSeed"));
  };

  const freezeSfx = () => {
    setMode("Music");
    addClip();
    announce(t("status.sfxFrozen", { seed, recipe: t(SFX_RECIPES.find((recipe) => recipe.id === selectedSfxRecipe)?.labelKey ?? SFX_RECIPES[0].labelKey) }));
  };

  const sendTransportCommand = useCallback(async (command: TransportCommand, requestedProject?: Project, requestedBeat?: number) => {
    try {
      const targetProject = requestedProject ?? transportProject ?? projectSnapshot;
      const targetTimelineBeats = projectTimelineBeats(targetProject);
      const targetBeat = requestedBeat ?? (targetProject === projectSnapshot ? playheadBeat : 0);
      const activeSampleRate = audioStatus.sampleRate || targetProject.sampleRate;
      const startsNewGraph = !transportPrepared || transportProject !== targetProject || targetBeat >= targetTimelineBeats;
      const status = command === "play"
        ? (startsNewGraph
          ? await startTransport(
            targetProject,
            null,
            activeSampleRate,
            audioStatus.bufferSize || 256,
            projectBeatToSamples(targetProject, targetBeat >= targetTimelineBeats ? 0 : targetBeat, activeSampleRate),
          )
          : await transportPlay())
        : command === "pause" ? await transportPause() : await transportStop();
      if (command === "play") {
        setTransportPrepared(true);
        setTransportProject(targetProject);
        setTransportSampleRate(status.sampleRate || activeSampleRate);
        if (startsNewGraph && targetBeat >= targetTimelineBeats) setPlayheadBeat(0);
      } else if (command === "stop") {
        setTransportPrepared(false);
        setTransportProject(null);
      }
      setDesktop((current) => ({ ...current, audioStatus: status, error: undefined }));
    } catch {
      announce(t("status.audioUnavailable"));
      transportActivity.current = { playing: false, prepared: false };
      setPlaying(false);
      setTransportPrepared(false);
      setTransportProject(null);
    }
  }, [announce, audioStatus.bufferSize, audioStatus.sampleRate, playheadBeat, projectSnapshot, t, transportPrepared, transportProject]);

  useEffect(() => {
    if (!transportPrepared) return;
    let cancelled = false;
    const updatePosition = () => {
      const activeProject = transportProject ?? projectSnapshot;
      const activeTimelineBeats = projectTimelineBeats(activeProject);
      void getTransportPosition().then((position) => {
        if (!cancelled) {
          const durationSamples = position.durationSamples > 0
            ? position.durationSamples
            : projectBeatToSamples(activeProject, activeTimelineBeats, transportSampleRate);
          const boundedSamples = Math.min(Math.max(0, position.positionSamples), durationSamples);
          const nextPosition = { ...position, durationSamples };
          const state = position.transportState.toLowerCase();
          const reachedEnd = durationSamples > 0 && boundedSamples >= durationSamples;
          setTransportPosition(nextPosition);
          setPlayheadBeat(Math.min(activeTimelineBeats, projectSamplesToBeat(activeProject, boundedSamples, transportSampleRate)));
          if (state === "stopped" || (reachedEnd && state !== "paused")) {
            if (playing || transportActivity.current.playing) {
              transportActivity.current = { playing: false, prepared: false };
              setPlaying(false);
              setTransportPrepared(false);
              setTransportProject(null);
              announce(t("status.transportStopped"));
              if (state !== "stopped") void transportStop().catch(() => undefined);
            }
          }
        }
      }).catch(() => undefined);
    };
    updatePosition();
    const timer = window.setInterval(updatePosition, 50);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [announce, playing, projectSnapshot, t, transportPrepared, transportProject, transportSampleRate]);

  const seekTransport = useCallback((beat: number) => {
    const targetProject = transportProject ?? projectSnapshot;
    const targetTimelineBeats = projectTimelineBeats(targetProject);
    const boundedBeat = Math.max(0, Math.min(targetTimelineBeats, beat));
    setPlayheadBeat(boundedBeat);
    if (!transportPrepared) return;
    void transportSeek(projectBeatToSamples(targetProject, boundedBeat, transportSampleRate))
      .then((status) => setDesktop((current) => ({ ...current, audioStatus: status, error: undefined })))
      .catch(() => announce(t("status.audioUnavailable")));
  }, [announce, projectSnapshot, t, transportPrepared, transportProject, transportSampleRate]);

  const previewSfx = useCallback((recipeId: SfxRecipeId, macros: SfxMacros) => {
    const previewProject = createSfxPreviewProject(projectSnapshot, recipeId, seed, macros);
    const activeSampleRate = audioStatus.sampleRate || previewProject.sampleRate;
    setSelectedSfxRecipe(recipeId);
    setPlayheadBeat(0);
    setPlaying(true);
    transportActivity.current = { playing: true, prepared: false };
    void (async () => {
      try {
        if (transportPrepared) await transportStop();
        const status = await startTransport(previewProject, null, activeSampleRate, audioStatus.bufferSize || 256, 0);
        setTransportPrepared(true);
        setTransportProject(previewProject);
        setTransportSampleRate(status.sampleRate || activeSampleRate);
        setTransportPosition({ positionSamples: 0, transportState: "playing", deviceState: "ready", durationSamples: getProjectDurationSamples(previewProject, status.sampleRate || activeSampleRate) });
        setDesktop((current) => ({ ...current, audioStatus: status, error: undefined }));
        announce(t("status.previewingRecipe", { recipe: t(SFX_RECIPES.find((recipe) => recipe.id === recipeId)?.labelKey ?? SFX_RECIPES[0].labelKey) }));
      } catch {
        transportActivity.current = { playing: false, prepared: false };
        setPlaying(false);
        setTransportPrepared(false);
        setTransportProject(null);
        announce(t("status.audioUnavailable"));
      }
    })();
  }, [announce, audioStatus.bufferSize, audioStatus.sampleRate, projectSnapshot, seed, t, transportPrepared]);

  const togglePlay = useCallback(() => {
    const nextPlaying = !playing;
    setPlaying(nextPlaying);
    announce(nextPlaying ? t("status.transportPlaying") : t("status.transportPaused"));
    void sendTransportCommand(nextPlaying ? "play" : "pause");
  }, [announce, playing, sendTransportCommand, t]);

  const playTransport = useCallback(() => {
    if (playing) return;
    setPlaying(true);
    announce(t("status.transportPlaying"));
    void sendTransportCommand("play");
  }, [announce, playing, sendTransportCommand, t]);

  const pauseTransport = useCallback(() => {
    if (!playing) return;
    setPlaying(false);
    announce(t("status.transportPaused"));
    void sendTransportCommand("pause");
  }, [announce, playing, sendTransportCommand, t]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen(true);
      }
      if ((event.ctrlKey || event.metaKey) && !usesNativeHistoryKey(event.target)) {
        const key = event.key.toLowerCase();
        if (key === "z") {
          event.preventDefault();
          if (event.shiftKey) redoStepPattern();
          else undoStepPattern();
          return;
        }
        if (key === "y") {
          event.preventDefault();
          redoStepPattern();
          return;
        }
      }
      if (event.code === "Space" && !usesNativeSpaceKey(event.target)) {
        event.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [redoStepPattern, togglePlay, undoStepPattern]);

  const resetTransport = () => {
    transportActivity.current = { playing: false, prepared: false };
    setPlaying(false);
    setTransportPrepared(false);
    setTransportProject(null);
    setPlayheadBeat(0);
    announce(t("status.transportStopped"));
    void sendTransportCommand("stop");
  };

  const openExport = () => {
    setExportFileName(projectSnapshot.id);
    setExportError("");
    setExportResult(null);
    setExportOpen(true);
  };

  const submitExport = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = exportFileName.trim().replace(/\.wav$/i, "");
    if (!isSafeFileName(normalized)) {
      setExportError(t("export.invalidFileName"));
      return;
    }
    setExportBusy(true);
    setExportError("");
    try {
      const result = await exportProjectWav(projectSnapshot, normalized, projectSnapshot.sampleRate);
      setExportResult(result);
      announce(t("status.exportedWav", { fileName: result.path }));
    } catch (errorValue: unknown) {
      const message = errorValue instanceof Error ? errorValue.message : t("export.failed");
      setExportError(message);
      announce(message);
    } finally {
      setExportBusy(false);
    }
  };

  return (
    <div className="app-shell" data-testid="app-shell" data-ui-scale={uiScale} style={{ "--ui-scale": uiScale / 100 } as React.CSSProperties}>
      <header className="topbar">
        <div className="brand-lockup" aria-label="SonicForge Studio">
          <span className="brand-mark">SF</span>
          <span>
            <strong>SonicForge</strong>
            <small>STUDIO / 0.1</small>
          </span>
        </div>
        <nav className="menu-row" aria-label={t("app.menu.label")}>
          <button className="menu-button" type="button">{t("app.menu.file")}</button>
          <button className="menu-button" type="button">{t("app.menu.edit")}</button>
          <button className="menu-button" type="button">{t("app.menu.project")}</button>
        </nav>
        <div className="topbar-spacer" />
        <label className="language-control"><span>{t("locale.label")}</span><select aria-label={t("locale.label")} value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>{locales.map((item) => <option value={item} key={item}>{localeDisplayNames[item]}</option>)}</select></label>
        <label className="ui-scale-control">UI<select aria-label={t("app.uiScale")} value={uiScale} onChange={(event) => setUiScale(Number(event.target.value) as UiScale)}><option value="100">100%</option><option value="125">125%</option><option value="150">150%</option><option value="200">200%</option></select></label>
        <div className="transport" aria-label={t("transport.controls")}>
          <button className="icon-button" type="button" aria-label={t("transport.stop")} onClick={resetTransport}>■</button>
          <button className={`icon-button play-button ${playing ? "is-playing" : ""}`} type="button" aria-label={playing ? t("transport.pause") : t("transport.play")} onClick={togglePlay}>
            {playing ? "Ⅱ" : "▶"}
          </button>
          <button className="icon-button record-button" type="button" aria-label={t("transport.record")} disabled>●</button>
        </div>
        <label className="tempo-control">
          <span>BPM</span>
          <input aria-label="BPM" type="number" min="20" max="400" value={bpm} onChange={(event) => { setBpm(Number(event.target.value)); setDirty(true); }} />
        </label>
        <span className="metric-pill">4 / 4</span>
        <span className="metric-pill timecode">{formatTransportTime(playheadBeat, bpm)}</span>
        <button type="button" className="engine-status" aria-label={t("app.openAudioSettings")} title={desktop.error ?? t("app.tauriStatus")} onClick={() => setAudioSettingsOpen(true)}>
          <span className={`status-dot ${audioStatus.engineAvailable ? "online" : "offline"}`} />
          <span>{loading ? t("app.connecting") : audioStatus.engineAvailable ? t("app.engineReady") : t("app.offlineMock")}</span>
          <small>DSP {audioStatus.engineAvailable ? "--" : "18%"} · XRUN {audioStatus.xrunCount} · {audioStatus.bufferSize}f</small>
        </button>
        <button className="command-button" type="button" aria-label={t("app.openCommandPalette")} onClick={() => setCommandPaletteOpen(true)}>
          <span>⌘K</span>
        </button>
      </header>

      <div className="mode-strip" role="tablist" aria-label={t("app.workspaceModes")}>
        {modes.map((item) => (
          <button key={item} type="button" role="tab" aria-selected={mode === item} className={mode === item ? "active" : ""} onClick={() => setMode(item)}>
            {item === "Music" ? "◌" : item === "SFX Lab" ? "⌁" : "▥"} {modeLabel(item)}
          </button>
        ))}
      </div>

      <main className="workspace-grid">
        <aside className="browser-panel panel-surface">
          <div className="panel-heading">
            <span>{t("browser.title")}</span>
            <button type="button" className="tiny-button" aria-label={t("browser.addItem")} onClick={() => setInstrumentPickerOpen(true)}>＋</button>
          </div>
          <div className="search-field"><span>⌕</span><input aria-label={t("browser.search")} placeholder={t("browser.searchPlaceholder")} /></div>
          <div className="browser-list">
            {browserItems.map((item) => (
              <button key={item.label} type="button" className={`browser-item ${selectedBrowserItem === item.label ? "active" : ""}`} onClick={() => { setSelectedBrowserItem(item.label); if (item.label === "Instruments" || item.label === "Drum kits") setInstrumentPickerOpen(true); announce(t("template.browserSelected", { item: browserLabel(item.label) })); }}>
                <span className="browser-symbol">{item.symbol}</span><span>{browserLabel(item.label)}</span><span className="item-count">{item.label === "Starred" ? "06" : "24"}</span>
              </button>
            ))}
          </div>
          <div className="browser-divider" />
          <div className="panel-subheading">{t("browser.builtinRecipes")}</div>
          <div className="recipe-list">
            {SFX_RECIPES.map((recipe, index) => (
              <button key={recipe.id} type="button" className={`recipe-item ${selectedSfxRecipe === recipe.id ? "selected" : ""}`} onClick={() => { setSelectedSfxRecipe(recipe.id); setMode("SFX Lab"); announce(t("template.recipeLoaded", { recipe: t(recipe.labelKey) })); }}>
                <span className={`recipe-dot dot-${index % 3}`} />{t(recipe.labelKey)}<span className="chevron">›</span>
              </button>
            ))}
          </div>
          <div className="browser-footnote"><span className="status-dot offline" /> {t("browser.preview")} · {desktop.appInfo.platform}</div>
        </aside>

        <section className="main-panel panel-surface">
          <div className="workspace-heading">
            <div>
              <div className="eyebrow">{t("app.projectDemo")}</div>
              <h1>{mode === "Music" ? editorLabel(musicView) : modeLabel(mode)}</h1>
              {mode === "Music" && <div className="editor-view-tabs" role="tablist" aria-label={t("app.musicEditors")}>{(["Song Editor", "Piano Roll", "Step Sequencer"] as const).map((view) => <button key={view} type="button" role="tab" aria-selected={musicView === view} className={musicView === view ? "active" : ""} onClick={() => setMusicView(view)}>{editorLabel(view)}</button>)}</div>}
            </div>
            <div className="workspace-actions">
              <button type="button" className="ghost-button" onClick={() => setTemplatesOpen(true)}>◇ {t("templates.open")}</button>
              <button type="button" className="ghost-button" onClick={openExport}>⇩ {t("export.open")}</button>
              <ProjectControls project={projectSnapshot} dirty={dirty} onProjectLoaded={loadProjectIntoUi} onDirtyChange={setDirty} onAnnounce={announce} />
              {mode === "Music" ? <button type="button" className="ghost-button add-instrument-button" onClick={() => setInstrumentPickerOpen(true)}>＋ {t("instrument.add")}</button> : null}
              {mode === "Music" && musicView === "Song Editor" ? <button type="button" className="primary-button" onClick={addClip}>＋ {t("song.newClip")}</button> : null}
            </div>
          </div>
          {mode === "Music" && musicView === "Song Editor" && <SongEditor tracks={tracks} selectedTrackId={selectedTrackId} selectedClipId={selectedClipId} setSelectedTrackId={selectTrack} setSelectedClipId={setSelectedClipId} onClipDrag={moveClip} onAnnounce={announce} timelineCleared={timelineCleared} onClear={() => { setTracks((current) => current.map((track) => ({ ...track, clips: [] }))); setTimelineCleared(true); markDirty(t("status.timelineCleared")); }} playheadBeat={playheadBeat} timelineBeats={timelineBeats} bpm={bpm} onSeek={seekTransport} />}
          {mode === "Music" && musicView === "Piano Roll" && <PianoRoll onDirty={markDirty} onNotesChange={updateSelectedTrackPianoNotes} externalNotes={pianoNotes} resetKey={projectLoadVersion} />}
          {mode === "Music" && musicView === "Step Sequencer" && <StepSequencer pattern={stepPattern} dirty={dirty} playing={playing} canUndo={stepHistory.current.canUndo} canRedo={stepHistory.current.canRedo} onChange={applyStepPattern} onUndo={undoStepPattern} onRedo={redoStepPattern} onPlay={togglePlay} />}
          {mode === "SFX Lab" && <SfxLab recipeId={selectedSfxRecipe} onRecipeChange={setSelectedSfxRecipe} onPreview={previewSfx} onStop={resetTransport} onFreeze={freezeSfx} onAnnounce={announce} />}
          {mode === "Mixer" && <MixerFocus tracks={tracks} playing={playing} onPlay={playTransport} onPause={pauseTransport} onStop={resetTransport} onMute={(id) => updateTrack(id, { muted: !tracks.find((track) => track.id === id)?.muted })} onGain={(id, gain) => updateTrack(id, { gain })} />}
        </section>

        <aside className="inspector-panel panel-surface">
          <div className="panel-heading"><span>{t("inspector.title")}</span><span className="inspector-code">{mode === "SFX Lab" ? t("inspector.recipeCode") : t("inspector.trackCode")}</span></div>
          {mode === "SFX Lab" ? <SfxInspector seed={seed} locked={locked} setLocked={setLocked} onSeedChange={setSeed} onRandomize={randomize} onAnnounce={announce} /> : <TrackInspector track={selectedTrack} clip={selectedClip} onUpdateClip={(patch) => selectedTrack && selectedClip && updateClip(selectedTrack.id, selectedClip.id, patch)} onInstrumentChange={(instrumentId) => selectedTrack && changeTrackInstrument(selectedTrack.id, instrumentId)} onDuplicate={duplicateClip} onSplit={splitClip} onAnnounce={announce} />}
        </aside>

        <section className="bottom-panel panel-surface">
          <div className="bottom-heading"><span>{t("mixer.eventFlow")}</span><div><button type="button" className="bottom-tab active">{t("mixer.title")}</button><button type="button" className="bottom-tab" onClick={() => announce(t("status.automationReady"))}>{t("mixer.automation")}</button><button type="button" className="bottom-tab" onClick={() => announce(t("status.eventListEmpty"))}>{t("mixer.eventList")}</button></div></div>
          <div className="mixer-row">{tracks.map((track) => <MixerStrip key={track.id} track={track} onMute={() => updateTrack(track.id, { muted: !track.muted })} onGain={(gain) => updateTrack(track.id, { gain })} />)}<MixerStrip track={{ id: 0, name: t("mixer.master"), icon: "✦", color: "master", gain: 0.82, pan: 0, muted: false, clips: [], instrumentId: "soft-keys", waveform: "sine" }} onMute={() => announce(t("status.masterMutePreview"))} onGain={() => announce(t("status.masterGainPreview"))} master /></div>
        </section>
      </main>

      {toast && <div className="toast" role="status"><span className="toast-icon">✦</span>{toast}</div>}
      {commandPaletteOpen && <CommandPalette onClose={() => setCommandPaletteOpen(false)} onPlay={togglePlay} onMode={(nextMode) => { setMode(nextMode); setCommandPaletteOpen(false); }} />}
      <AudioSettingsDialog open={audioSettingsOpen} onClose={() => setAudioSettingsOpen(false)} currentStatus={audioStatus} onApplied={(nextAudioStatus) => { setTransportPrepared(false); setDesktop((current) => ({ ...current, audioStatus: nextAudioStatus })); }} onAnnounce={announce} />
      <TemplateGallery open={templatesOpen} onClose={() => setTemplatesOpen(false)} onSelect={loadTemplate} />
      <InstrumentPicker open={instrumentPickerOpen} onClose={() => setInstrumentPickerOpen(false)} onSelect={addInstrument} />
      <ExportWavDialog open={exportOpen} fileName={exportFileName} busy={exportBusy} error={exportError} result={exportResult} onFileNameChange={setExportFileName} onClose={() => { if (!exportBusy) setExportOpen(false); }} onSubmit={submitExport} />
    </div>
  );
}

const TIMELINE_TRACK_HEADER_PX = 116;
const TIMELINE_BAR_PX = 64;
const TIMELINE_BAR_COUNT = 10;

function SongEditor({ tracks, selectedTrackId, selectedClipId, setSelectedTrackId, setSelectedClipId, onClipDrag, onAnnounce, timelineCleared, onClear, playheadBeat, timelineBeats, bpm, onSeek }: { tracks: Track[]; selectedTrackId: number; selectedClipId: number; setSelectedTrackId: (id: number) => void; setSelectedClipId: (id: number) => void; onClipDrag: (event: DragEvent<HTMLButtonElement>, trackId: number, clipId: number) => void; onAnnounce: (message: string) => void; timelineCleared: boolean; onClear: () => void; playheadBeat: number; timelineBeats: number; bpm: number; onSeek: (beat: number) => void }) {
  const t = useTranslation();
  const seekFromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.type === "pointermove" && (event.buttons & 1) === 0) return;
    if (event.type === "pointerdown" && event.button !== 0) return;
    const rectangle = event.currentTarget.getBoundingClientRect();
    const visualScale = event.currentTarget.offsetWidth > 0
      ? rectangle.width / event.currentTarget.offsetWidth
      : 1;
    const timelineWidth = TIMELINE_BAR_PX * TIMELINE_BAR_COUNT * visualScale;
    const x = event.clientX - rectangle.left - TIMELINE_TRACK_HEADER_PX * visualScale;
    const ratio = Math.max(0, Math.min(1, x / timelineWidth));
    if (event.type === "pointerdown" && typeof event.currentTarget.setPointerCapture === "function") {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    onSeek(ratio * timelineBeats);
  };
  const onPlayheadKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 1 : 0.25;
    if (event.key === "ArrowLeft") onSeek(playheadBeat - step);
    else if (event.key === "ArrowRight") onSeek(playheadBeat + step);
    else if (event.key === "Home") onSeek(0);
    else if (event.key === "End") onSeek(timelineBeats);
    else return;
    event.preventDefault();
    event.stopPropagation();
  };
  const playheadLeft = TIMELINE_TRACK_HEADER_PX
    + Math.max(0, Math.min(1, playheadBeat / timelineBeats)) * TIMELINE_BAR_PX * TIMELINE_BAR_COUNT;
  return (
    <div className="editor-canvas" data-testid="song-editor">
      <div className="ruler interactive-ruler" onPointerDown={seekFromPointer} onPointerMove={seekFromPointer}><span className="ruler-label">{t("song.bar")}</span>{["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"].map((bar) => <span key={bar}>{bar}</span>)}</div>
      <div className="timeline-stage">
        <div className="timeline-grid" aria-label={t("song.timeline")} onPointerDown={seekFromPointer} onPointerMove={seekFromPointer}>
          {tracks.map((track, index) => <div className="track-lane" key={track.id} style={{ top: `${index * 58}px` }}><button type="button" className={`track-label ${selectedTrackId === track.id ? "selected" : ""}`} onPointerDown={(event) => event.stopPropagation()} onClick={() => setSelectedTrackId(track.id)}><span className={`track-icon ${track.color}`}>{track.icon}</span><span>{track.name}</span><span className="lane-menu">···</span></button>{track.clips.map((clip) => <button key={clip.id} type="button" draggable className={`clip clip-${clip.tone} ${selectedClipId === clip.id ? "selected" : ""}`} style={{ left: `${clip.left}px`, width: `${clip.width}px` }} onPointerDown={(event) => event.stopPropagation()} onClick={() => { setSelectedTrackId(track.id); setSelectedClipId(clip.id); }} onDragEnd={(event) => onClipDrag(event, track.id, clip.id)} aria-label={t("template.selectClip", { name: clip.name })}><span className="clip-handle" /><span>{clip.name}</span><small>{t("song.clipMeta")}</small></button>)}</div>)}
          <div className="playhead" data-testid="playhead" role="slider" tabIndex={0} aria-label={t("song.playhead")} aria-valuemin={0} aria-valuemax={timelineBeats} aria-valuenow={Number(playheadBeat.toFixed(2))} aria-valuetext={formatTransportTime(playheadBeat, bpm)} onKeyDown={onPlayheadKeyDown} style={{ left: `${playheadLeft}px` }}><span>{formatTransportTime(playheadBeat, bpm)}</span></div>
          {timelineCleared && <div className="empty-timeline"><span className="empty-icon">＋</span><strong>{t("song.emptyTitle")}</strong><span>{t("song.emptyBody")}</span></div>}
        </div>
      </div>
      <div className="editor-footer"><div className="snap-control"><span>{t("song.snap")}</span><button type="button" className="select-button" onClick={() => onAnnounce(t("status.snap16"))}>{t("song.snap16")} <span>⌄</span></button></div><div className="zoom-control"><span>{t("song.zoom")}</span><input aria-label={t("song.timelineZoom")} type="range" min="60" max="140" defaultValue="100" onChange={(event) => onAnnounce(t("template.timelineZoom", { percent: event.target.value }))} /></div><div className="footer-spacer" /><button type="button" className="ghost-button danger-button" onClick={onClear}>{t("song.clearTimeline")}</button><span className="hint-key">Space <span>{t("transport.playPause")}</span></span></div>
    </div>
  );
}

function SfxLab({ recipeId, onRecipeChange, onPreview, onStop, onFreeze, onAnnounce }: {
  recipeId: SfxRecipeId;
  onRecipeChange: (recipeId: SfxRecipeId) => void;
  onPreview: (recipeId: SfxRecipeId, macros: SfxMacros) => void;
  onStop: () => void;
  onFreeze: () => void;
  onAnnounce: (message: string) => void;
}) {
  const t = useTranslation();
  const [macros, setMacros] = useState<SfxMacros>(DEFAULT_SFX_MACROS);
  const macroLabel = (key: string) => key === "character" ? t("sfx.macro.character") : key === "pitch" ? t("sfx.macro.pitch") : key === "body" ? t("sfx.macro.body") : key === "noise" ? t("sfx.macro.noise") : key === "space" ? t("sfx.macro.space") : t("sfx.macro.length");
  const selectedRecipe = SFX_RECIPES.find((recipe) => recipe.id === recipeId) ?? SFX_RECIPES[0];
  return (
    <div className="sfx-workspace" data-testid="sfx-panel">
      <div className="sfx-hero"><div className="eyebrow">{t("sfx.recipeBuiltin")}</div><h2>{t(selectedRecipe.labelKey)}</h2><p>{t(selectedRecipe.descriptionKey)}</p><div className="waveform" aria-label={t("sfx.waveform")}>{Array.from({ length: 54 }, (_, index) => <i key={index} style={{ height: `${18 + ((index * 29 + selectedRecipe.id.length * 7) % 66)}%` }} />)}</div><div className="sfx-hero-actions"><button type="button" className="ghost-button" onClick={onFreeze}>{t("sfx.freezeTrack")}</button></div></div>
      <div className="sfx-recipe-grid" aria-label={t("sfx.recipeList")}>
        {SFX_RECIPES.map((recipe) => <article key={recipe.id} data-testid={`sfx-recipe-${recipe.id}`} className={`sfx-recipe-card ${recipe.id === selectedRecipe.id ? "selected" : ""}`} onClick={() => onRecipeChange(recipe.id)}><div className="sfx-recipe-card-heading"><span className={`recipe-dot dot-${SFX_RECIPES.indexOf(recipe) % 3}`} /><h3>{t(recipe.labelKey)}</h3></div><p>{t(recipe.descriptionKey)}</p><div className="sfx-card-actions"><button type="button" className="primary-button" aria-label={`${t("sfx.preview")} ${t(recipe.labelKey)}`} onClick={(event) => { event.stopPropagation(); onRecipeChange(recipe.id); onPreview(recipe.id, macros); }}>▶ {t("sfx.preview")}</button><button type="button" className="ghost-button" aria-label={`${t("sfx.stop")} ${t(recipe.labelKey)}`} onClick={(event) => { event.stopPropagation(); onStop(); }}>■ {t("sfx.stop")}</button></div></article>)}
      </div>
      <div className="macro-card"><div className="card-heading"><span>{t("sfx.macros")}</span><span className="muted-label">{t("sfx.lockedHint")}</span></div><div className="macro-grid">{Object.entries(macros).map(([key, value]) => <label className="macro-control" key={key}><span className="macro-dial" style={{ "--dial": `${value * 2.9}deg` } as React.CSSProperties}><i /></span><span>{macroLabel(key)}</span><input type="range" min="0" max="100" value={value} onChange={(event) => setMacros((current) => ({ ...current, [key]: Number(event.target.value) }))} /></label>)}</div></div>
      <div className="sfx-bottom-grid"><div className="sfx-note"><span className="note-mark">i</span><span>{t("sfx.deterministicHint")}</span></div><button type="button" className="ghost-button" onClick={() => onAnnounce(t("status.advancedExpanded"))}>{t("sfx.advancedParameters")} <span>⌄</span></button></div>
    </div>
  );
}

function SfxInspector({ seed, locked, setLocked, onSeedChange, onRandomize, onAnnounce }: { seed: number; locked: boolean; setLocked: (value: boolean) => void; onSeedChange: (value: number) => void; onRandomize: () => void; onAnnounce: (message: string) => void }) {
  const t = useTranslation();
  return <div className="sfx-inspector-card"><div className="card-heading"><span>{t("sfx.renderControl")}</span><span className="recipe-version">{t("sfx.recipeVersion")}</span></div><div className="inspector-row"><span>{t("sfx.seed")}</span><div className="inline-control"><input aria-label={t("sfx.seedLabel")} type="number" value={seed} onChange={(event) => onSeedChange(Number(event.target.value))} /><button type="button" className={`lock-button ${locked ? "locked" : ""}`} aria-label={locked ? t("sfx.unlockSeed") : t("sfx.lockSeed")} onClick={() => setLocked(!locked)}>{locked ? "▣" : "□"}</button></div></div><div className="inspector-row"><span>{t("sfx.variants")}</span><select aria-label={t("sfx.variantCount")} defaultValue="8"><option value="1">{t("sfx.variant.one")}</option><option value="8">{t("sfx.variant.eight")}</option><option value="16">{t("sfx.variant.sixteen")}</option><option value="32">{t("sfx.variant.thirtyTwo")}</option></select></div><div className="inspector-row"><span>{t("sfx.peakTarget")}</span><span className="value-readout">-1.0 dBFS</span></div><div className="inspector-actions"><button type="button" className="ghost-button" onClick={onRandomize}>⤨ {t("sfx.randomize")}</button><button type="button" className="primary-button" onClick={() => onAnnounce(t("status.batchQueued"))}>{t("sfx.exportBatch")}</button></div></div>;
}

function TrackInspector({ track, clip, onUpdateClip, onInstrumentChange, onDuplicate, onSplit, onAnnounce }: { track?: Track; clip?: Clip; onUpdateClip: (patch: Partial<Clip>) => void; onInstrumentChange: (instrumentId: FactoryInstrumentId) => void; onDuplicate: () => void; onSplit: () => void; onAnnounce: (message: string) => void }) {
  const t = useTranslation();
  if (!track) return <div className="empty-inspector"><span className="empty-icon">⌁</span><strong>{t("inspector.selectClip")}</strong><span>{t("inspector.selectClipHint")}</span></div>;
  return <div className="inspector-content"><div className="selected-object"><span className={`track-icon ${track.color}`}>{track.icon}</span><div><strong>{clip?.name ?? track.name}</strong><small>{track.name} · {t("inspector.patternClip")}</small></div></div><div className="inspector-section"><div className="section-label">{t("instrument.trackSound")}</div><div className="inspector-row"><span>{t("instrument.sound")}</span><select aria-label={t("instrument.trackInstrument")} value={track.instrumentId} onChange={(event) => onInstrumentChange(event.target.value as FactoryInstrumentId)}>{factoryInstruments.map((preset) => <option key={preset.id} value={preset.id}>{t(preset.nameKey)}</option>)}</select></div><small className="instrument-description">{t(getFactoryInstrument(track.instrumentId).descriptionKey)}</small></div>{clip && <div className="inspector-section"><div className="section-label">{t("inspector.clipTransform")}</div><div className="inspector-row"><span>{t("inspector.position")}</span><span className="value-readout">{Math.round(clip.left / 64 + 1)}.1.00</span></div><div className="inspector-row"><span>{t("inspector.length")}</span><input aria-label={t("inspector.clipLength")} type="range" min="40" max="420" value={clip.width} onChange={(event) => onUpdateClip({ width: Number(event.target.value) })} /></div><div className="inspector-row"><span>{t("inspector.color")}</span><span className={`color-chip ${clip.tone}`} /></div></div>}{clip && <div className="inspector-section"><div className="section-label">{t("inspector.actions")}</div><div className="inspector-actions stacked"><button type="button" className="ghost-button" onClick={onDuplicate}>⧉ {t("inspector.duplicate")} <span className="hint-key">Ctrl+D</span></button><button type="button" className="ghost-button" onClick={onSplit}>⫽ {t("inspector.split")}</button><button type="button" className="ghost-button" onClick={() => onAnnounce(t("status.freezeReady"))}>◈ {t("inspector.freezeAudio")}</button></div></div>}<div className="inspector-note"><span>⌘</span> {t("inspector.commandBoundary")}</div></div>;
}

function InstrumentPicker({ open, onClose, onSelect }: { open: boolean; onClose: () => void; onSelect: (instrumentId: FactoryInstrumentId) => void }) {
  const t = useTranslation();
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => {
      if (previousFocus.current?.isConnected) previousFocus.current.focus();
      previousFocus.current = null;
    };
  }, [open]);
  if (!open) return null;
  return <div className="modal-backdrop" role="presentation" onClick={onClose}><section ref={dialogRef} tabIndex={-1} className="instrument-picker" role="dialog" aria-modal="true" aria-label={t("instrument.pickerTitle")} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])"));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }}><div className="instrument-picker-heading"><div><div className="eyebrow">{t("instrument.factoryBank")}</div><h2>{t("instrument.pickerTitle")}</h2><p>{t("instrument.pickerDescription")}</p></div><button type="button" className="tiny-button" aria-label={t("instrument.closePicker")} onClick={onClose}>×</button></div><div className="instrument-grid">{factoryInstruments.map((preset) => <article className="instrument-card" key={preset.id}><span className={`track-icon ${preset.color}`}>{preset.icon}</span><div><strong>{t(preset.nameKey)}</strong><p>{t(preset.descriptionKey)}</p></div><button type="button" className="primary-button" aria-label={t("template.addInstrument", { name: t(preset.nameKey) })} onClick={() => onSelect(preset.id)}>＋ {t("instrument.add")}</button></article>)}</div></section></div>;
}

function MixerFocus({ tracks, playing, onPlay, onPause, onStop, onMute, onGain }: { tracks: Track[]; playing: boolean; onPlay: () => void; onPause: () => void; onStop: () => void; onMute: (id: number) => void; onGain: (id: number, gain: number) => void }) {
  const t = useTranslation();
  return <div className="mixer-focus" data-testid="mixer-panel"><div className="mixer-focus-intro"><div className="eyebrow">{t("mixer.liveView")}</div><h2>{t("mixer.headline")}</h2><p>{t("mixer.description")}</p><div className="mixer-transport" aria-label={t("mixer.transportControls")}><button type="button" className="primary-button" aria-label={t("transport.play")} onClick={onPlay}>▶ {t("transport.play")}</button><button type="button" className="ghost-button" aria-label={t("transport.pause")} onClick={onPause}>Ⅱ {t("transport.pause")}</button><button type="button" className="ghost-button" aria-label={t("transport.stop")} onClick={onStop}>■ {t("transport.stop")}</button><span className="mixer-transport-state">{playing ? t("mixer.playing") : t("mixer.ready")}</span></div></div><div className="mixer-focus-grid">{tracks.map((track) => <MixerStrip key={track.id} track={track} onMute={() => onMute(track.id)} onGain={(gain) => onGain(track.id, gain)} large />)}</div></div>;
}

function MixerStrip({ track, onMute, onGain, large = false, master = false }: { track: Track; onMute: () => void; onGain: (gain: number) => void; large?: boolean; master?: boolean }) {
  const t = useTranslation();
  const muteAction = track.muted ? t("mixer.unmute") : t("mixer.mute");
  return <div className={`mixer-strip ${large ? "large" : ""} ${master ? "master-strip" : ""}`}><div className="strip-top"><span className={`track-icon ${track.color}`}>{track.icon}</span><strong>{track.name}</strong><button type="button" className={`mute-button ${track.muted ? "muted" : ""}`} aria-label={t("template.mixerAction", { action: muteAction, name: track.name })} onClick={onMute}>{track.muted ? "M" : "·"}</button></div><div className="meter-track"><span style={{ height: `${track.muted ? 8 : Math.max(12, track.gain * 78)}%` }} /></div><input className="vertical-fader" aria-label={`${track.name} ${t("mixer.gain")}`} type="range" min="0" max="100" value={Math.round(track.gain * 100)} onChange={(event) => onGain(Number(event.target.value) / 100)} /><div className="strip-db">{track.muted ? t("mixer.muted") : `${Math.round(track.gain * 100 - 100)} dB`}</div></div>;
}

function CommandPalette({ onClose, onPlay, onMode }: { onClose: () => void; onPlay: () => void; onMode: (mode: Mode) => void }) {
  const t = useTranslation();
  return <div className="modal-backdrop" role="presentation" onClick={onClose}><section className="command-palette" role="dialog" aria-modal="true" aria-label={t("command.palette")} onClick={(event) => event.stopPropagation()}><div className="command-search"><span>⌘</span><input autoFocus placeholder={t("command.placeholder")} aria-label={t("command.search")} /></div><div className="command-list"><button type="button" onClick={onPlay}><span>▶</span> {t("transport.playPause")} <kbd>Space</kbd></button><button type="button" onClick={() => onMode("Music")}><span>◌</span> {t("command.openSongEditor")} <kbd>⌘1</kbd></button><button type="button" onClick={() => onMode("SFX Lab")}><span>⌁</span> {t("command.openSfxLab")} <kbd>⌘2</kbd></button><button type="button" onClick={() => onMode("Mixer")}><span>▥</span> {t("command.openMixer")} <kbd>⌘3</kbd></button></div><div className="command-foot"><span>{t("command.escapeClose")}</span><span>{t("command.controlLayer")}</span></div></section></div>;
}

function ExportWavDialog({ open, fileName, busy, error, result, onFileNameChange, onClose, onSubmit }: {
  open: boolean;
  fileName: string;
  busy: boolean;
  error: string;
  result: ExportWavResult | null;
  onFileNameChange: (value: string) => void;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  const t = useTranslation();
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    return () => {
      if (previousFocus.current?.isConnected) previousFocus.current.focus();
      previousFocus.current = null;
    };
  }, [open]);
  if (!open) return null;
  const trapFocus = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])"));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="export-dialog" role="dialog" aria-modal="true" aria-label={t("export.dialogTitle")} onKeyDown={trapFocus} onMouseDown={(event) => event.stopPropagation()}>
      <div className="settings-heading"><div><div className="eyebrow">{t("export.eyebrow")}</div><h2>{t("export.dialogTitle")}</h2></div><button type="button" className="tiny-button" aria-label={t("export.close")} onClick={onClose}>×</button></div>
      <p className="settings-copy">{t("export.description")}</p>
      <form className="save-as-form" onSubmit={onSubmit}><label><span>{t("export.fileName")}</span><input autoComplete="off" spellCheck={false} value={fileName} onChange={(event) => onFileNameChange(event.target.value)} /></label><small className="modal-hint">{t("export.safeNameHint")}</small>{error && <div className="modal-error" role="alert">{error}</div>}{result && <div className="export-result" role="status"><strong>{t("export.complete")}</strong><span>{t("export.path")}: {result.path}</span><span>{t("export.frames")}: {result.frames}</span><span>{t("export.sampleRate")}: {result.sampleRate} Hz</span></div>}<div className="settings-actions"><button type="button" className="ghost-button" disabled={busy} onClick={onClose}>{t("export.close")}</button><button type="submit" className="primary-button" disabled={busy}>{busy ? t("export.exporting") : t("export.submit")}</button></div></form>
    </section>
  </div>;
}

function App() {
  return <I18nProvider><AppContent /></I18nProvider>;
}

export default App;
