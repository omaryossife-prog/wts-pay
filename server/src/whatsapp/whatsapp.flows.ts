// ---------------------------------------------------------------------------
// WhatsApp Flows support - official native in-chat UI only (no browser).
// Every operation is its OWN standalone Flow. PIN confirmation is never a
// screen inside another Flow — it is always the separate "Confirm PIN" Flow,
// triggered as a follow-up message once the operation's own Flow finishes
// collecting data. This mirrors the same separation used for account
// recovery (its own Reference-Code Flow) and PIN creation (its own Flow).
//
// LANGUAGE NOTE: the dynamic `data` this file sends to each Flow screen
// (messages, labels, option lists) is bilingual via tr(lang, ar, en) below,
// with `lang` resolved from the user's stored language. The Flow's fixed
// screen titles / static captions live in the registered Flow JSON
// (server/flows/*.json) itself and are NOT changed by this file — that is a
// separate follow-up (either a second Flow asset per language registered in
// Meta Business Manager, or converting every remaining static label to a
// data-bound field and re-testing live in Meta's Flow Builder).
// ---------------------------------------------------------------------------
import crypto from "crypto";
import { prisma } from "../utils/prisma.js";
import { logger } from "../utils/logger.js";
import { completePinFromFlow, SessionState, setSession } from "./whatsapp.service.js";
import { validatePinFormat } from "../services/pin.service.js";
import {
  recordGender, recordGovernorate, recordNationalId, validateNationalId, RegDetailsError,
} from "../services/registration.service.js";
import { governorateByCode } from "../services/governorates.js";
import { executeWtsAction, notifyWtsActionResult, WTS_FLOW_ACTIONS, type WtsActionResponse } from "./whatsapp.actions.js";
import { type Lang, tr, normalizeLang } from "../i18n/lang.js";

async function langFor(userId: string): Promise<Lang> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { language: true } });
  return normalizeLang(u?.language);
}

function loadFlowKeys(): crypto.KeyObject | null {
  const pem = process.env.WHATSAPP_FLOW_PRIVATE_KEY;
  if (!pem) return null;
  try {
    return crypto.createPrivateKey(pem.replace(/\\n/g, "\n"));
  } catch (err) {
    logger.error("Invalid WHATSAPP_FLOW_PRIVATE_KEY", err);
    return null;
  }
}

