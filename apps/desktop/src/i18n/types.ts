import type { en } from "./dictionaries/en";

export const locales = ["en", "zh-TW", "ja", "ko"] as const;

export type Locale = (typeof locales)[number];
export type TranslationKey = keyof typeof en;
export type TranslationDictionary = Readonly<Record<TranslationKey, string>>;
export type TranslationVariables = Readonly<Record<string, string | number>>;
export type Translate = (key: TranslationKey, variables?: TranslationVariables) => string;
