// ---------------------------------------------------------------------------
// Payload builders for the official Meta WhatsApp Cloud API.
// Reusable: text, reply buttons, interactive buttons, list messages, native
// Flow launch. Official API only.
// ---------------------------------------------------------------------------
import { type Lang, tr } from "../i18n/lang.js";

export interface WaButton {
  id: string;
  title: string; // max 20 chars
}

export interface WaListSectionRow {
  id: string;
  title: string; // max 24 chars
  description?: string; // max 72 chars
}

export function textMessagePayload(to: string, body: string) {
  return { messaging_product: "whatsapp", to, type: "text", text: { body, preview_url: false } };
}

export function buttonMessagePayload(to: string, body: string, buttons: WaButton[]) {
  return {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: body },
      action: {
        buttons: buttons.slice(0, 3).map((b) => ({
          type: "reply",
          reply: { id: b.id, title: b.title.slice(0, 20) },
        })),
      },
    },
  };
}

export function listMessagePayload(to: string, body: string, buttonLabel: string, sections: { title: string; rows: WaListSectionRow[] }[]) {
  return {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: body },
      action: {
        button: buttonLabel.slice(0, 20),
        sections: sections.map((s) => ({
          title: s.title.slice(0, 24),
          rows: s.rows.slice(0, 10).map((r) => ({
            id: r.id,
            title: r.title.slice(0, 24),
            ...(r.description ? { description: r.description.slice(0, 72) } : {}),
          })),
        })),
      },
    },
  };
}

// Launch a WhatsApp-native Flow (no external browser).
export function flowMessagePayload(to: string, flowId: string, flowToken: string, body: string, buttonLabel: string) {
  return {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "flow",
      body: { text: body },
      action: {
        name: "flow",
        parameters: {
          flow_message_version: "3",
          flow_token: flowToken,
          flow_id: flowId,
          flow_cta: buttonLabel.slice(0, 20),
          flow_action: "navigate",
          mode: "draft",
          flow_action_payload: {
            screen: "INIT",
          },
        },
      },
    },
  };
}

// Action ids - button/list replies map to backend actions in whatsapp.handler
export const ACTIONS = {
  START: "start",
  CREATE_ACCOUNT: "create_account",
  YES: "yes",
  NO: "no",
  BALANCE: "menu_balance",
  SEND_MONEY: "menu_send",
  TRANSACTIONS: "menu_tx",
  REFERRALS: "menu_referrals",
  ACCOUNT: "menu_account",
  HELP: "menu_help",
  REQUESTS: "menu_requests",
  NEW_REQUEST: "req_new",
  ESCROW_YES: "escrow_yes",
  ESCROW_NO: "escrow_no",
  CREATE_PIN: "create_pin",
  CONFIRM_TRANSFER: "confirm_transfer",
  CANCEL: "cancel_action",
  // Language selection / switching
  LANG_AR: "lang_ar",
  LANG_EN: "lang_en",
  CHANGE_LANGUAGE: "change_language",
} as const;

// ---------------- Language selection (first contact + settings) ----------------

export const LANGUAGE_PROMPT_TEXT =
  "\u{1F310} اختار لغتك\nChoose your language";

export const LANGUAGE_BUTTONS: WaButton[] = [
  { id: ACTIONS.LANG_AR, title: "\u{1F1EA}\u{1F1EC} العربي" },
  { id: ACTIONS.LANG_EN, title: "\u{1F1EC}\u{1F1E7} English" },
];

export function languageSavedText(lang: Lang): string {
  return tr(lang, "\u2705 تمام، هتكلمك بالعربي من دلوقتي.", "\u2705 Got it, I'll speak English from now on.");
}

export function greetingText(lang: Lang): string {
  return tr(
    lang,
    "أهلاً بيك في WTS Pay \u{1F4B3}\nمحفظة رقمية تجريبية — الأرصدة الوهمية مالهاش قيمة نقدية فعلية.\nاختار:",
    "Welcome to WTS Pay \u{1F4B3}\nDemo digital wallet — demo credits have no cash value.\nChoose an option:"
  );
}

export function startButton(lang: Lang): WaButton {
  return { id: ACTIONS.START, title: tr(lang, "\u{1F680} ابدأ", "\u{1F680} Start") };
}

export function mainMenuRows(lang: Lang): WaListSectionRow[] {
  return [
    { id: ACTIONS.BALANCE, title: tr(lang, "\u{1F4B0} الرصيد", "\u{1F4B0} Balance"), description: tr(lang, "اعرف رصيدك التجريبي", "Check your demo balance") },
    { id: ACTIONS.SEND_MONEY, title: tr(lang, "\u{1F4B8} تحويل فلوس", "\u{1F4B8} Send Money"), description: tr(lang, "حوّل لمستخدم تاني في WTS", "Transfer to another WTS user") },
    { id: ACTIONS.REQUESTS, title: tr(lang, "\u{1F64F} طلبات تحويل", "\u{1F64F} Money Requests"), description: tr(lang, "اطلب فلوس من حد، أو رد على طلب", "Ask someone to pay you, or respond") },
    { id: ACTIONS.TRANSACTIONS, title: tr(lang, "\u{1F4DC} العمليات", "\u{1F4DC} Transactions"), description: tr(lang, "آخر نشاط في حسابك", "Your recent activity") },
    { id: ACTIONS.REFERRALS, title: tr(lang, "\u{1F381} الإحالات", "\u{1F381} Referrals"), description: tr(lang, "ادعُ أصحابك واكسب رصيد تجريبي", "Invite and earn demo credits") },
    { id: ACTIONS.ACCOUNT, title: tr(lang, "\u{1F464} حسابي", "\u{1F464} My Account"), description: tr(lang, "البيانات الشخصية وحالة الحساب", "Profile, WTS ID and status") },
    { id: ACTIONS.HELP, title: tr(lang, "\u2753 مساعدة", "\u2753 Help"), description: tr(lang, "إزاي WTS Pay التجريبي بيشتغل", "How WTS Pay demo works") },
    { id: ACTIONS.CHANGE_LANGUAGE, title: tr(lang, "\u{1F310} اللغة", "\u{1F310} Language"), description: tr(lang, "غيّر لغة المحادثة", "Change the bot's language") },
  ];
}

export function approvalMessage(lang: Lang, wtsId: string, walletId: string, balance: number): string {
  return tr(
    lang,
    `\u{1F389} تم قبول حسابك في WTS Pay.\n` +
      `محفظتك بقت شغالة دلوقتي.\n\n` +
      `كود WTS:\n${wtsId}\nالمحفظة:\n${walletId}\nالرصيد:\n${balance} جنيه\n\n` +
      `الخطوة الجاية: اعمل رقم سري (PIN) من 6 أرقام للعمليات.`,
    `\u{1F389} Your WTS Pay account has been approved.\n` +
      `Your wallet is now active.\n\n` +
      `WTS ID:\n${wtsId}\nWallet:\n${walletId}\nBalance:\n${balance} EGP\n\n` +
      `Next step: create your 6-digit WTS transaction PIN.`
  );
}

export function numberNoText(lang: Lang): string {
  return tr(
    lang,
    "رقم الواتساب اللي بيوصلنا من الـ API الرسمي هو هوية القناة المعتمدة، فمينفعش نعمل حساب غير بنفس رقم الواتساب ده بالظبط. لو ده مش رقمك، كمّل من حساب الواتساب بتاعك إنت.",
    "The WhatsApp identity received from the official API is the authoritative channel identity, so an account can only be created for this exact WhatsApp number. If this is not your number, please continue from your own WhatsApp account."
  );
}
