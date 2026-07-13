import { invoke } from "@tauri-apps/api/core";

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
  shell: string;
}

export interface AudioStatus {
  state: string;
  deviceName: string | null;
  sampleRate: number;
  bufferSize: number;
  xrunCount: number;
  engineAvailable: boolean;
}

export interface AudioDeviceInfo {
  id: string;
  name: string;
  host: string;
  sampleRate: number;
  channels: number;
  isDefault: boolean;
}

export interface NoteEvent {
  startBeat: number;
  lengthBeats: number;
  midiNote: number;
  velocity: number;
}

export interface Pattern {
  lengthBeats: number;
  notes: NoteEvent[];
}

export interface ProjectClip {
  id: string;
  name: string;
  startTick: number;
  lengthTicks: number;
  patternId: string | null;
  loopEnabled: boolean;
}

export type TrackKind = "instrument" | "audio" | "bus";
export type Waveform = "sine" | "triangle" | "saw" | "square";

export interface ProjectTrack {
  id: string;
  name: string;
  kind: TrackKind;
  color: string;
  gain: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  armed: boolean;
  pattern: Pattern;
  clips: ProjectClip[];
  waveform: Waveform;
}

export interface Project {
  schemaVersion: 1;
  id: string;
  name: string;
  sampleRate: number;
  ppq: number;
  bpm: number;
  tempoMap: Array<{ tick: number; bpm: number }>;
  timeSignatures: Array<{ tick: number; numerator: number; denominator: number }>;
  tracks: ProjectTrack[];
  devices: Array<{ id: string; kind: string; parameters: Record<string, number> }>;
  automation: Array<{ target: string; points: Array<{ tick: number; value: number }> }>;
  assets: Array<{ id: string; kind: string; path: string; sha256: string; size: number }>;
}

export interface ProjectSummary {
  id: string;
  name: string;
  fileName: string;
}

export interface DesktopState {
  appInfo: AppInfo;
  audioStatus: AudioStatus;
  error?: string;
}

const PROJECT_STORAGE_KEY = "sonicforge.preview.projects.v1";
const AUTOSAVE_STORAGE_KEY = "sonicforge.autosave.v1";

const fallbackAudioStatus: AudioStatus = {
  state: "unavailable",
  deviceName: null,
  sampleRate: 48_000,
  bufferSize: 256,
  xrunCount: 0,
  engineAvailable: false,
};

const fallbackState: DesktopState = {
  appInfo: { name: "SonicForge Studio", version: "0.1.0", platform: "browser-preview", shell: "web-preview" },
  audioStatus: fallbackAudioStatus,
};

const previewDevices: AudioDeviceInfo[] = [
  { id: "system-default", name: "System Default Output", host: "WASAPI", sampleRate: 48_000, channels: 2, isDefault: true },
  { id: "studio-interface", name: "Studio Interface 1–2", host: "WASAPI", sampleRate: 96_000, channels: 2, isDefault: false },
];

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

function hasTauriRuntime(): boolean {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

function readPreviewProjects(): Project[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const value = JSON.parse(localStorage.getItem(PROJECT_STORAGE_KEY) ?? "[]") as unknown;
    return Array.isArray(value) ? value as Project[] : [];
  } catch {
    return [];
  }
}

function writePreviewProjects(projects: Project[]): void {
  if (typeof localStorage !== "undefined") localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(projects));
}

export function createDemoProject(): Project {
  return {
    schemaVersion: 1,
    id: "sonicforge-demo",
    name: "SonicForge Demo",
    sampleRate: 48_000,
    ppq: 960,
    bpm: 120,
    tempoMap: [{ tick: 0, bpm: 120 }],
    timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }],
    tracks: [{
      id: "lead-synth",
      name: "Lead Synth",
      kind: "instrument",
      color: "#60d9d2",
      gain: 0.72,
      pan: 0,
      muted: false,
      solo: false,
      armed: false,
      pattern: {
        lengthBeats: 16,
        notes: [
          { startBeat: 0, lengthBeats: 1, midiNote: 60, velocity: 0.72 },
          { startBeat: 1, lengthBeats: 1, midiNote: 62, velocity: 0.61 },
          { startBeat: 2, lengthBeats: 2, midiNote: 64, velocity: 0.85 },
        ],
      },
      clips: [{ id: "lead-pattern-01", name: "Lead Pattern 01", startTick: 0, lengthTicks: 7680, patternId: "lead-pattern", loopEnabled: true }],
      waveform: "saw",
    }],
    devices: [],
    automation: [],
    assets: [],
  };
}