function decryptAesKey(privateKey: crypto.KeyObject, encryptedAesKeyB64: string): Buffer {
  return crypto.privateDecrypt(
    { key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    Buffer.from(encryptedAesKeyB64, "base64")
  );
}

function aesGcmDecrypt(aesKey: Buffer, iv: Buffer, ciphertextB64: string, authTagB64: string): string {
  const decipher = crypto.createDecipheriv("aes-256-gcm", aesKey, iv);
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function aesGcmEncrypt(aesKey: Buffer, iv: Buffer, plaintext: string): { ciphertext: string; authTag: string } {
  const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { ciphertext: ct.toString("base64"), authTag: cipher.getAuthTag().toString("base64") };
}

function decryptFlowBody(body: any): { flowData: any; aesKey: Buffer; iv: Buffer } | null {
  const privateKey = loadFlowKeys();
  if (!privateKey) return null;
  const { encrypted_flow_data, encrypted_aes_key, initial_vector } = body ?? {};
  try {
    const aesKey = decryptAesKey(privateKey, encrypted_aes_key);
    const iv = Buffer.from(initial_vector, "base64");
    const blob = Buffer.from(encrypted_flow_data, "base64");
    const dataIv = blob.subarray(0, 12);
    const tag = blob.subarray(12, 28);
    const ct = blob.subarray(28);
    return { flowData: JSON.parse(aesGcmDecrypt(aesKey, dataIv, ct.toString("base64"), tag.toString("base64"))), aesKey, iv };
  } catch (err) {
    logger.error("Flow payload decryption failed", err);
    return null;
  }
}

function encryptFlowResponse(aesKey: Buffer, iv: Buffer, version: string, screen: string, data: unknown) {
  const { ciphertext, authTag } = aesGcmEncrypt(aesKey, iv, JSON.stringify({ version, screen, data }));
  const combined = Buffer.concat([iv, Buffer.from(authTag, "base64"), Buffer.from(ciphertext, "base64")]);
  return { encrypted_response: combined.toString("base64"), aes_key_buffer: "unused" };
}

function resultScreenData(r: WtsActionResponse, lang: Lang) {
  return {
    title: r.success ? tr(lang, "\u2705 تمت العملية بنجاح", "\u2705 Operation successful") : tr(lang, "\u274C لم يتم تنفيذ العملية", "\u274C The operation was not completed"),
    message: r.message,
    transaction_id: r.transactionId ?? "",
    amount_label: r.amount !== undefined ? tr(lang, `${r.amount} جنيه`, `${r.amount} EGP`) : "",
    fee_label: r.fee !== undefined ? tr(lang, `${r.fee} جنيه`, `${r.fee} EGP`) : "",
    total_label: r.total !== undefined ? tr(lang, `${r.total} جنيه`, `${r.total} EGP`) : "",
    balance_label: r.balanceAfter !== undefined ? tr(lang, `${r.balanceAfter} جنيه`, `${r.balanceAfter} EGP`) : "",
  };
}

// ── PIN creation Flow (onboarding) — untouched, unrelated to transaction PIN ──
export async function sendPinFlow(to: string, userId: string): Promise<boolean> {
  const flowId = process.env.WHATSAPP_PIN_FLOW_ID;
  if (!flowId) return false;
  const lang = await langFor(userId);
  const { sendInteractiveMessage } = await import("./whatsapp.client.js");
  const { flowMessagePayload } = await import("./whatsapp.templates.js");
  const r = await sendInteractiveMessage(
    flowMessagePayload(
      to,
      flowId,
      userId,
      tr(lang, "اعمل الرقم السري الخاص بتحويلات WTS. بيفضل سري وميتعرضش تاني.", "Create your WTS transaction PIN. It stays private and is never shown again."),
      tr(lang, "\u{1F512} اعمل رقم سري", "\u{1F512} Create PIN")
    )
  );
  return r.ok;
}

// POST /api/whatsapp/flows/pin
export async function handleFlowDataExchange(body: any): Promise<any> {
  if (body?.action === "ping") return { status: "active", data: {} };
  const parsed = decryptFlowBody(body);
  if (!parsed) return { status: "failed", data: { message: "Flow endpoint not configured" } };
  const { flowData, aesKey, iv } = parsed;
  if (flowData?.action === "ping") return { status: "active", data: {} };
  const version = flowData?.version ?? "7.2";
  const screen = flowData?.screen;
  const flowToken = flowData?.flow_token;
  const pin = flowData?.data?.pin ?? flowData?.data?.pin_code;
  const pinConfirm = flowData?.data?.pin_confirm ?? flowData?.data?.confirm_pin;
  const lang = await langFor(String(flowToken ?? ""));

  if (screen !== "PIN" || !pin || !pinConfirm) {
    return encryptFlowResponse(aesKey, iv, version, "PIN", { message: tr(lang, "من فضلك اكتب الرقم السري وأكّده.", "Please enter and confirm your PIN.") });
  }
  if (pin !== pinConfirm) {
    return encryptFlowResponse(aesKey, iv, version, "PIN", { message: tr(lang, "الرقمين مش متطابقين. جرّب تاني.", "PINs do not match. Try again.") });
  }
  try {
    validatePinFormat(String(pin), lang);
    await completePinFromFlow(String(flowToken), String(pin));
    logger.info("PIN created via WhatsApp Flow", { userId: flowToken });
    return encryptFlowResponse(aesKey, iv, version, "SUCCESS", { message: tr(lang, "تم عمل الرقم السري. محفظتك بقت شغالة بالكامل.", "PIN created. Your wallet is fully active.") });
  } catch (err: any) {
    return encryptFlowResponse(aesKey, iv, version, "PIN", { message: err.message ?? tr(lang, "رقم سري غير صالح", "Invalid PIN") });
  }
}

// ── Registration-details Flow (gender / governorate / national ID) ──
// Sent right after the registration SMS-OTP step succeeds. ID photos are
// NOT part of this Flow (still requested as normal chat images right after
// it closes) — see server/flows/wts-registration-details.flow.json and the
// README section on bilingual/registration for why.
export async function sendRegDetailsFlow(to: string, userId: string): Promise<boolean> {
  const flowId = process.env.WHATSAPP_REG_DETAILS_FLOW_ID;
  if (!flowId) return false;
  const lang = await langFor(userId);
  const { sendInteractiveMessage } = await import("./whatsapp.client.js");
  const { flowMessagePayload } = await import("./whatsapp.templates.js");
  const r = await sendInteractiveMessage(
    flowMessagePayload(
      to,
      flowId,
      userId,
      tr(lang, "كمّل بيانات التسجيل: الجنس، المحافظة، والرقم القومي.", "Complete your registration details: gender, governorate, and national ID."),
      tr(lang, "\u{1F4DD} كمّل البيانات", "\u{1F4DD} Continue")
    )
  );
  return r.ok;
}

// POST /api/whatsapp/flows/registration-details
export async function handleRegDetailsFlowDataExchange(body: any): Promise<any> {
  if (body?.action === "ping") return { status: "active", data: {} };
  const parsed = decryptFlowBody(body);
  if (!parsed) return { status: "failed", data: { message: "Flow endpoint not configured" } };
  const { flowData, aesKey, iv } = parsed;
  if (flowData?.action === "ping") return { status: "active", data: {} };

  const version = flowData?.version ?? "7.2";
  const screen = String(flowData?.screen ?? "DETAILS");
  const data = flowData?.data ?? {};
  const userId = String(flowData?.flow_token ?? "");
  const send = (screenName: string, screenData: Record<string, unknown>) => encryptFlowResponse(aesKey, iv, version, screenName, screenData);
  const lang = userId ? await langFor(userId) : "ar";

  if (!userId) return send("DETAILS", { error: tr(lang, "تعذر التحقق من هوية المستخدم.", "Could not verify your identity.") });

  if (screen === "DETAILS" && (flowData?.action === "INIT" || data.op === "submit_details")) {
    if (flowData?.action === "INIT") {
      return send("DETAILS", { error: "" });
    }
    const gender = String(data.gender ?? "");
    const governorateCode = String(data.governorate ?? "");
    const rawNationalId = String(data.national_id ?? "");

    if (gender !== "male" && gender !== "female") {
      return send("DETAILS", { error: tr(lang, "اختار النوع.", "Please choose a gender.") });
    }
    if (!governorateByCode(governorateCode)) {
      return send("DETAILS", { error: tr(lang, "اختار المحافظة.", "Please choose a governorate.") });
    }
    const idCheck = validateNationalId(rawNationalId, lang);
    if (!idCheck.ok) {
      return send("DETAILS", { error: idCheck.error });
    }

    try {
      await recordGender(prisma, userId, gender as "male" | "female");
      await recordGovernorate(prisma, userId, governorateCode);
      await recordNationalId(prisma, userId, idCheck.digits, lang);
    } catch (err: any) {
      const msg = err instanceof RegDetailsError ? err.message : tr(lang, "حصل خطأ، جرّب تاني.", "Something went wrong, please try again.");
      return send("DETAILS", { error: msg });
    }

    // التالي في المحادثة العادية: صورة وش البطاقة (مش جوه الفورم ده).
    await setSession(userId, SessionState.REG_ID_FRONT, {});
    return send("DONE", {
      message: tr(
        lang,
        "تم حفظ بياناتك. ارجع للمحادثة وابعت صورة واضحة لوش البطاقة الشخصية.",
        "Your details were saved. Go back to the chat and send a clear photo of the front of your ID card."
      ),
    });
  }

  return send("DETAILS", { error: tr(lang, "مسار غير معروف.", "Unknown step.") });
}

// ── Send Money Flow — data collection ONLY. Ends by triggering the
// standalone Confirm-PIN Flow as a follow-up message, never as its own screen. ──
export async function sendSendMoneyFlow(to: string, userId: string): Promise<boolean> {
  const flowId = process.env.WHATSAPP_SEND_FLOW_ID;
  if (!flowId) return false;
  const lang = await langFor(userId);
  const { sendInteractiveMessage } = await import("./whatsapp.client.js");
  const { flowMessagePayload } = await import("./whatsapp.templates.js");
  const r = await sendInteractiveMessage(
    flowMessagePayload(
      to,
      flowId,
      userId,
      tr(lang, "حوّل فلوس لمستخدم WTS تاني، من جوّه الواتساب.", "Send money to another WTS user, inside WhatsApp."),
      tr(lang, "\u{1F4B8} تحويل فلوس", "\u{1F4B8} Send Money")
    )
  );
  return r.ok;
}

// POST /api/whatsapp/flows/send-money
export async function handleSendMoneyFlowDataExchange(body: any): Promise<any> {
  if (body?.action === "ping") return { status: "active", data: {} };
  const parsed = decryptFlowBody(body);
  if (!parsed) return { status: "failed", data: { message: "Flow endpoint not configured" } };
  const { flowData, aesKey, iv } = parsed;
  if (flowData?.action === "ping") return { status: "active", data: {} };

  const version = flowData?.version ?? "7.2";
  const screen = String(flowData?.screen ?? "INIT");
  const data = flowData?.data ?? {};
  const userId = String(flowData?.flow_token ?? "");
  const send = (screenName: string, screenData: Record<string, unknown>) => encryptFlowResponse(aesKey, iv, version, screenName, screenData);
  const lang = await langFor(userId);

  if (!userId) return send("DONE", { message: tr(lang, "تعذر التحقق من هوية المستخدم", "Could not verify your identity") });

  if (screen === "INIT" || flowData?.action === "INIT") {
    return send("RECIPIENT", { message: tr(lang, "أدخل رقم هاتف المستلم مع كود الدولة", "Enter the recipient's phone number with country code") });
  }

  if (screen === "RECIPIENT") {
    const result = await executeWtsAction(userId, WTS_FLOW_ACTIONS.SEND_MONEY, { recipientPhone: data.recipient_phone });
    if (!result.success) {
      return send("RECIPIENT", { message: result.message });
    }
    return send("AMOUNT_ESCROW", {
      recipient_phone: result.recipientPhone,
      recipient_label: `${result.recipientName ?? ""} ${result.recipientWtsId ? `(${result.recipientWtsId})` : ""}`.trim(),
      message: tr(lang, `إرسال إلى ${result.recipientName ?? result.recipientPhone}`, `Sending to ${result.recipientName ?? result.recipientPhone}`),
      escrow_options: [
        { id: "yes", title: tr(lang, "\u{1F6E1}\uFE0F نعم، فعّل الحماية", "\u{1F6E1}\uFE0F Yes, protect"), description: tr(lang, "يمكنك الإبلاغ لاحقًا لو حصل نصب", "You can report later if something feels wrong") },
        { id: "no", title: tr(lang, "لا، تحويل عادي", "No, skip"), description: "" },
      ],
    });
  }

  if (screen === "AMOUNT_ESCROW") {
    const escrowEnabled = String(data.escrow ?? "no") === "yes";
    const result = await executeWtsAction(userId, WTS_FLOW_ACTIONS.CREATE_TRANSFER, {
      recipientPhone: data.recipient_phone,
      amount: data.amount,
      escrowEnabled,
    });
    if (!result.success) {
      return send("DONE", { message: tr(lang, `تعذر إعداد التحويل: ${result.message}`, `Could not prepare the transfer: ${result.message}`) });
    }
    return send("REVIEW", {
      authorization_id: result.authorizationId,
      recipient_label: String(data.recipient_label ?? result.recipientWtsId ?? result.recipientPhone ?? ""),
      amount_label: tr(lang, `${result.amount} جنيه`, `${result.amount} EGP`),
      fee_label: tr(lang, `${result.fee} جنيه`, `${result.fee} EGP`),
      total_label: tr(lang, `${result.total} جنيه`, `${result.total} EGP`),
      escrow_label: escrowEnabled ? tr(lang, "\u{1F6E1}\uFE0F الحماية من النصب: مفعّلة", "\u{1F6E1}\uFE0F Anti-fraud protection: ON") : "",
    });
  }

  if (screen === "REVIEW") {
    // Side effect only: fire the standalone Confirm-PIN Flow as a new
    // message. This Flow itself just closes — it never asks for the PIN.
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { whatsappPhone: true, phone: true } });
    const waTo = (user?.whatsappPhone ?? user?.phone ?? "").replace("+", "");
    if (waTo) {
      await sendConfirmPinFlow(waTo, userId, "transfer", String(data.authorization_id ?? "")).catch(() => {});
    }
    return send("DONE", { message: tr(lang, "تابع في الرسالة الجاية لإدخال الرمز السري وتأكيد التحويل.", "Continue in the next message to enter your PIN and confirm the transfer.") });
  }

  return send("DONE", { message: tr(lang, "مسار غير معروف", "Unknown step") });
}

