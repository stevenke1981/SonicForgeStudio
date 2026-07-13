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
import type { Locale } from "./i18n";
import { BoundedHistory } from "./lib/history";
import {
  createDemoProject,
  loadDesktopState,
  recoverProject,
  startTransport,
  transportPause,
  transportPlay,
  transportStop,
  writeRecoveryJournal,
} from "./lib/tauri";
import { initialPianoNotes } from "./lib/pianoRoll";
import type { PianoNote } from "./lib/pianoRoll";
import type { AudioStatus, DesktopState, Project, ProjectTrack, Waveform } from "./lib/tauri";
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
};

const modes: Mode[] = ["Music", "SFX Lab", "Mixer"];

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

const waveformByTrack: Waveform[] = ["saw", "square", "sine"];

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

function notesFromStepPattern(pattern: StepPattern, bpm: number): ProjectTrack["pattern"]["notes"] {
  const stepBeats = 4 / Math.max(1, pattern.length);
  const millisecondsPerBeat = 60_000 / Math.max(20, bpm);
  return pattern.steps.slice(0, pattern.length).flatMap((step, index) => {
    if (!step.enabled || step.probability <= 0) return [];
    const ratchet = Math.max(1, Math.min(4, step.ratchet));
    const ratchetBeats = stepBeats / ratchet;
    const velocity = (step.velocity / 127) * (step.probability / 100);
    return Array.from({ length: ratchet }, (_, repeat) => ({
      startBeat: Math.max(0, index * stepBeats + repeat * ratchetBeats + (step.microShift / millisecondsPerBeat)),
      lengthBeats: Math.max(0.03, ratchetBeats * 0.85),
      midiNote: 36,
      velocity,
    }));
  });
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

function buildProjectSnapshot(base: Project, bpm: number, tracks: Track[], pianoNotes: PianoNote[], stepPattern?: StepPattern): Project {
  const projectTracks: ProjectTrack[] = tracks.map((track, index) => {
    const baseTrack = (track.modelId ? base.tracks.find((item) => item.id === track.modelId) : undefined) ?? base.tracks[index];
    const modelTrackId = track.modelId ?? baseTrack?.id ?? `track-${track.id}`;
    const basePattern = baseTrack?.pattern;
    const notes = index === 0
      ? pianoNotes.map((note) => projectNoteFromPiano(note, basePattern?.notes ?? []))
      : index === 1 && stepPattern
        ? notesFromStepPattern(stepPattern, bpm)
      : (basePattern?.notes ?? []);
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
      waveform: baseTrack?.waveform ?? waveformByTrack[index % waveformByTrack.length],
    };
  });
  return {
    ...base,
    bpm,
    tempoMap: base.tempoMap.length > 0
      ? base.tempoMap.map((point, index) => index === 0 ? { ...point, bpm } : point)
      : [{ tick: 0, bpm }],
    tracks: projectTracks,
  };
}

function tracksFromProject(project: Project): Track[] {
  let nextClipId = 1;
  return project.tracks.map((track, index) => ({
    id: index + 1,
    modelId: track.id,
    name: track.name,
    icon: track.kind === "audio" ? "▧" : track.kind === "bus" ? "▥" : "◌",
    color: track.color.toLowerCase().includes("bf70") ? "amber" : track.color.toLowerCase().includes("9aff") ? "violet" : "cyan",
    gain: track.gain,
    pan: track.pan,
    muted: track.muted,
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
  }));
}