export async function loadDesktopState(): Promise<DesktopState> {
  if (!hasTauriRuntime()) return fallbackState;
  try {
    const [appInfo, audioStatus] = await Promise.all([invoke<AppInfo>("get_app_info"), invoke<AudioStatus>("get_audio_status")]);
    return { appInfo, audioStatus };
  } catch (error) {
    return { ...fallbackState, error: error instanceof Error ? error.message : "Tauri command unavailable" };
  }
}

export async function listAudioDevices(): Promise<AudioDeviceInfo[]> {
  return hasTauriRuntime() ? invoke<AudioDeviceInfo[]>("list_audio_devices") : previewDevices;
}

export async function startAudioDevice(deviceId: string | null, sampleRate: number, bufferSize: number): Promise<AudioStatus> {
  if (hasTauriRuntime()) return invoke<AudioStatus>("start_audio_device", { deviceId, sampleRate, bufferSize });
  const device = previewDevices.find((item) => item.id === deviceId) ?? previewDevices[0];
  return { ...fallbackAudioStatus, state: "preview-running", deviceName: device.name, sampleRate, bufferSize, engineAvailable: true };
}

export async function stopAudioDevice(): Promise<AudioStatus> {
  return hasTauriRuntime() ? invoke<AudioStatus>("stop_audio_device") : { ...fallbackAudioStatus, state: "preview-stopped" };
}

export async function startTransport(
  project: Project,
  deviceId: string | null,
  sampleRate: number,
  bufferSize: number,
): Promise<AudioStatus> {
  if (!hasTauriRuntime()) {
    const device = previewDevices.find((item) => item.id === deviceId) ?? previewDevices[0];
    return { ...fallbackAudioStatus, state: "preview-running", deviceName: device.name, sampleRate, bufferSize, engineAvailable: true };
  }
  return invoke<AudioStatus>("transport_start", { project, deviceId, sampleRate, bufferSize });
}

export async function transportPlay(): Promise<AudioStatus> {
  return hasTauriRuntime() ? invoke<AudioStatus>("transport_play") : { ...fallbackAudioStatus, state: "preview-running", engineAvailable: true };
}

export async function transportPause(): Promise<AudioStatus> {
  return hasTauriRuntime() ? invoke<AudioStatus>("transport_pause") : { ...fallbackAudioStatus, state: "preview-paused", engineAvailable: true };
}

export async function transportStop(): Promise<AudioStatus> {
  return hasTauriRuntime() ? invoke<AudioStatus>("transport_stop") : { ...fallbackAudioStatus, state: "preview-stopped", engineAvailable: true };
}

export async function writeRecoveryJournal(project: Project): Promise<number> {
  return hasTauriRuntime() ? invoke<number>("write_recovery_journal", { project }) : 0;
}

export async function recoverProject(): Promise<Project | null> {
  return hasTauriRuntime() ? invoke<Project | null>("recover_project") : null;
}

export async function importMidi(bytes: Uint8Array): Promise<Project> {
  if (!hasTauriRuntime()) throw new Error("MIDI import requires the desktop engine");
  return invoke<Project>("import_midi", { bytes: Array.from(bytes) });
}

export async function exportMidi(project: Project, format: "type0" | "type1" = "type1"): Promise<Uint8Array> {
  if (!hasTauriRuntime()) throw new Error("MIDI export requires the desktop engine");
  const bytes = await invoke<number[]>("export_midi", { project, format });
  return new Uint8Array(bytes);
}

export async function saveProject(project: Project): Promise<ProjectSummary> {
  if (hasTauriRuntime()) return invoke<ProjectSummary>("save_project", { project });
  const projects = readPreviewProjects().filter((item) => item.id !== project.id);
  writePreviewProjects([...projects, project]);
  return { id: project.id, name: project.name, fileName: `${project.id}.sfsproj` };
}

export async function loadProject(projectId: string): Promise<Project> {
  if (hasTauriRuntime()) return invoke<Project>("load_project", { projectId });
  const project = readPreviewProjects().find((item) => item.id === projectId);
  if (!project) throw new Error(`Project '${projectId}' was not found`);
  return project;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  if (hasTauriRuntime()) return invoke<ProjectSummary[]>("list_projects");
  return readPreviewProjects().map((project) => ({ id: project.id, name: project.name, fileName: `${project.id}.sfsproj` }));
}

export function saveAutosavePreference(enabled: boolean, intervalMinutes: number): void {
  if (typeof localStorage !== "undefined") localStorage.setItem(AUTOSAVE_STORAGE_KEY, JSON.stringify({ enabled, intervalMinutes }));
}
