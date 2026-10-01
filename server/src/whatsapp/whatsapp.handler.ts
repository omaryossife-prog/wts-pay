// ---------------------------------------------------------------------------
// Routes incoming WhatsApp messages to actions.
// Flow: WhatsApp -> Webhook -> Handler -> Existing WTS services -> Supabase.
// Identity: stable wa_id from the official API (never the profile name).
// Authorization: WTS 6-digit PIN via native Flow (preferred) or documented
// chat fallback. A plain incoming message NEVER authorizes a transfer.
//
// LANGUAGE: a brand-new WhatsApp contact is asked to pick Arabic/English
// before anything else. The choice is stored against their waId (Config
// table, see waLanguage.service.ts) until registration starts, at which
// point it becomes User.language. Any existing user can switch any time by
// typing "language"/"لغة" or tapping the Language row in the main menu.
// ---------------------------------------------------------------------------
import { prisma } from "../utils/prisma.js";
import { logger } from "../utils/logger.js";
import { sendTextMessage, sendButtonMessage, sendListMessage, markAsRead } from "./whatsapp.client.js";
import {
  ACTIONS, mainMenuRows, greetingText, startButton, numberNoText,
  LANGUAGE_PROMPT_TEXT, LANGUAGE_BUTTONS, languageSavedText,
} from "./whatsapp.templates.js";
import { sendPinFlow, sendSendMoneyFlow, sendConfirmPinFlow, sendWalletFlow } from "./whatsapp.flows.js";
import {
  SessionState, getUserByWaIdentity, getSession, setSession,
  maintenanceActive, getUserLanguage, setUserLanguage,
  startRegistration, handleNameInput, confirmNumberYes,
  handleIdFront, handleIdBack, handleFaceVideo,
  handlePinCreateInput, handlePinConfirmInput,
  getBalanceText, getTransactionsText, getReferralText, getAccountText, helpText,
  beginSendMoney, handlePhoneInput, handleAmountInput, handleEscrowChoice,
  confirmTransfer, cancelTransfer, handleAuthorizationPin,
  getRequestsMenuRows, beginMoneyRequest, handleRequestPhoneInput, handleRequestAmountInput,
  viewIncomingRequest, rejectIncomingRequest, beginAcceptRequest, handleRequestPinInput,
} from "./whatsapp.service.js";
import { getPendingLanguage, setPendingLanguage } from "../services/waLanguage.service.js";
import { type Lang, tr, normalizeLang } from "../i18n/lang.js";

export interface IncomingMessage {
  from: string;            // phone digits, e.g. "2010xxxxxxx"
  waId: string;            // stable identity from contacts[].wa_id
  profileName?: string;    // display hint ONLY - never used as identity
  id: string;              // wamid - deduped upstream
  type: "text" | "interactive" | "button" | "image" | "video" | "audio" | "document";
  text?: string;
  caption?: string;
  buttonId?: string;
  listId?: string;
}

// Text commands that open the language picker, in either language.
const LANGUAGE_COMMANDS = ["language", "lang", "لغة", "اللغة", "اللغه", "لغه"];

function fullNameHint(lang: Lang): string {
  return tr(
    lang,
    "من فضلك اكتب اسمك الرباعي بالكامل زي ما هو مكتوب في البطاقة.\n\nمثال: أحمد محمد علي حسن",
    "Please enter your full four-part legal name exactly as it appears on your ID.\n\nExample: Ahmed Mohamed Ali Hassan"
  );
}

async function sendMainMenu(to: string, userId: string, lang: Lang, firstName?: string) {
  // الفلو الموحّد بقى نقطة الدخول الأساسية — رسالة واحدة تفتح كل المحفظة.
  // لو الفلو مش متظبط لسه (WHATSAPP_WALLET_FLOW_ID)، نرجع للقائمة القديمة
  // كـ fallback موثّق، مش نظام تاني.
  const sent = await sendWalletFlow(to, userId);
  if (sent) return;
  await sendListMessage(
    to,
    firstName ? tr(lang, `أهلاً بيك تاني يا ${firstName} \u{1F44B}`, `Welcome back, ${firstName} \u{1F44B}`) : tr(lang, "القائمة الرئيسية لـ WTS Pay", "WTS Pay main menu"),
    tr(lang, "افتح القائمة", "Open menu"),
    [{ title: "WTS Pay", rows: mainMenuRows(lang) }]
  );
}

