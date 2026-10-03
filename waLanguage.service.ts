// ---------------------------------------------------------------------------
// Tracks the language a brand-new WhatsApp contact picked BEFORE they have a
// User row (registration hasn't started yet). Stored in the existing Config
// table (key "wa_pending_lang:<waId>") so no extra table is needed — once
// registration starts, the choice is copied onto the real User.language
// column and this entry is no longer read.
// ---------------------------------------------------------------------------
import type { Db } from "../utils/prisma.js";
import type { Lang } from "../i18n/lang.js";
import { normalizeLang } from "../i18n/lang.js";

function keyFor(waId: string): string {
  return `wa_pending_lang:${waId}`;
}

export async function getPendingLanguage(db: Db, waId: string): Promise<Lang | null> {
  const row = await (db as any).config?.findUnique?.({ where: { key: keyFor(waId) } });
  const value = row?.value as { language?: string } | undefined;
  if (!value?.language) return null;
  return normalizeLang(value.language);
}

export async function setPendingLanguage(db: Db, waId: string, lang: Lang): Promise<void> {
  await (db as any).config.upsert({
    where: { key: keyFor(waId) },
    update: { value: { language: lang } },
    create: { key: keyFor(waId), value: { language: lang } },
  });
}
