import { dictionaries, fallbackLocale } from "./dictionaries";
import type { Locale, Translate, TranslationKey, TranslationVariables } from "./types";

const TOKEN_PATTERN = /\{([\w-]+)\}/g;

export function interpolate(message: string, variables: TranslationVariables = {}): string {
  return message.replace(TOKEN_PATTERN, (token, name: string) => {
    const value = variables[name];
    return value === undefined ? token : String(value);
  });
}

export function translate(locale: Locale, key: TranslationKey, variables?: TranslationVariables): string {
  const message = dictionaries[locale]?.[key] ?? dictionaries[fallbackLocale][key] ?? key;
  return interpolate(message, variables);
}

export function createTranslator(locale: Locale): Translate {
  return (key, variables) => translate(locale, key, variables);
}
