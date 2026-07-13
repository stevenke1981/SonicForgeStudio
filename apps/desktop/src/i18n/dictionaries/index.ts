import { en } from "./en";
import { ja } from "./ja";
import { ko } from "./ko";
import { zhTW } from "./zh-TW";
import type { Locale, TranslationDictionary } from "../types";

export const dictionaries = {
  en,
  "zh-TW": zhTW,
  ja,
  ko,
} satisfies Record<Locale, TranslationDictionary>;

export const fallbackLocale: Locale = "en";

export const localeDisplayNames = {
  en: "English",
  "zh-TW": "繁體中文",
  ja: "日本語",
  ko: "한국어",
} as const satisfies Record<Locale, string>;