function formatTime(playing: boolean): string {
  return playing ? "00:03:12" : "00:00:00";
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
  const [bpm, setBpm] = useState(120);
  const [tracks, setTracks] = useState<Track[]>(initialTracks);
  const [selectedTrackId, setSelectedTrackId] = useState(1);
  const [selectedClipId, setSelectedClipId] = useState(11);
  const [selectedBrowserItem, setSelectedBrowserItem] = useState("Starred");
  const [seed, setSeed] = useState(42);
  const [locked, setLocked] = useState(true);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [timelineCleared, setTimelineCleared] = useState(false);
  const [toast, setToast] = useState(() => t("status.ready"));
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [audioSettingsOpen, setAudioSettingsOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [uiScale, setUiScale] = useState<UiScale>(100);
  const [projectBase, setProjectBase] = useState<Project>(() => createDemoProject());
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

  const applyStepPattern = useCallback((nextPattern: StepPattern, description: string) => {
    stepHistory.current.push(nextPattern);
    setStepPattern(nextPattern);
    setDirty(true);
    announce(description);
  }, [announce]);

  const undoStepPattern = useCallback(() => {
    const previous = stepHistory.current.undo();
    if (previous === undefined) return;
    setStepPattern(previous);
    setDirty(stepHistory.current.canUndo);
    announce("Step change undone");
  }, [announce]);

  const redoStepPattern = useCallback(() => {
    const next = stepHistory.current.redo();
    if (next === undefined) return;
    setStepPattern(next);
    setDirty(true);
    announce("Step change redone");
  }, [announce]);

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
  const recipeLabel = (value: string) => ({
    "Laser Pulse": t("browser.recipe.laserPulse"), "Deep Impact": t("browser.recipe.deepImpact"),
    "Fast Whoosh": t("browser.recipe.fastWhoosh"), "Soft UI Click": t("browser.recipe.softUiClick"), "Rain Ambience": t("browser.recipe.rainAmbience"),
  })[value] ?? value;
  const projectSnapshot = useMemo(() => buildProjectSnapshot(projectBase, bpm, tracks, pianoNotes, stepPattern), [bpm, pianoNotes, projectBase, stepPattern, tracks]);

  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => {
      void writeRecoveryJournal(projectSnapshot).catch(() => undefined);
    }, 750);
    return () => window.clearTimeout(timer);
  }, [dirty, projectSnapshot]);

  const loadProjectIntoUi = useCallback((project: Project) => {
    setProjectBase(project);
    setBpm(project.bpm);
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
    const resetStepPattern = createDefaultStepPattern(16);
    stepHistory.current.reset(resetStepPattern);
    setStepPattern(resetStepPattern);
    setProjectLoadVersion((version) => version + 1);
  }, []);

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
    setDirty(true);
    announce(message);
  }, [announce]);

  const loadTemplate = useCallback((project: Project) => {
    loadProjectIntoUi(project);
    setMode("Music");
    setMusicView("Piano Roll");
    setDirty(true);
    setTemplatesOpen(false);
    announce(t("status.templateLoaded"));
  }, [announce, loadProjectIntoUi, t]);

  const updateTrack = (trackId: number, patch: Partial<Track>) => {
    setTracks((current) => current.map((track) => (track.id === trackId ? { ...track, ...patch } : track)));
    setDirty(true);
  };

  const updateClip = (trackId: number, clipId: number, patch: Partial<Clip>) => {
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
    announce(`Laser seed ${seed} frozen to the timeline`);
  };

  const sendTransportCommand = useCallback(async (command: TransportCommand) => {
    try {
      const status = command === "play"
        ? (!transportPrepared
          ? await startTransport(projectSnapshot, null, audioStatus.sampleRate || projectSnapshot.sampleRate, audioStatus.bufferSize || 256)
          : await transportPlay())
        : command === "pause" ? await transportPause() : await transportStop();
      if (command === "play") setTransportPrepared(true);
      setDesktop((current) => ({ ...current, audioStatus: status, error: undefined }));
    } catch {
      announce(t("status.audioUnavailable"));
      setPlaying(false);
      if (command === "play") setTransportPrepared(false);
    }
  }, [announce, audioStatus.bufferSize, audioStatus.sampleRate, projectSnapshot, t, transportPrepared]);

  const togglePlay = useCallback(() => {
    const nextPlaying = !playing;
    setPlaying(nextPlaying);
    announce(nextPlaying ? t("status.transportPlaying") : t("status.transportPaused"));
    void sendTransportCommand(nextPlaying ? "play" : "pause");
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
    setPlaying(false);
    announce(t("status.transportStopped"));
    void sendTransportCommand("stop");
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
        <span className="metric-pill timecode">{formatTime(playing)}</span>
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
            <button type="button" className="tiny-button" aria-label={t("browser.addItem")} onClick={() => announce(t("status.browserReady"))}>＋</button>
          </div>
          <div className="search-field"><span>⌕</span><input aria-label={t("browser.search")} placeholder={t("browser.searchPlaceholder")} /></div>
          <div className="browser-list">
            {browserItems.map((item) => (
              <button key={item.label} type="button" className={`browser-item ${selectedBrowserItem === item.label ? "active" : ""}`} onClick={() => { setSelectedBrowserItem(item.label); announce(t("template.browserSelected", { item: browserLabel(item.label) })); }}>
                <span className="browser-symbol">{item.symbol}</span><span>{browserLabel(item.label)}</span><span className="item-count">{item.label === "Starred" ? "06" : "24"}</span>
              </button>
            ))}
          </div>
          <div className="browser-divider" />
          <div className="panel-subheading">{t("browser.builtinRecipes")}</div>
          <div className="recipe-list">
            {["Laser Pulse", "Deep Impact", "Fast Whoosh", "Soft UI Click", "Rain Ambience"].map((recipe, index) => (
              <button key={recipe} type="button" className={`recipe-item ${index === 0 ? "selected" : ""}`} onClick={() => { setMode("SFX Lab"); announce(t("template.recipeLoaded", { recipe: recipeLabel(recipe) })); }}>
                <span className={`recipe-dot dot-${index % 3}`} />{recipeLabel(recipe)}<span className="chevron">›</span>
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
              <ProjectControls project={projectSnapshot} dirty={dirty} onProjectLoaded={loadProjectIntoUi} onDirtyChange={setDirty} onAnnounce={announce} />
              {mode === "Music" && musicView === "Song Editor" ? <button type="button" className="primary-button" onClick={addClip}>＋ {t("song.newClip")}</button> : null}
            </div>
          </div>
          {mode === "Music" && musicView === "Song Editor" && <SongEditor tracks={tracks} selectedTrackId={selectedTrackId} selectedClipId={selectedClipId} setSelectedTrackId={setSelectedTrackId} setSelectedClipId={setSelectedClipId} onClipDrag={moveClip} onAnnounce={announce} timelineCleared={timelineCleared} onClear={() => { setTracks((current) => current.map((track) => ({ ...track, clips: [] }))); setTimelineCleared(true); markDirty(t("status.timelineCleared")); }} />}
          {mode === "Music" && musicView === "Piano Roll" && <PianoRoll onDirty={markDirty} onNotesChange={setPianoNotes} externalNotes={pianoNotes} resetKey={projectLoadVersion} />}
          {mode === "Music" && musicView === "Step Sequencer" && <StepSequencer pattern={stepPattern} dirty={dirty} playing={playing} canUndo={stepHistory.current.canUndo} canRedo={stepHistory.current.canRedo} onChange={applyStepPattern} onUndo={undoStepPattern} onRedo={redoStepPattern} onPlay={togglePlay} />}
          {mode === "SFX Lab" && <SfxLab onFreeze={freezeSfx} onAnnounce={announce} />}
          {mode === "Mixer" && <MixerFocus tracks={tracks} onMute={(id) => updateTrack(id, { muted: !tracks.find((track) => track.id === id)?.muted })} onGain={(id, gain) => updateTrack(id, { gain })} />}
        </section>

        <aside className="inspector-panel panel-surface">
          <div className="panel-heading"><span>{t("inspector.title")}</span><span className="inspector-code">{mode === "SFX Lab" ? t("inspector.recipeCode") : t("inspector.trackCode")}</span></div>
          {mode === "SFX Lab" ? <SfxInspector seed={seed} locked={locked} setLocked={setLocked} onSeedChange={setSeed} onRandomize={randomize} onAnnounce={announce} /> : <TrackInspector track={selectedTrack} clip={selectedClip} onUpdateClip={(patch) => selectedTrack && selectedClip && updateClip(selectedTrack.id, selectedClip.id, patch)} onDuplicate={duplicateClip} onSplit={splitClip} onAnnounce={announce} />}
        </aside>

        <section className="bottom-panel panel-surface">
          <div className="bottom-heading"><span>{t("mixer.eventFlow")}</span><div><button type="button" className="bottom-tab active">{t("mixer.title")}</button><button type="button" className="bottom-tab" onClick={() => announce(t("status.automationReady"))}>{t("mixer.automation")}</button><button type="button" className="bottom-tab" onClick={() => announce(t("status.eventListEmpty"))}>{t("mixer.eventList")}</button></div></div>
          <div className="mixer-row">{tracks.map((track) => <MixerStrip key={track.id} track={track} onMute={() => updateTrack(track.id, { muted: !track.muted })} onGain={(gain) => updateTrack(track.id, { gain })} />)}<MixerStrip track={{ id: 0, name: t("mixer.master"), icon: "✦", color: "master", gain: 0.82, pan: 0, muted: false, clips: [] }} onMute={() => announce(t("status.masterMutePreview"))} onGain={() => announce(t("status.masterGainPreview"))} master /></div>
        </section>
      </main>

      {toast && <div className="toast" role="status"><span className="toast-icon">✦</span>{toast}</div>}
      {commandPaletteOpen && <CommandPalette onClose={() => setCommandPaletteOpen(false)} onPlay={togglePlay} onMode={(nextMode) => { setMode(nextMode); setCommandPaletteOpen(false); }} />}
      <AudioSettingsDialog open={audioSettingsOpen} onClose={() => setAudioSettingsOpen(false)} currentStatus={audioStatus} onApplied={(nextAudioStatus) => { setTransportPrepared(false); setDesktop((current) => ({ ...current, audioStatus: nextAudioStatus })); }} onAnnounce={announce} />
      <TemplateGallery open={templatesOpen} onClose={() => setTemplatesOpen(false)} onSelect={loadTemplate} />
    </div>
  );
}

function SongEditor({ tracks, selectedTrackId, selectedClipId, setSelectedTrackId, setSelectedClipId, onClipDrag, onAnnounce, timelineCleared, onClear }: { tracks: Track[]; selectedTrackId: number; selectedClipId: number; setSelectedTrackId: (id: number) => void; setSelectedClipId: (id: number) => void; onClipDrag: (event: DragEvent<HTMLButtonElement>, trackId: number, clipId: number) => void; onAnnounce: (message: string) => void; timelineCleared: boolean; onClear: () => void }) {
  const t = useTranslation();
  return (
    <div className="editor-canvas" data-testid="song-editor">
      <div className="ruler"><span className="ruler-label">{t("song.bar")}</span>{["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"].map((bar) => <span key={bar}>{bar}</span>)}</div>
      <div className="timeline-stage">
        <div className="timeline-grid" aria-label={t("song.timeline")}>
          {tracks.map((track, index) => <div className="track-lane" key={track.id} style={{ top: `${index * 58}px` }}><button type="button" className={`track-label ${selectedTrackId === track.id ? "selected" : ""}`} onClick={() => setSelectedTrackId(track.id)}><span className={`track-icon ${track.color}`}>{track.icon}</span><span>{track.name}</span><span className="lane-menu">···</span></button>{track.clips.map((clip) => <button key={clip.id} type="button" draggable className={`clip clip-${clip.tone} ${selectedClipId === clip.id ? "selected" : ""}`} style={{ left: `${clip.left}px`, width: `${clip.width}px` }} onClick={() => { setSelectedTrackId(track.id); setSelectedClipId(clip.id); }} onDragEnd={(event) => onClipDrag(event, track.id, clip.id)} aria-label={t("template.selectClip", { name: clip.name })}><span className="clip-handle" /><span>{clip.name}</span><small>{t("song.clipMeta")}</small></button>)}</div>)}
          <div className="playhead" aria-label={t("song.playhead")}><span>00:03:12</span></div>
          {timelineCleared && <div className="empty-timeline"><span className="empty-icon">＋</span><strong>{t("song.emptyTitle")}</strong><span>{t("song.emptyBody")}</span></div>}
        </div>
      </div>
      <div className="editor-footer"><div className="snap-control"><span>{t("song.snap")}</span><button type="button" className="select-button" onClick={() => onAnnounce(t("status.snap16"))}>{t("song.snap16")} <span>⌄</span></button></div><div className="zoom-control"><span>{t("song.zoom")}</span><input aria-label={t("song.timelineZoom")} type="range" min="60" max="140" defaultValue="100" onChange={(event) => onAnnounce(t("template.timelineZoom", { percent: event.target.value }))} /></div><div className="footer-spacer" /><button type="button" className="ghost-button danger-button" onClick={onClear}>{t("song.clearTimeline")}</button><span className="hint-key">Space <span>{t("transport.playPause")}</span></span></div>
    </div>
  );
}

function SfxLab({ onFreeze, onAnnounce }: { onFreeze: () => void; onAnnounce: (message: string) => void }) {
  const t = useTranslation();
  const [macros, setMacros] = useState({ character: 72, pitch: 68, body: 44, noise: 31, space: 58, length: 62 });
  const macroLabel = (key: string) => key === "character" ? t("sfx.macro.character") : key === "pitch" ? t("sfx.macro.pitch") : key === "body" ? t("sfx.macro.body") : key === "noise" ? t("sfx.macro.noise") : key === "space" ? t("sfx.macro.space") : t("sfx.macro.length");
  return (
    <div className="sfx-workspace" data-testid="sfx-panel">
      <div className="sfx-hero"><div className="eyebrow">{t("sfx.recipeBuiltin")}</div><h2>{t("sfx.laserPulse")}</h2><p>{t("sfx.laserDescription")}</p><div className="waveform" aria-label={t("sfx.waveform")}>{Array.from({ length: 54 }, (_, index) => <i key={index} style={{ height: `${18 + ((index * 29) % 66)}%` }} />)}</div><div className="sfx-hero-actions"><button type="button" className="primary-button" onClick={() => onAnnounce(t("status.previewingLaser"))}>▶ {t("sfx.preview")}</button><button type="button" className="ghost-button" onClick={onFreeze}>{t("sfx.freezeTrack")}</button></div></div>
      <div className="macro-card"><div className="card-heading"><span>{t("sfx.macros")}</span><span className="muted-label">{t("sfx.lockedHint")}</span></div><div className="macro-grid">{Object.entries(macros).map(([key, value]) => <label className="macro-control" key={key}><span className="macro-dial" style={{ "--dial": `${value * 2.9}deg` } as React.CSSProperties}><i /></span><span>{macroLabel(key)}</span><input type="range" min="0" max="100" value={value} onChange={(event) => setMacros((current) => ({ ...current, [key]: Number(event.target.value) }))} /></label>)}</div></div>
      <div className="sfx-bottom-grid"><div className="sfx-note"><span className="note-mark">i</span><span>{t("sfx.deterministicHint")}</span></div><button type="button" className="ghost-button" onClick={() => onAnnounce(t("status.advancedExpanded"))}>{t("sfx.advancedParameters")} <span>⌄</span></button></div>
    </div>
  );
}

function SfxInspector({ seed, locked, setLocked, onSeedChange, onRandomize, onAnnounce }: { seed: number; locked: boolean; setLocked: (value: boolean) => void; onSeedChange: (value: number) => void; onRandomize: () => void; onAnnounce: (message: string) => void }) {
  const t = useTranslation();
  return <div className="sfx-inspector-card"><div className="card-heading"><span>{t("sfx.renderControl")}</span><span className="recipe-version">{t("sfx.recipeVersion")}</span></div><div className="inspector-row"><span>{t("sfx.seed")}</span><div className="inline-control"><input aria-label={t("sfx.seedLabel")} type="number" value={seed} onChange={(event) => onSeedChange(Number(event.target.value))} /><button type="button" className={`lock-button ${locked ? "locked" : ""}`} aria-label={locked ? t("sfx.unlockSeed") : t("sfx.lockSeed")} onClick={() => setLocked(!locked)}>{locked ? "▣" : "□"}</button></div></div><div className="inspector-row"><span>{t("sfx.variants")}</span><select aria-label={t("sfx.variantCount")} defaultValue="8"><option value="1">{t("sfx.variant.one")}</option><option value="8">{t("sfx.variant.eight")}</option><option value="16">{t("sfx.variant.sixteen")}</option><option value="32">{t("sfx.variant.thirtyTwo")}</option></select></div><div className="inspector-row"><span>{t("sfx.peakTarget")}</span><span className="value-readout">-1.0 dBFS</span></div><div className="inspector-actions"><button type="button" className="ghost-button" onClick={onRandomize}>⤨ {t("sfx.randomize")}</button><button type="button" className="primary-button" onClick={() => onAnnounce(t("status.batchQueued"))}>{t("sfx.exportBatch")}</button></div></div>;
}

function TrackInspector({ track, clip, onUpdateClip, onDuplicate, onSplit, onAnnounce }: { track?: Track; clip?: Clip; onUpdateClip: (patch: Partial<Clip>) => void; onDuplicate: () => void; onSplit: () => void; onAnnounce: (message: string) => void }) {
  const t = useTranslation();
  if (!track || !clip) return <div className="empty-inspector"><span className="empty-icon">⌁</span><strong>{t("inspector.selectClip")}</strong><span>{t("inspector.selectClipHint")}</span></div>;
  return <div className="inspector-content"><div className="selected-object"><span className={`track-icon ${track.color}`}>{track.icon}</span><div><strong>{clip.name}</strong><small>{track.name} · {t("inspector.patternClip")}</small></div></div><div className="inspector-section"><div className="section-label">{t("inspector.clipTransform")}</div><div className="inspector-row"><span>{t("inspector.position")}</span><span className="value-readout">{Math.round(clip.left / 64 + 1)}.1.00</span></div><div className="inspector-row"><span>{t("inspector.length")}</span><input aria-label={t("inspector.clipLength")} type="range" min="40" max="420" value={clip.width} onChange={(event) => onUpdateClip({ width: Number(event.target.value) })} /></div><div className="inspector-row"><span>{t("inspector.color")}</span><span className={`color-chip ${clip.tone}`} /></div></div><div className="inspector-section"><div className="section-label">{t("inspector.actions")}</div><div className="inspector-actions stacked"><button type="button" className="ghost-button" onClick={onDuplicate}>⧉ {t("inspector.duplicate")} <span className="hint-key">Ctrl+D</span></button><button type="button" className="ghost-button" onClick={onSplit}>⫽ {t("inspector.split")}</button><button type="button" className="ghost-button" onClick={() => onAnnounce(t("status.freezeReady"))}>◈ {t("inspector.freezeAudio")}</button></div></div><div className="inspector-note"><span>⌘</span> {t("inspector.commandBoundary")}</div></div>;
}

function MixerFocus({ tracks, onMute, onGain }: { tracks: Track[]; onMute: (id: number) => void; onGain: (id: number, gain: number) => void }) {
  const t = useTranslation();
  return <div className="mixer-focus" data-testid="mixer-panel"><div className="mixer-focus-intro"><div className="eyebrow">{t("mixer.liveView")}</div><h2>{t("mixer.headline")}</h2><p>{t("mixer.description")}</p></div><div className="mixer-focus-grid">{tracks.map((track) => <MixerStrip key={track.id} track={track} onMute={() => onMute(track.id)} onGain={(gain) => onGain(track.id, gain)} large />)}</div></div>;
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

function App() {
  return <I18nProvider><AppContent /></I18nProvider>;
}

export default App;