async function sendLanguagePicker(to: string) {
  await sendButtonMessage(to, LANGUAGE_PROMPT_TEXT, LANGUAGE_BUTTONS);
}

async function sendRequestsMenu(to: string, userId: string, lang: Lang) {
  const rows = await getRequestsMenuRows(userId, lang);
  await sendListMessage(to, tr(lang, "طلبات التحويل", "Money Requests"), tr(lang, "فتح", "Open"), [{ title: tr(lang, "الطلبات", "Requests"), rows }]);
}

async function routeMenuAction(userId: string, action: string, lang: Lang): Promise<string | null> {
  switch (action) {
    case ACTIONS.BALANCE: return getBalanceText(userId, lang);
    case ACTIONS.TRANSACTIONS: return getTransactionsText(userId, lang);
    case ACTIONS.REFERRALS: return getReferralText(userId, lang);
    case ACTIONS.ACCOUNT: return getAccountText(userId, lang);
    case ACTIONS.HELP: return helpText(lang);
    case ACTIONS.SEND_MONEY: return beginSendMoney(userId, lang);
    default: return null;
  }
}

export async function handleIncomingMessage(msg: IncomingMessage): Promise<void> {
  const to = msg.from;
  await markAsRead(msg.id);

  // ---------- Identity resolution (wa_id is authoritative) ----------
  let user = await getUserByWaIdentity(prisma, msg.waId, msg.from);
  const replyId = msg.buttonId ?? msg.listId;
  const text = msg.text?.trim() ?? msg.caption?.trim() ?? "";
  const lowerText = text.toLowerCase();

  // ---------- First contact / not registered ----------
  if (!user) {
    // Language choice tapped (either before or instead of "Start").
    if (replyId === ACTIONS.LANG_AR || replyId === ACTIONS.LANG_EN) {
      const chosen: Lang = replyId === ACTIONS.LANG_EN ? "en" : "ar";
      await setPendingLanguage(prisma, msg.waId, chosen);
      await sendButtonMessage(to, languageSavedText(chosen) + "\n\n" + greetingText(chosen), [startButton(chosen)]);
      return;
    }

    const pendingLang = await getPendingLanguage(prisma, msg.waId);
    if (!pendingLang) {
      // Very first message from this number - ask for a language first.
      await sendLanguagePicker(to);
      return;
    }

    if (replyId === ACTIONS.START) {
      await startRegistration(msg.waId, msg.from, msg.profileName, pendingLang);
      const u = await getUserByWaIdentity(prisma, msg.waId, msg.from);
      await sendButtonMessage(to, fullNameHint(pendingLang), [
        { id: "noop_name_hint", title: tr(pendingLang, "اكتب اسمك", "Type your name") },
      ]);
      if (u) await setSession(u.id, SessionState.REG_NAME, {});
      return;
    }
    await sendButtonMessage(to, greetingText(pendingLang), [startButton(pendingLang)]);
    return;
  }

  const lang: Lang = normalizeLang(user.language);

  // ---------- Change language (works for any existing user, any time) ----------
  if (replyId === ACTIONS.CHANGE_LANGUAGE || LANGUAGE_COMMANDS.includes(lowerText)) {
    await sendLanguagePicker(to);
    return;
  }
  if (replyId === ACTIONS.LANG_AR || replyId === ACTIONS.LANG_EN) {
    const chosen: Lang = replyId === ACTIONS.LANG_EN ? "en" : "ar";
    await setUserLanguage(user.id, chosen);
    await sendTextMessage(to, languageSavedText(chosen));
    return;
  }

  // ---------- Maintenance mode ----------
  const maint = await maintenanceActive();
  if (maint.enabled) {
    await sendTextMessage(to, maint.message);
    return;
  }

  // ---------- Rejected accounts ----------
  if (user.verificationStatus === "REJECTED") {
    await sendTextMessage(
      to,
      tr(
        lang,
        `طلب تسجيلك في WTS Pay اترفض. السبب: ${user.rejectionReason ?? "مش محدد"}. تواصل مع الدعم.`,
        `Your WTS Pay registration was rejected. Reason: ${user.rejectionReason ?? "not specified"}. Contact support.`
      )
    );
    return;
  }

  const session = await getSession(user.id);
  if (lowerText === "menu") {
    if (user.verificationStatus === "VERIFIED") {
      await setSession(user.id, SessionState.IDLE, {});
      await sendMainMenu(to, user.id, lang, user.fullName?.split(" ")[0]);
    } else if (user.verificationStatus === "PENDING_REVIEW") {
      await sendTextMessage(to, tr(lang, "طلب تسجيلك قيد المراجعة. من فضلك استنى الموافقة.", "Your registration is under review. Please wait for approval."));
    }
    return;
  }

  // ---------- Registration conversation ----------
  if (user.verificationStatus === "UNVERIFIED") {
    if (replyId === ACTIONS.CREATE_ACCOUNT || replyId === ACTIONS.START) {
      await setSession(user.id, SessionState.REG_NAME, {});
      await sendTextMessage(to, fullNameHint(lang));
      return;
    }
    switch (session.state) {
      case SessionState.REG_NAME: {
        const r = await handleNameInput(user.id, text, lang);
        if (r.ok) {
          await sendButtonMessage(to, r.text, [
            { id: ACTIONS.YES, title: tr(lang, "\u2705 آه", "\u2705 Yes") },
            { id: ACTIONS.NO, title: tr(lang, "\u274C لأ", "\u274C No") },
          ]);
        } else {
          await sendTextMessage(to, r.text);
        }
        return;
      }
      case SessionState.REG_CONFIRM_NUMBER: {
        if (replyId === ACTIONS.YES) {
          await sendTextMessage(to, await confirmNumberYes(user.id, lang));
        } else if (replyId === ACTIONS.NO) {
          await sendTextMessage(to, numberNoText(lang));
        } else {
          await sendButtonMessage(to, tr(lang, "ده رقم الواتساب بتاعك؟", "Is this your WhatsApp number?"), [
            { id: ACTIONS.YES, title: tr(lang, "\u2705 آه", "\u2705 Yes") },
            { id: ACTIONS.NO, title: tr(lang, "\u274C لأ", "\u274C No") },
          ]);
        }
        return;
      }
      case SessionState.REG_ID_FRONT: {
        if (msg.type === "image") {
          // Metadata only - the photo itself stays in WhatsApp (media policy).
          await sendTextMessage(to, await handleIdFront(user.id, lang));
        } else {
          await sendTextMessage(to, tr(lang, "\u{1F4CE} من فضلك ابعت صورة واضحة لوش البطاقة الشخصية.", "\u{1F4CE} Please send a clear photo of the front of your ID card."));
        }
        return;
      }
      case SessionState.REG_ID_BACK: {
        if (msg.type === "image") {
          await sendTextMessage(to, await handleIdBack(user.id, lang));
        } else {
          await sendTextMessage(to, tr(lang, "دلوقتي ابعت صورة واضحة لضهر البطاقة الشخصية.", "Now send a clear photo of the back of your ID card."));
        }
        return;
      }
      case SessionState.REG_FACE_VIDEO: {
        if (msg.type === "video") {
          await sendTextMessage(to, await handleFaceVideo(user.id, lang));
        } else {
          await sendTextMessage(to, tr(lang, "\u{1F3A5} من فضلك ابعت فيديو قصير لوشك، حوالي 5-10 ثواني، وبإضاءة كويسة.", "\u{1F3A5} Please send a short video of your face, around 5\u201310 seconds, with good lighting."));
        }
        return;
      }
      default: {
        await sendButtonMessage(
          to,
          tr(lang, "حساب الواتساب بتاعك مش مسجّل في WTS Pay.\nعايز تعمل حساب جديد؟", "Your WhatsApp account is not registered with WTS Pay.\nWould you like to create a new account?"),
          [{ id: ACTIONS.CREATE_ACCOUNT, title: tr(lang, "\u{1F680} اعمل حساب", "\u{1F680} Create Account") }]
        );
        return;
      }
    }
  }

  // ---------- Pending review ----------
  if (user.verificationStatus === "PENDING_REVIEW") {
    if (session.state === SessionState.REG_FACE_VIDEO && msg.type === "video") {
      await sendTextMessage(to, await handleFaceVideo(user.id, lang));
      return;
    }
    await sendTextMessage(to, tr(lang, "طلب تسجيلك اتبعت للمراجعة. \u2705 من فضلك استنى الموافقة.", "Your registration has been submitted for review. \u2705 Please wait for approval."));
    return;
  }

  // ---------- Verified users ----------
  // Force PIN creation before anything else if missing.
  if (!user.pinHash) {
    if (replyId === ACTIONS.CREATE_PIN) {
      const sent = await sendPinFlow(to, user.id);
      if (!sent) {
        await setSession(user.id, SessionState.PIN_CREATE, {});
        await sendTextMessage(
          to,
          tr(
            lang,
            "اعمل الرقم السري الخاص بتحويلات WTS.\n\n" +
              "\u26A0\uFE0F ملحوظة: مفيش Flow واتساب رسمي متظبط دلوقتي لإدخال الرقم السري بأمان، " +
              "فكبديل رسمي، اكتب رقم سري جديد من 6 أرقام دلوقتي. " +
              "هيتشفّر فورًا ومش هيتعرض تاني. " +
              "لتفعيل شاشة الرقم السري الرسمية، ظبط WHATSAPP_PIN_FLOW_ID (شوف الـ README).",
            "Create your WTS transaction PIN.\n\n" +
              "\u26A0\uFE0F Documented limitation: no WhatsApp Flow is configured for secure in-chat PIN entry, " +
              "so as the officially supported fallback, please type a new 6-digit PIN now. " +
              "It will be hashed immediately and never displayed again. " +
              "For the native PIN screen, configure WHATSAPP_PIN_FLOW_ID (see README)."
          )
        );
      }
      return;
    }
    if (session.state === SessionState.PIN_CREATE) {
      const r = await handlePinCreateInput(user.id, text, lang);
      await sendTextMessage(to, r.text);
      return;
    }
    if (session.state === SessionState.PIN_CONFIRM) {
      const r = await handlePinConfirmInput(user.id, text, lang);
      await sendTextMessage(to, r.text);
      return;
    }
    await sendButtonMessage(
      to,
      tr(lang, "\u{1F389} حساب WTS Pay بتاعك اتقبل. اعمل الرقم السري من 6 أرقام عشان تفعّل التحويلات.", "\u{1F389} Your WTS Pay account is approved. Create your 6-digit WTS transaction PIN to activate transfers."),
      [{ id: ACTIONS.CREATE_PIN, title: tr(lang, "\u{1F512} اعمل رقم سري", "\u{1F512} Create PIN") }]
    );
    return;
  }

  // Send Money is its own standalone Flow now — PIN confirmation happens
  // afterwards as a separate, standalone Flow (never a screen inside this one).
  if (replyId === ACTIONS.SEND_MONEY) {
    const sent = await sendSendMoneyFlow(to, user.id);
    if (sent) return;
  }

  // Money requests: menu list, viewing one, accepting/rejecting, starting a new one.
  if (replyId === ACTIONS.REQUESTS) {
    await sendRequestsMenu(to, user.id, lang);
    return;
  }
  if (replyId === ACTIONS.NEW_REQUEST) {
    await sendTextMessage(to, await beginMoneyRequest(user.id, lang));
    return;
  }
  if (replyId?.startsWith("req_view_")) {
    const requestId = replyId.slice("req_view_".length);
    const view = await viewIncomingRequest(user.id, requestId, lang);
    if (view.buttons.length > 0) {
      await sendButtonMessage(to, view.text, view.buttons);
    } else {
      await sendTextMessage(to, view.text);
    }
    return;
  }
  if (replyId?.startsWith("req_accept_")) {
    const requestId = replyId.slice("req_accept_".length);
    const sent = await sendConfirmPinFlow(to, user.id, "request", requestId);
    if (!sent) {
      await sendTextMessage(to, await beginAcceptRequest(user.id, requestId, lang));
    }
    return;
  }
  if (replyId?.startsWith("req_reject_")) {
    const requestId = replyId.slice("req_reject_".length);
    await sendTextMessage(to, await rejectIncomingRequest(user.id, requestId, lang));
    return;
  }

  // Menu shortcuts
  if (replyId) {
    const menuText = await routeMenuAction(user.id, replyId, lang);
    if (menuText) { await sendTextMessage(to, menuText); return; }
  }

  // Send-money conversation with PIN authorization
  switch (session.state) {
    case SessionState.SEND_WAIT_PHONE: {
      const r = await handlePhoneInput(user.id, text, lang);
      await sendTextMessage(to, r.text);
      return;
    }
    case SessionState.SEND_WAIT_AMOUNT: {
      const r = await handleAmountInput(user.id, text, lang);
      if ("askEscrow" in r) {
        await sendButtonMessage(to, r.text, [
          { id: ACTIONS.ESCROW_YES, title: tr(lang, "\u{1F6E1}\uFE0F آه، احمي", "\u{1F6E1}\uFE0F Yes, protect") },
          { id: ACTIONS.ESCROW_NO, title: tr(lang, "لأ، تخطّى", "No, skip") },
        ]);
      } else {
        await sendTextMessage(to, r.text);
      }
      return;
    }
    case SessionState.SEND_ESCROW_CHOICE: {
      if (replyId === ACTIONS.ESCROW_YES || replyId === ACTIONS.ESCROW_NO) {
        const r = await handleEscrowChoice(user.id, replyId === ACTIONS.ESCROW_YES, lang);
        await sendButtonMessage(to, r.summary, [
          { id: ACTIONS.CONFIRM_TRANSFER, title: tr(lang, "\u{1F510} تأكيد التحويل", "\u{1F510} Confirm Transfer") },
          { id: ACTIONS.CANCEL, title: tr(lang, "\u274C إلغاء", "\u274C Cancel") },
        ]);
      } else {
        await sendTextMessage(to, tr(lang, "دوس آه أو لأ عشان تكمّل.", "Tap Yes or No to continue."));
      }
      return;
    }
    case SessionState.SEND_CONFIRMATION: {
      if (replyId === ACTIONS.CONFIRM_TRANSFER) {
        const r = await confirmTransfer(user.id, lang);
        await sendTextMessage(to, r.text);
      } else if (replyId === ACTIONS.CANCEL) {
        await sendTextMessage(to, await cancelTransfer(user.id, lang));
      } else {
        await sendTextMessage(to, tr(lang, "دوس \"تأكيد التحويل\" عشان تكمّل، أو \"إلغاء\".", "Tap Confirm Transfer to continue, or Cancel."));
      }
      return;
    }
    case SessionState.SEND_PIN: {
      if (replyId === ACTIONS.CANCEL) {
        await sendTextMessage(to, await cancelTransfer(user.id, lang));
        return;
      }
      const r = await handleAuthorizationPin(user.id, text, lang);
      await sendTextMessage(to, r);
      return;
    }
    case SessionState.REQ_WAIT_PHONE: {
      const r = await handleRequestPhoneInput(user.id, text, lang);
      await sendTextMessage(to, r.text);
      return;
    }
    case SessionState.REQ_WAIT_AMOUNT: {
      const r = await handleRequestAmountInput(user.id, text, lang);
      await sendTextMessage(to, r);
      return;
    }
    case SessionState.REQ_PIN: {
      const r = await handleRequestPinInput(user.id, text, lang);
      await sendTextMessage(to, r);
      return;
    }
    default: {
      await sendMainMenu(to, user.id, lang, user.fullName?.split(" ")[0]);
    }
  }
}

export async function handleStatusUpdate(status: { recipientId: string; status: string }) {
  logger.info("WhatsApp status update", status);
}