// ── Confirm-PIN Flow — fully standalone. Used to authorize EITHER a
// pending transfer authorization OR accepting a money request. The
// flow_token carries "${userId}::${kind}::${refId}". ──
export async function sendConfirmPinFlow(
  to: string,
  userId: string,
  kind: "transfer" | "request",
  refId: string
): Promise<boolean> {
  const flowId = process.env.WHATSAPP_CONFIRM_PIN_FLOW_ID;
  if (!flowId) return false;
  const lang = await langFor(userId);
  const { sendInteractiveMessage } = await import("./whatsapp.client.js");
  const { flowMessagePayload } = await import("./whatsapp.templates.js");
  const flowToken = `${userId}::${kind}::${refId}`;
  const r = await sendInteractiveMessage(
    flowMessagePayload(
      to,
      flowId,
      flowToken,
      tr(lang, "\u{1F512} اكتب الرقم السري من 6 أرقام عشان تأكّد.", "\u{1F512} Enter your 6-digit WTS PIN to confirm."),
      tr(lang, "تأكيد", "Confirm")
    )
  );
  return r.ok;
}

// POST /api/whatsapp/flows/confirm-pin
export async function handleConfirmPinFlowDataExchange(body: any): Promise<any> {
  if (body?.action === "ping") return { status: "active", data: {} };
  const parsed = decryptFlowBody(body);
  if (!parsed) return { status: "failed", data: { message: "Flow endpoint not configured" } };
  const { flowData, aesKey, iv } = parsed;
  if (flowData?.action === "ping") return { status: "active", data: {} };

  const version = flowData?.version ?? "7.2";
  const screen = String(flowData?.screen ?? "INIT");
  const data = flowData?.data ?? {};
  const send = (screenName: string, screenData: Record<string, unknown>) => encryptFlowResponse(aesKey, iv, version, screenName, screenData);

  const token = String(flowData?.flow_token ?? "");
  const [userId, kind, refId] = token.split("::");
  const lang = userId ? await langFor(userId) : "ar";
  if (!userId || !kind || !refId) {
    return send("RESULT", resultScreenData({ success: false, status: "ERROR", message: tr(lang, "تعذر التحقق من العملية", "Could not verify this operation") }, lang));
  }

  if (screen === "INIT" || flowData?.action === "INIT") {
    let summary = "";
    if (kind === "transfer") {
      const auth = await prisma.transactionAuthorization.findUnique({ where: { authorizationId: refId } });
      if (auth) summary = tr(lang, `المستلم: ${auth.recipientWtsId ?? auth.recipientPhone}\nالإجمالي: ${auth.total} جنيه`, `Recipient: ${auth.recipientWtsId ?? auth.recipientPhone}\nTotal: ${auth.total} EGP`);
    } else if (kind === "request") {
      const reqRow = await prisma.transferRequest.findUnique({ where: { id: refId } });
      if (reqRow) summary = tr(lang, `المبلغ المطلوب: ${reqRow.amount} جنيه`, `Requested amount: ${reqRow.amount} EGP`);
    }
    return send("PIN", { message: tr(lang, "أدخل رمز WTS السري المكوّن من 6 أرقام", "Enter your 6-digit WTS PIN"), summary_label: summary });
  }

  if (screen === "PIN") {
    const pin = String(data.pin ?? "").trim();
    const action = kind === "transfer" ? WTS_FLOW_ACTIONS.CONFIRM_TRANSFER : WTS_FLOW_ACTIONS.ACCEPT_REQUEST;
    const payload = kind === "transfer" ? { authorizationId: refId, pin } : { requestId: refId, pin };
    const result = await executeWtsAction(userId, action, payload);
    await notifyWtsActionResult(userId, action, result).catch(() => {});
    return send("RESULT", resultScreenData(result, lang));
  }

  return send("RESULT", resultScreenData({ success: false, status: "ERROR", message: tr(lang, "مسار غير معروف", "Unknown step") }, lang));
}

