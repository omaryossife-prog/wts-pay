import type { TranslationShape } from "./translations";

// يحوّل نوع العملية من قاعدة البيانات لنص مترجم
export function txType(t: TranslationShape, raw: string): string {
  const key = raw.toLowerCase().replace(/ /g, "_") as keyof typeof t.tx.types;
  return t.tx.types[key] ?? raw.replace(/_/g, " ").toLowerCase();
}

// يحوّل حالة العملية
export function txStatus(t: TranslationShape, raw: string): string {
  const key = raw.toLowerCase() as keyof typeof t.tx.statuses;
  return t.tx.statuses[key] ?? raw;
}

// يحوّل حالة بلاغ النصب
export function fraudStatus(t: TranslationShape, raw: string): string {
  const key = raw.toLowerCase() as keyof typeof t.tx.fraudStatuses;
  return t.tx.fraudStatuses[key] ?? raw;
}

// يحوّل حالة التحقق
export function verifStatus(t: TranslationShape, raw: string): string {
  const key = raw.toLowerCase().replace(/ /g, "_") as keyof typeof t.tx.verifStatuses;
  return t.tx.verifStatuses[key] ?? raw.replace(/_/g, " ");
}
