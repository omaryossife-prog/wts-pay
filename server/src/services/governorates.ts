// ---------------------------------------------------------------------------
// The 27 Egyptian governorates — used both by the registration-details
// WhatsApp Flow (Dropdown data-source, server/flows/wts-registration-details.flow.json)
// and by the chat-based fallback (numbered text list) when that Flow isn't
// configured yet. Keep this list and the Flow's data-source in sync if either
// changes.
// ---------------------------------------------------------------------------
import { type Lang, tr } from "../i18n/lang.js";

export interface Governorate {
  code: string;
  ar: string;
  en: string;
}

export const GOVERNORATES: Governorate[] = [
  { code: "CAI", ar: "القاهرة", en: "Cairo" },
  { code: "GIZ", ar: "الجيزة", en: "Giza" },
  { code: "QLY", ar: "القليوبية", en: "Qalyubia" },
  { code: "ALX", ar: "الإسكندرية", en: "Alexandria" },
  { code: "BEH", ar: "البحيرة", en: "Beheira" },
  { code: "KFS", ar: "كفر الشيخ", en: "Kafr El Sheikh" },
  { code: "DAK", ar: "الدقهلية", en: "Dakahlia" },
  { code: "DAM", ar: "دمياط", en: "Damietta" },
  { code: "SHR", ar: "الشرقية", en: "Sharqia" },
  { code: "GHR", ar: "الغربية", en: "Gharbia" },
  { code: "MNF", ar: "المنوفية", en: "Monufia" },
  { code: "PTS", ar: "بورسعيد", en: "Port Said" },
  { code: "ISM", ar: "الإسماعيلية", en: "Ismailia" },
  { code: "SUZ", ar: "السويس", en: "Suez" },
  { code: "NSI", ar: "شمال سيناء", en: "North Sinai" },
  { code: "SSI", ar: "جنوب سيناء", en: "South Sinai" },
  { code: "BNS", ar: "بني سويف", en: "Beni Suef" },
  { code: "FYM", ar: "الفيوم", en: "Faiyum" },
  { code: "MNY", ar: "المنيا", en: "Minya" },
  { code: "AST", ar: "أسيوط", en: "Asyut" },
  { code: "SHG", ar: "سوهاج", en: "Sohag" },
  { code: "QNA", ar: "قنا", en: "Qena" },
  { code: "LXR", ar: "الأقصر", en: "Luxor" },
  { code: "ASN", ar: "أسوان", en: "Aswan" },
  { code: "RSA", ar: "البحر الأحمر", en: "Red Sea" },
  { code: "WAD", ar: "الوادي الجديد", en: "New Valley" },
  { code: "MAT", ar: "مطروح", en: "Matrouh" },
];

export function governorateByCode(code: string): Governorate | undefined {
  return GOVERNORATES.find((g) => g.code === code);
}

export function governorateLabel(code: string | null | undefined, lang: Lang = "ar"): string {
  const g = code ? governorateByCode(code) : undefined;
  if (!g) return tr(lang, "-", "-");
  return tr(lang, g.ar, g.en);
}

// Numbered text list for the chat fallback, e.g.:
// "1. القاهرة\n2. الجيزة\n..."
export function governoratesNumberedList(lang: Lang = "ar"): string {
  return GOVERNORATES.map((g, i) => `${i + 1}. ${tr(lang, g.ar, g.en)}`).join("\n");
}

// Accepts a typed number ("3") or an exact name in either language.
export function matchGovernorate(raw: string): Governorate | null {
  const s = raw.trim();
  const asNumber = Number(s);
  if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= GOVERNORATES.length) {
    return GOVERNORATES[asNumber - 1];
  }
  const normalized = s.replace(/\s+/g, " ").toLowerCase();
  return (
    GOVERNORATES.find((g) => g.ar === s.replace(/\s+/g, " ") || g.en.toLowerCase() === normalized) ?? null
  );
}