// ===========================================================================
// Wallet Flow — دايناميك واحد شامل. كل شيء جوّاه: التحويلات، الطلبات، الرصيد،
// كشف الحساب، بيانات الحساب، تغيير الـ PIN، والمساعدة. القوائم كلها والتنقل
// بينها بيتم جوّه نفس جلسة الفلو (data_exchange) من غير أي رسالة واتساب
// إضافية — الرسالة الوحيدة هي فتح الفلو، وبعدها رسالة إشعار المستلم بس.
// flow_token = معرّف المستخدم طول الفلو (مفيش تركيب معقّد).
// ===========================================================================
import { setPin, PinError } from "../services/pin.service.js";
import {
  createTransferRequest, listIncomingRequests, acceptTransferRequest, TransferRequestError,
} from "../services/transferRequest.service.js";
import { normalizeWaPhone } from "../services/registration.service.js";
import { notifyTransferReceived, notifyMoneyRequest } from "./whatsapp.service.js";

export async function sendWalletFlow(to: string, userId: string): Promise<boolean> {
  const flowId = process.env.WHATSAPP_WALLET_FLOW_ID;
  if (!flowId) return false;
  const lang = await langFor(userId);
  const { sendInteractiveMessage } = await import("./whatsapp.client.js");
  const { flowMessagePayload } = await import("./whatsapp.templates.js");
  const r = await sendInteractiveMessage(
    flowMessagePayload(to, flowId, userId, tr(lang, "افتح محفظة WTS.", "Open your WTS wallet."), tr(lang, "\u{1F4BC} المحفظة", "\u{1F4BC} Wallet"))
  );
  return r.ok;
}

