// ---------------------------------------------------------------------------
// Minimal language helper shared across the WhatsApp bot. Every piece of
// user-facing text in the bot takes a `lang` argument and picks between the
// Arabic (Egyptian) and English copies with `tr()`. There is no separate key
// dictionary to keep in sync — the two strings live side by side at the call
// site, so a translator can find and edit them in context.
// ---------------------------------------------------------------------------

export type Lang = "ar" | "en";

export function normalizeLang(value: unknown): Lang {
  return value === "en" ? "en" : "ar";
}

/** Pick the Arabic or English copy for the given language. */
export function tr(lang: Lang, ar: string, en: string): string {
  return lang === "en" ? en : ar;
}
