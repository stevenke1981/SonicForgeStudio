import { describe, expect, it } from "vitest";
import { createTranslator, localeDisplayNames, locales, normalizeLocale, persistLocale, readStoredLocale } from "./index";

describe("i18n foundation", () => {
  it("translates typed keys and interpolates templates", () => {
    const t = createTranslator("zh-TW");
    expect(t("app.editor.song")).toBe("歌曲編輯器");
    expect(t("template.saved", { fileName: "demo.sfsproj" })).toContain("demo.sfsproj");
  });

  it("normalizes supported browser locale variants", () => {
    expect(normalizeLocale("zh_Hant")).toBe("zh-TW");
    expect(normalizeLocale("zh-Hant-TW")).toBe("zh-TW");
    expect(normalizeLocale("zh_Hant_TW")).toBe("zh-TW");
    expect(normalizeLocale("ja-JP")).toBe("ja");
    expect(normalizeLocale("fr-FR")).toBeNull();
  });

  it("persists locale without depending on browser localStorage", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    expect(persistLocale("ko", storage)).toBe(true);
    expect(readStoredLocale(storage)).toBe("ko");
  });

  it("provides a display name for every locale", () => {
    expect(locales.every((locale) => Boolean(localeDisplayNames[locale]))).toBe(true);
  });
});