function money(n: number | null | undefined, lang: Lang): string {
  return tr(lang, `${(n ?? 0).toLocaleString("en-US")} جنيه`, `${(n ?? 0).toLocaleString("en-US")} EGP`);
}

// POST /api/whatsapp/flows/wallet
export async function handleWalletFlowDataExchange(body: any): Promise<any> {
  if (body?.action === "ping") return { status: "active", data: {} };
  const parsed = decryptFlowBody(body);
  if (!parsed) return { status: "failed", data: { message: "Flow endpoint not configured" } };
  const { flowData, aesKey, iv } = parsed;
  if (flowData?.action === "ping") return { status: "active", data: {} };

  const version = flowData?.version ?? "7.2";
  const screen = String(flowData?.screen ?? "INIT");
  const data = flowData?.data ?? {};
  const userId = String(flowData?.flow_token ?? "");
  const send = (screenName: string, screenData: Record<string, unknown>) => encryptFlowResponse(aesKey, iv, version, screenName, screenData);
  const lang = userId ? await langFor(userId) : "ar";

  if (!userId) return send("RESULT", { title: tr(lang, "\u274C خطأ", "\u274C Error"), message: tr(lang, "تعذر التحقق من هوية المستخدم.", "Could not verify your identity.") });

  try {
    // ---- المدخل الأول: نجيب الرصيد ونفتح الشاشة الرئيسية ----
    if (screen === "INIT" || flowData?.action === "INIT") {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { demoBalance: true } });
      return send("HOME", { balance_label: money(user?.demoBalance, lang) });
    }

    const op = String(data.op ?? "");

    // ---- رجوع عام لأي شاشة قائمة (البيانات المطلوبة بتتجدد من السيرفر) ----
    if (op === "go_back") {
      const target = String(data.target ?? "HOME");
      if (target === "TRANSFERS_MENU") return send("TRANSFERS_MENU", {});
      if (target === "ACCOUNT_MENU") return send("ACCOUNT_MENU", {});
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { demoBalance: true } });
      return send("HOME", { balance_label: money(user?.demoBalance, lang) });
    }

    // ---- الشاشة الرئيسية ----
    if (screen === "HOME" && op === "home_open") {
      const choice = String(data.choice ?? "");
      if (choice === "transfers") return send("TRANSFERS_MENU", {});
      if (choice === "account") return send("ACCOUNT_MENU", {});
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { demoBalance: true } });
      return send("HOME", { balance_label: money(user?.demoBalance, lang) });
    }

    // ---- قائمة التحويلات ----
    if (screen === "TRANSFERS_MENU" && op === "transfers_open") {
      const choice = String(data.choice ?? "");
      if (choice === "back") {
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { demoBalance: true } });
        return send("HOME", { balance_label: money(user?.demoBalance, lang) });
      }
      if (choice === "send") return send("SEND_RECIPIENT", { error: "" });
      if (choice === "request") return send("REQUESTS_HOME", await buildRequestsHomeData(userId, lang));
      if (choice === "balance") {
        const u = await prisma.user.findUnique({ where: { id: userId }, select: { wtsId: true, demoBalance: true } });
        return send("BALANCE", { wts_id: u?.wtsId ?? "-", balance_label: money(u?.demoBalance, lang) });
      }
      if (choice === "statement") {
        const lines = await buildStatementLines(userId, lang);
        return send("STATEMENT", { lines });
      }
      return send("TRANSFERS_MENU", {});
    }

    // ---- قائمة الحساب ----
    if (screen === "ACCOUNT_MENU" && op === "account_open") {
      const choice = String(data.choice ?? "");
      if (choice === "back") {
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { demoBalance: true } });
        return send("HOME", { balance_label: money(user?.demoBalance, lang) });
      }
      if (choice === "info") return send("ACCOUNT_INFO", { info: await buildAccountInfo(userId, lang) });
      if (choice === "referrals") return send("REFERRALS", { info: await buildReferralsInfo(userId, lang) });
      if (choice === "pin") return send("CHANGE_PIN", { message: tr(lang, "أدخل الرمز الجديد (6 أرقام)", "Enter the new PIN (6 digits)") });
      if (choice === "help") return send("HELP", {});
      return send("ACCOUNT_MENU", {});
    }

    // ---- تغيير الـ PIN ----
    if (screen === "CHANGE_PIN" && op === "change_pin") {
      const pin = String(data.pin ?? "").trim();
      try {
        validatePinFormat(pin, lang);
        await setPin(prisma, { userId, pin, lang });
        return send("RESULT", { title: tr(lang, "\u2705 تم", "\u2705 Done"), message: tr(lang, "اتغيّر الرمز السري بنجاح.", "Your PIN was changed successfully.") });
      } catch (err: any) {
        return send("CHANGE_PIN", { message: err.message ?? tr(lang, "رمز غير صالح، جرب تاني.", "Invalid PIN, try again.") });
      }
    }

    // ---- تحويل أموال: الخطوة 1 - المستلم ----
    if (screen === "SEND_RECIPIENT" && op === "send_recipient") {
      const result = await executeWtsAction(userId, WTS_FLOW_ACTIONS.SEND_MONEY, { recipientPhone: data.recipient_phone });
      if (!result.success) return send("SEND_RECIPIENT", { error: result.message });
      return send("SEND_AMOUNT", {
        recipient_phone: result.recipientPhone,
        recipient_label: `${result.recipientName ?? ""} ${result.recipientWtsId ? `(${result.recipientWtsId})` : ""}`.trim(),
        escrow_options: [
          { id: "yes", title: tr(lang, "\u{1F6E1}\uFE0F نعم، فعّل الحماية", "\u{1F6E1}\uFE0F Yes, protect"), description: tr(lang, "تقدر تبلّغ لاحقًا لو حصل نصب", "You can report later if something feels wrong") },
          { id: "no", title: tr(lang, "لا، تحويل عادي", "No, skip"), description: "" },
        ],
      });
    }

    // ---- تحويل أموال: الخطوة 2 - المبلغ والحماية ----
    if (screen === "SEND_AMOUNT" && op === "send_review") {
      const escrowEnabled = String(data.escrow ?? "no") === "yes";
      const result = await executeWtsAction(userId, WTS_FLOW_ACTIONS.CREATE_TRANSFER, {
        recipientPhone: data.recipient_phone,
        amount: data.amount,
        escrowEnabled,
      });
      if (!result.success) {
        return send("SEND_AMOUNT", {
          recipient_phone: data.recipient_phone,
          recipient_label: data.recipient_label,
          escrow_options: [
            { id: "yes", title: tr(lang, "\u{1F6E1}\uFE0F نعم، فعّل الحماية", "\u{1F6E1}\uFE0F Yes, protect"), description: "" },
            { id: "no", title: tr(lang, "لا، تحويل عادي", "No, skip"), description: "" },
          ],
        });
      }
      const summary = tr(
        lang,
        `المستلم: ${data.recipient_label}\n` +
          `المبلغ: ${money(result.amount, lang)}\n` +
          `الرسوم: ${money(result.fee, lang)}\n` +
          `الإجمالي: ${money(result.total, lang)}` +
          (escrowEnabled ? `\n\u{1F6E1}\uFE0F الحماية من النصب: مفعّلة` : ""),
        `Recipient: ${data.recipient_label}\n` +
          `Amount: ${money(result.amount, lang)}\n` +
          `Fee: ${money(result.fee, lang)}\n` +
          `Total: ${money(result.total, lang)}` +
          (escrowEnabled ? `\n\u{1F6E1}\uFE0F Anti-fraud protection: ON` : "")
      );
      return send("SEND_REVIEW", { authorization_id: result.authorizationId, summary });
    }

    // ---- تحويل أموال: الخطوة 3 - الانتقال لإدخال الـ PIN (نفس شاشة PIN العامة) ----
    if (screen === "SEND_REVIEW" && op === "goto_pin") {
      return send("PIN_ENTRY", {
        kind: "transfer",
        ref_id: String(data.ref_id ?? ""),
        summary: tr(lang, "أدخل الرمز السري لتأكيد التحويل.", "Enter your PIN to confirm the transfer."),
      });
    }

    // ---- طلب أموال: الشاشة الرئيسية (طلبات واردة + جديد + رجوع) ----
    if (screen === "REQUESTS_HOME" && op === "requests_action") {
      const choice = String(data.choice ?? "");
      if (choice === "back") return send("TRANSFERS_MENU", {});
      if (choice === "new") return send("REQUEST_RECIPIENT", {});
      // اختار طلب معيّن من القايمة
      const pending = await listIncomingRequests(prisma, userId);
      const reqRow = pending.find((r: any) => r.id === choice);
      if (!reqRow) return send("REQUESTS_HOME", await buildRequestsHomeData(userId, lang));
      return send("REQUEST_VIEW", {
        request_id: reqRow.id,
        summary: tr(
          lang,
          `${reqRow.requester?.username ?? "مستخدم"} طالب منك ${money(reqRow.amount, lang)}.${reqRow.description ? `\nالسبب: ${reqRow.description}` : ""}`,
          `${reqRow.requester?.username ?? "A WTS user"} is requesting ${money(reqRow.amount, lang)} from you.${reqRow.description ? `\nReason: ${reqRow.description}` : ""}`
        ),
      });
    }
    if (op === "requests_home") return send("REQUESTS_HOME", await buildRequestsHomeData(userId, lang));

    // ---- طلب أموال: الانتقال لإدخال PIN لقبول الطلب ----
    if (screen === "REQUEST_VIEW" && op === "goto_pin") {
      return send("PIN_ENTRY", {
        kind: "request",
        ref_id: String(data.ref_id ?? ""),
        summary: tr(lang, "أدخل الرمز السري لتأكيد قبول الطلب وتحويل المبلغ.", "Enter your PIN to accept this request and send the money."),
      });
    }

    // ---- طلب أموال جديد: الخطوة 1 - من مين ----
    if (screen === "REQUEST_RECIPIENT" && op === "request_recipient") {
      const phone = String(data.payer_phone ?? "").replace(/[\s\-()]/g, "");
      const payer = await prisma.user.findUnique({ where: { phone: normalizeWaPhone(phone.replace("+", "")) } });
      if (!payer) return send("REQUEST_RECIPIENT", { error: tr(lang, "لا يوجد مستخدم WTS بهذا الرقم.", "No WTS user found with that phone number.") });
      if (payer.id === userId) return send("REQUEST_RECIPIENT", { error: tr(lang, "لا يمكنك الطلب من نفسك.", "You cannot request money from yourself.") });
      return send("REQUEST_AMOUNT", { payer_phone: payer.phone, payer_label: payer.fullName ?? payer.username });
    }

    // ---- طلب أموال جديد: الخطوة 2 - المبلغ وإرسال الطلب ----
    if (screen === "REQUEST_AMOUNT" && op === "request_send") {
      const amount = Number(String(data.amount ?? "").replace(/[^0-9]/g, ""));
      if (!Number.isInteger(amount) || amount <= 0) {
        return send("REQUEST_AMOUNT", { payer_phone: data.payer_phone, payer_label: data.payer_label });
      }
      try {
        const requester = await prisma.user.findUnique({ where: { id: userId } });
        const { request, payer } = await createTransferRequest(prisma, {
          requesterId: userId,
          payerPhone: String(data.payer_phone),
          amount,
          description: data.description ? String(data.description) : undefined,
        });
        await notifyMoneyRequest(
          payer.whatsappPhone ?? payer.phone,
          requester?.fullName ?? requester?.username ?? tr(lang, "مستخدم WTS", "A WTS user"),
          request.amount,
          request.id,
          await langFor(payer.id)
        ).catch(() => {});
        return send("REQUEST_RESULT", { message: tr(lang, `تم إرسال طلب بمبلغ ${money(amount, lang)} إلى ${data.payer_label}.`, `Request for ${money(amount, lang)} sent to ${data.payer_label}.`) });
      } catch (err: any) {
        return send("REQUEST_RESULT", { message: tr(lang, `تعذر إرسال الطلب: ${err.message ?? "خطأ غير معروف"}`, `Could not send the request: ${err.message ?? "unknown error"}`) });
      }
    }

    // ---- شاشة الـ PIN الموحّدة: تنفيذ فعلي بعد تحقق السيرفر ----
    if (screen === "PIN_ENTRY" && op === "execute") {
      const kind = String(data.kind ?? "");
      const refId = String(data.ref_id ?? "");
      const pin = String(data.pin ?? "").trim();
      if (!/^\d{6}$/.test(pin)) {
        return send("PIN_ENTRY", { kind, ref_id: refId, summary: tr(lang, "أدخل رمز مكوّن من 6 أرقام.", "Enter a 6-digit code.") });
      }
      if (kind === "transfer") {
        // executeWtsAction's CONFIRM_TRANSFER بالفعل بتبعت إشعار المستلم
        // وتقيّم أهلية الإحالة جوّاها — من غير تكرار هنا.
        const result = await executeWtsAction(userId, WTS_FLOW_ACTIONS.CONFIRM_TRANSFER, { authorizationId: refId, pin });
        return send("RESULT", resultScreenData(result, lang));
      }
      if (kind === "request") {
        try {
          const { transaction } = await acceptTransferRequest(prisma, { requestId: refId, payerId: userId, pin });
          await notifyTransferReceived(transaction.id).catch(() => {});
          return send("RESULT", {
            title: tr(lang, "\u2705 تمت العملية بنجاح", "\u2705 Operation successful"),
            message: tr(lang, `تم تحويل ${money(transaction.amount, lang)}.`, `${money(transaction.amount, lang)} sent.`),
          });
        } catch (err: any) {
          if (err instanceof PinError) {
            return send("PIN_ENTRY", { kind, ref_id: refId, summary: err.message });
          }
          const msg = err instanceof TransferRequestError ? err.message : tr(lang, "تعذر تنفيذ العملية.", "Could not complete this operation.");
          return send("RESULT", { title: tr(lang, "\u274C لم يتم تنفيذ العملية", "\u274C The operation was not completed"), message: msg });
        }
      }
      return send("RESULT", { title: tr(lang, "\u274C خطأ", "\u274C Error"), message: tr(lang, "نوع عملية غير معروف.", "Unknown operation type.") });
    }

    // مسار غير متوقع — نرجّع المستخدم لأمان الشاشة الرئيسية بدل ما نعلّق الفلو
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { demoBalance: true } });
    return send("HOME", { balance_label: money(user?.demoBalance, lang) });
  } catch (err) {
    logger.error("Wallet flow data-exchange error", err);
    return send("RESULT", { title: tr(lang, "\u274C خطأ", "\u274C Error"), message: tr(lang, "حصل خطأ غير متوقع، جرب تاني من *menu*.", "Something unexpected happened, try again from *menu*.") });
  }
}

