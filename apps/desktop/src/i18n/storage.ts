import { locales } from "./types";
import type { Locale } from "./types";

export const LOCALE_STORAGE_KEY = "sonicforge.locale.v1";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function normalizeLocale(value: string | null | undefined): Locale | null {
  if (!value) return null;
  const normalized = value.replaceAll("_", "-").toLowerCase();
  if (normalized === "zh" || normalized === "zh-tw" || normalized === "zh-hant" || normalized.startsWith("zh-hant-")) return "zh-TW";
  if (normalized === "ja" || normalized.startsWith("ja-")) return "ja";
  if (normalized === "ko" || normalized.startsWith("ko-")) return "ko";
  if (normalized === "en" || normalized.startsWith("en-")) return "en";
  return locales.find((locale) => locale.toLowerCase() === normalized) ?? null;
}

function browserStorage(): StorageLike | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function readStoredLocale(storage: StorageLike | undefined = browserStorage()): Locale | null {
  try {
    return normalizeLocale(storage?.getItem(LOCALE_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function persistLocale(locale: Locale, storage: StorageLike | undefined = browserStorage()): boolean {
  try {
    storage?.setItem(LOCALE_STORAGE_KEY, locale);
    return Boolean(storage);
  } catch {
    return false;
  }
}

export function detectLocale(candidates?: readonly string[]): Locale {
  const browserCandidates = candidates ?? (typeof navigator === "undefined" ? [] : navigator.languages);
  for (const candidate of browserCandidates) {
    const locale = normalizeLocale(candidate);
    if (locale) return locale;
  }
  return "en";
}

export function getInitialLocale(candidates?: readonly string[], storage?: StorageLike): Locale {
  return readStoredLocale(storage) ?? detectLocale(candidates);
}
