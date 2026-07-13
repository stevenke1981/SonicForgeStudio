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

export interface DesktopState {
  appInfo: AppInfo;
  audioStatus: AudioStatus;
  error?: string;
}

const fallbackState: DesktopState = {
  appInfo: {
    name: "SonicForge Studio",
    version: "0.1.0",
    platform: "browser-preview",
    shell: "web-preview",
  },
  audioStatus: {
    state: "unavailable",
    deviceName: null,
    sampleRate: 48_000,
    bufferSize: 256,
    xrunCount: 0,
    engineAvailable: false,
  },
};

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export async function loadDesktopState(): Promise<DesktopState> {
  if (typeof window === "undefined" || !window.__TAURI_INTERNALS__) {
    return fallbackState;
  }

  try {
    const [appInfo, audioStatus] = await Promise.all([
      invoke<AppInfo>("get_app_info"),
      invoke<AudioStatus>("get_audio_status"),
    ]);
    return { appInfo, audioStatus };
  } catch (error) {
    return {
      ...fallbackState,
      error: error instanceof Error ? error.message : "Tauri command unavailable",
    };
  }
}