async function buildRequestsHomeData(userId: string, lang: Lang) {
  const pending = await listIncomingRequests(prisma, userId);
  const options = pending.slice(0, 8).map((r: any) => ({
    id: r.id,
    title: tr(lang, `${r.amount.toLocaleString("en-US")} جنيه`, `${r.amount.toLocaleString("en-US")} EGP`),
    description: tr(lang, `من ${r.requester?.username ?? "مستخدم WTS"}`, `from ${r.requester?.username ?? "WTS user"}`),
  }));
  options.push({ id: "new", title: tr(lang, "\u2795 طلب أموال جديد", "\u2795 New money request"), description: "" });
  options.push({ id: "back", title: tr(lang, "\u{1F519} رجوع للتحويلات", "\u{1F519} Back to transfers"), description: "" });
  return { pending_options: options };
}

async function buildStatementLines(userId: string, lang: Lang): Promise<string> {
  const txs = await prisma.transaction.findMany({
    where: { OR: [{ senderId: userId }, { receiverId: userId }] },
    orderBy: { createdAt: "desc" },
    take: 15,
    include: { sender: { select: { phone: true } }, receiver: { select: { phone: true } } },
  });
  if (txs.length === 0) return tr(lang, "لا يوجد عمليات بعد.", "No transactions yet.");
  return txs
    .map((t: any) => {
      const dir = t.senderId === userId ? tr(lang, "إرسال", "sent") : tr(lang, "استلام", "received");
      const other = t.senderId === userId ? t.receiver?.phone ?? "؟" : t.sender?.phone ?? "؟";
      return tr(lang, `\u2022 ${money(t.amount, lang)} ${dir} (${other}) — ${t.reference}`, `\u2022 ${money(t.amount, lang)} ${dir} (${other}) — ${t.reference}`);
    })
    .join("\n");
}

