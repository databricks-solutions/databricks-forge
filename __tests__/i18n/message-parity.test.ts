/**
 * Task 7 Req4: message catalog key parity.
 *
 * Every supported locale must define exactly the same set of message keys as
 * the canonical English catalog — no missing keys (untranslated UI) and no
 * extra keys (dead translations). This guards the Estate Programs / Domain
 * Explorer / Relationships / Portfolio / source-scan strings externalized in
 * this task and every future string.
 */

import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "@/i18n/config";
import en from "@/messages/en.json";
import ptBR from "@/messages/pt-BR.json";
import es from "@/messages/es.json";

type Json = Record<string, unknown>;

function flatten(obj: Json, prefix = "", acc: Record<string, string> = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      flatten(v as Json, key, acc);
    } else {
      acc[key] = String(v);
    }
  }
  return acc;
}

const catalogs: Record<string, Json> = {
  en: en as Json,
  "pt-BR": ptBR as Json,
  es: es as Json,
};

const enKeys = Object.keys(flatten(en as Json)).sort();

describe("message catalog parity", () => {
  it("covers every supported locale", () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(catalogs[locale], `missing catalog for ${locale}`).toBeTruthy();
    }
  });

  for (const locale of SUPPORTED_LOCALES) {
    if (locale === "en") continue;
    it(`${locale} has the same key set as en`, () => {
      const keys = Object.keys(flatten(catalogs[locale])).sort();
      const missing = enKeys.filter((k) => !keys.includes(k));
      const extra = keys.filter((k) => !enKeys.includes(k));
      expect(missing, `${locale} is missing keys`).toEqual([]);
      expect(extra, `${locale} has extra keys`).toEqual([]);
    });

    it(`${locale} has no empty message values`, () => {
      const flat = flatten(catalogs[locale]);
      const empties = Object.entries(flat)
        .filter(([, v]) => v.trim() === "")
        .map(([k]) => k);
      expect(empties, `${locale} has empty values`).toEqual([]);
    });
  }

  it("every en message has an ICU-consistent placeholder set across locales", () => {
    const flatEn = flatten(en as Json);
    // Match ICU argument declarations (`{name}` / `{count, plural, ...}`), not
    // branch text such as `{Added # scopes}` nested inside a plural block.
    const placeholderRe = /\{(\w+)(?=\s*[,}])/g;
    const mismatches: string[] = [];
    for (const [key, enVal] of Object.entries(flatEn)) {
      const enVars = new Set([...enVal.matchAll(placeholderRe)].map((m) => m[1]));
      for (const locale of SUPPORTED_LOCALES) {
        if (locale === "en") continue;
        const localeVal = flatten(catalogs[locale])[key] ?? "";
        const localeVars = new Set([...localeVal.matchAll(placeholderRe)].map((m) => m[1]));
        for (const v of enVars) {
          if (!localeVars.has(v)) mismatches.push(`${locale}:${key} missing {${v}}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });
});