async function buildReferralsInfo(userId: string, lang: Lang): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { referralCode: true, referralCount: true } });
  if (!user) return tr(lang, "الحساب غير موجود.", "Account not found.");
  const rewarded = await prisma.referral.count({ where: { referrerId: userId, status: "REWARDED" } });
  return tr(
    lang,
    `كود الإحالة بتاعك: ${user.referralCode}\n` +
      `شاركه مع أصحابك! بعد ما يسجّلوا ويتوثّقوا ويعملوا أول تحويل، هتاخد مكافأة الإحالة.\n\n` +
      `عدد المدعوّين: ${user.referralCount} • اتكافئ منهم: ${rewarded}`,
    `Your referral code: ${user.referralCode}\n` +
      `Share it with friends! After they sign up, get verified and complete their first transfer, you earn the referral reward.\n\n` +
      `Invited: ${user.referralCount} • Rewarded: ${rewarded}`
  );
}

async function buildAccountInfo(userId: string, lang: Lang): Promise<string> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { username: true, phone: true, fullName: true, wtsId: true, walletId: true, status: true, verificationStatus: true, createdAt: true },
  });
  if (!u) return tr(lang, "الحساب غير موجود.", "Account not found.");
  return tr(
    lang,
    `الاسم: ${u.fullName ?? "-"}\nكود WTS: ${u.wtsId ?? "-"}\nالمحفظة: ${u.walletId ?? "-"}\n` +
      `الرقم: ${u.phone}\nالحالة: ${u.status}\nالتوثيق: ${u.verificationStatus}\n` +
      `عضو منذ: ${u.createdAt.toLocaleDateString("ar-EG")}`,
    `Name: ${u.fullName ?? "-"}\nWTS ID: ${u.wtsId ?? "-"}\nWallet: ${u.walletId ?? "-"}\n` +
      `Phone: ${u.phone}\nStatus: ${u.status}\nVerification: ${u.verificationStatus}\n` +
      `Member since: ${u.createdAt.toLocaleDateString("en-GB")}`
  );
}
