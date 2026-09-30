// ---------------------------------------------------------------------------
// WhatsApp Flows support - official native in-chat UI only (no browser).
// Every operation is its OWN standalone Flow. PIN confirmation is never a
// screen inside another Flow — it is always the separate "Confirm PIN" Flow,
// triggered as a follow-up message once the operation's own Flow finishes
// collecting data. This mirrors the same separation used for account
// recovery (its own Reference-Code Flow) and PIN creation (its own Flow).
// ---------------------------------------------------------------------------
import crypto from "crypto";
import { prisma } from "../utils/prisma.js";
import { logger } from "../utils/logger.js";
import { completePinFromFlow } from "./whatsapp.service.js";
import { validatePinFormat } from "../services/pin.service.js";
import { executeWtsAction, notifyWtsActionResult, WTS_FLOW_ACTIONS, type WtsActionResponse } from "./whatsapp.actions.js";

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

function resultScreenData(r: WtsActionResponse) {
  return {
    title: r.success ? "✅ تمت العملية بنجاح" : "❌ لم يتم تنفيذ العملية",
    message: r.message,
    transaction_id: r.transactionId ?? "",
    amount_label: r.amount !== undefined ? `${r.amount} جنيه` : "",
    fee_label: r.fee !== undefined ? `${r.fee} جنيه` : "",
    total_label: r.total !== undefined ? `${r.total} جنيه` : "",
    balance_label: r.balanceAfter !== undefined ? `${r.balanceAfter} جنيه` : "",
  };
}

// ── PIN creation Flow (onboarding) — untouched, unrelated to transaction PIN ──
export async function sendPinFlow(to: string, userId: string): Promise<boolean> {
  const flowId = process.env.WHATSAPP_PIN_FLOW_ID;
  if (!flowId) return false;
  const { sendInteractiveMessage } = await import("./whatsapp.client.js");
  const { flowMessagePayload } = await import("./whatsapp.templates.js");
  const r = await sendInteractiveMessage(
    flowMessagePayload(to, flowId, userId, "Create your WTS transaction PIN. It stays private and is never shown again.", "🔐 Create PIN")
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

  if (screen !== "PIN" || !pin || !pinConfirm) {
    return encryptFlowResponse(aesKey, iv, version, "PIN", { message: "Please enter and confirm your PIN." });
  }
  if (pin !== pinConfirm) {
    return encryptFlowResponse(aesKey, iv, version, "PIN", { message: "PINs do not match. Try again." });
  }
  try {
    validatePinFormat(String(pin));
    await completePinFromFlow(String(flowToken), String(pin));
    logger.info("PIN created via WhatsApp Flow", { userId: flowToken });
    return encryptFlowResponse(aesKey, iv, version, "SUCCESS", { message: "PIN created. Your wallet is fully active." });
  } catch (err: any) {
    return encryptFlowResponse(aesKey, iv, version, "PIN", { message: err.message ?? "Invalid PIN" });
  }
}

// ── Send Money Flow — data collection ONLY. Ends by triggering the
// standalone Confirm-PIN Flow as a follow-up message, never as its own screen. ──
export async function sendSendMoneyFlow(to: string, userId: string): Promise<boolean> {
  const flowId = process.env.WHATSAPP_SEND_FLOW_ID;
  if (!flowId) return false;
  const { sendInteractiveMessage } = await import("./whatsapp.client.js");
  const { flowMessagePayload } = await import("./whatsapp.templates.js");
  const r = await sendInteractiveMessage(
    flowMessagePayload(to, flowId, userId, "Send money to another WTS user, inside WhatsApp.", "💸 Send Money")
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

  if (!userId) return send("DONE", { message: "تعذر التحقق من هوية المستخدم" });

  if (screen === "INIT" || flowData?.action === "INIT") {
    return send("RECIPIENT", { message: "أدخل رقم هاتف المستلم مع كود الدولة" });
  }

  if (screen === "RECIPIENT") {
    const result = await executeWtsAction(userId, WTS_FLOW_ACTIONS.SEND_MONEY, { recipientPhone: data.recipient_phone });
    if (!result.success) {
      return send("RECIPIENT", { message: result.message });
    }
    return send("AMOUNT_ESCROW", {
      recipient_phone: result.recipientPhone,
      recipient_label: `${result.recipientName ?? ""} ${result.recipientWtsId ? `(${result.recipientWtsId})` : ""}`.trim(),
      message: `إرسال إلى ${result.recipientName ?? result.recipientPhone}`,
      escrow_options: [
        { id: "yes", title: "🛡️ نعم، فعّل الحماية", description: "يمكنك الإبلاغ لاحقًا لو حصل نصب" },
        { id: "no", title: "لا، تحويل عادي", description: "" },
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
      return send("DONE", { message: `تعذر إعداد التحويل: ${result.message}` });
    }
    return send("REVIEW", {
      authorization_id: result.authorizationId,
      recipient_label: String(data.recipient_label ?? result.recipientWtsId ?? result.recipientPhone ?? ""),
      amount_label: `${result.amount} جنيه`,
      fee_label: `${result.fee} جنيه`,
      total_label: `${result.total} جنيه`,
      escrow_label: escrowEnabled ? "🛡️ الحماية من النصب: مفعّلة" : "",
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
    return send("DONE", { message: "تابع في الرسالة الجاية لإدخال الرمز السري وتأكيد التحويل." });
  }

  return send("DONE", { message: "مسار غير معروف" });
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
  const { sendInteractiveMessage } = await import("./whatsapp.client.js");
  const { flowMessagePayload } = await import("./whatsapp.templates.js");
  const flowToken = `${userId}::${kind}::${refId}`;
  const r = await sendInteractiveMessage(
    flowMessagePayload(to, flowId, flowToken, "🔒 Enter your 6-digit WTS PIN to confirm.", "Confirm")
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
  if (!userId || !kind || !refId) {
    return send("RESULT", resultScreenData({ success: false, status: "ERROR", message: "تعذر التحقق من العملية" }));
  }

  if (screen === "INIT" || flowData?.action === "INIT") {
    let summary = "";
    if (kind === "transfer") {
      const auth = await prisma.transactionAuthorization.findUnique({ where: { authorizationId: refId } });
      if (auth) summary = `المستلم: ${auth.recipientWtsId ?? auth.recipientPhone}\nالإجمالي: ${auth.total} جنيه`;
    } else if (kind === "request") {
      const reqRow = await prisma.transferRequest.findUnique({ where: { id: refId } });
      if (reqRow) summary = `المبلغ المطلوب: ${reqRow.amount} جنيه`;
    }
    return send("PIN", { message: "أدخل رمز WTS السري المكوّن من 6 أرقام", summary_label: summary });
  }

  if (screen === "PIN") {
    const pin = String(data.pin ?? "").trim();
    const action = kind === "transfer" ? WTS_FLOW_ACTIONS.CONFIRM_TRANSFER : WTS_FLOW_ACTIONS.ACCEPT_REQUEST;
    const payload = kind === "transfer" ? { authorizationId: refId, pin } : { requestId: refId, pin };
    const result = await executeWtsAction(userId, action, payload);
    await notifyWtsActionResult(userId, action, result).catch(() => {});
    return send("RESULT", resultScreenData(result));
  }

  return send("RESULT", resultScreenData({ success: false, status: "ERROR", message: "مسار غير معروف" }));
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
  const { sendInteractiveMessage } = await import("./whatsapp.client.js");
  const { flowMessagePayload } = await import("./whatsapp.templates.js");
  const r = await sendInteractiveMessage(
    flowMessagePayload(to, flowId, userId, "افتح محفظة WTS.", "💼 المحفظة")
  );
  return r.ok;
}

function money(n: number | null | undefined): string {
  return `${(n ?? 0).toLocaleString("en-US")} جنيه`;
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

  if (!userId) return send("RESULT", { title: "❌ خطأ", message: "تعذر التحقق من هوية المستخدم." });

  try {
    // ---- المدخل الأول: نجيب الرصيد ونفتح الشاشة الرئيسية ----
    if (screen === "INIT" || flowData?.action === "INIT") {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { demoBalance: true } });
      return send("HOME", { balance_label: money(user?.demoBalance) });
    }

    const op = String(data.op ?? "");

    // ---- رجوع عام لأي شاشة قائمة (البيانات المطلوبة بتتجدد من السيرفر) ----
    if (op === "go_back") {
      const target = String(data.target ?? "HOME");
      if (target === "TRANSFERS_MENU") return send("TRANSFERS_MENU", {});
      if (target === "ACCOUNT_MENU") return send("ACCOUNT_MENU", {});
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { demoBalance: true } });
      return send("HOME", { balance_label: money(user?.demoBalance) });
    }

    // ---- الشاشة الرئيسية ----
    if (screen === "HOME" && op === "home_open") {
      const choice = String(data.choice ?? "");
      if (choice === "transfers") return send("TRANSFERS_MENU", {});
      if (choice === "account") return send("ACCOUNT_MENU", {});
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { demoBalance: true } });
      return send("HOME", { balance_label: money(user?.demoBalance) });
    }

    // ---- قائمة التحويلات ----
    if (screen === "TRANSFERS_MENU" && op === "transfers_open") {
      const choice = String(data.choice ?? "");
      if (choice === "back") {
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { demoBalance: true } });
        return send("HOME", { balance_label: money(user?.demoBalance) });
      }
      if (choice === "send") return send("SEND_RECIPIENT", { error: "" });
      if (choice === "request") return send("REQUESTS_HOME", await buildRequestsHomeData(userId));
      if (choice === "balance") {
        const u = await prisma.user.findUnique({ where: { id: userId }, select: { wtsId: true, demoBalance: true } });
        return send("BALANCE", { wts_id: u?.wtsId ?? "-", balance_label: money(u?.demoBalance) });
      }
      if (choice === "statement") {
        const lines = await buildStatementLines(userId);
        return send("STATEMENT", { lines });
      }
      return send("TRANSFERS_MENU", {});
    }

    // ---- قائمة الحساب ----
    if (screen === "ACCOUNT_MENU" && op === "account_open") {
      const choice = String(data.choice ?? "");
      if (choice === "back") {
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { demoBalance: true } });
        return send("HOME", { balance_label: money(user?.demoBalance) });
      }
      if (choice === "info") return send("ACCOUNT_INFO", { info: await buildAccountInfo(userId) });
      if (choice === "referrals") return send("REFERRALS", { info: await buildReferralsInfo(userId) });
      if (choice === "pin") return send("CHANGE_PIN", { message: "أدخل الرمز الجديد (6 أرقام)" });
      if (choice === "help") return send("HELP", {});
      return send("ACCOUNT_MENU", {});
    }

    // ---- تغيير الـ PIN ----
    if (screen === "CHANGE_PIN" && op === "change_pin") {
      const pin = String(data.pin ?? "").trim();
      try {
        validatePinFormat(pin);
        await setPin(prisma, { userId, pin });
        return send("RESULT", { title: "✅ تم", message: "اتغيّر الرمز السري بنجاح." });
      } catch (err: any) {
        return send("CHANGE_PIN", { message: err.message ?? "رمز غير صالح، جرب تاني." });
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
          { id: "yes", title: "🛡️ نعم، فعّل الحماية", description: "تقدر تبلّغ لاحقًا لو حصل نصب" },
          { id: "no", title: "لا، تحويل عادي", description: "" },
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
            { id: "yes", title: "🛡️ نعم، فعّل الحماية", description: "" },
            { id: "no", title: "لا، تحويل عادي", description: "" },
          ],
        });
      }
      const summary =
        `المستلم: ${data.recipient_label}\n` +
        `المبلغ: ${money(result.amount)}\n` +
        `الرسوم: ${money(result.fee)}\n` +
        `الإجمالي: ${money(result.total)}` +
        (escrowEnabled ? `\n🛡️ الحماية من النصب: مفعّلة` : "");
      return send("SEND_REVIEW", { authorization_id: result.authorizationId, summary });
    }

    // ---- تحويل أموال: الخطوة 3 - الانتقال لإدخال الـ PIN (نفس شاشة PIN العامة) ----
    if (screen === "SEND_REVIEW" && op === "goto_pin") {
      return send("PIN_ENTRY", {
        kind: "transfer",
        ref_id: String(data.ref_id ?? ""),
        summary: "أدخل الرمز السري لتأكيد التحويل.",
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
      if (!reqRow) return send("REQUESTS_HOME", await buildRequestsHomeData(userId));
      return send("REQUEST_VIEW", {
        request_id: reqRow.id,
        summary: `${reqRow.requester?.username ?? "مستخدم"} طالب منك ${money(reqRow.amount)}.${reqRow.description ? `\nالسبب: ${reqRow.description}` : ""}`,
      });
    }
    if (op === "requests_home") return send("REQUESTS_HOME", await buildRequestsHomeData(userId));

    // ---- طلب أموال: الانتقال لإدخال PIN لقبول الطلب ----
    if (screen === "REQUEST_VIEW" && op === "goto_pin") {
      return send("PIN_ENTRY", {
        kind: "request",
        ref_id: String(data.ref_id ?? ""),
        summary: "أدخل الرمز السري لتأكيد قبول الطلب وتحويل المبلغ.",
      });
    }

    // ---- طلب أموال جديد: الخطوة 1 - من مين ----
    if (screen === "REQUEST_RECIPIENT" && op === "request_recipient") {
      const phone = String(data.payer_phone ?? "").replace(/[\s\-()]/g, "");
      const payer = await prisma.user.findUnique({ where: { phone: normalizeWaPhone(phone.replace("+", "")) } });
      if (!payer) return send("REQUEST_RECIPIENT", { error: "لا يوجد مستخدم WTS بهذا الرقم." });
      if (payer.id === userId) return send("REQUEST_RECIPIENT", { error: "لا يمكنك الطلب من نفسك." });
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
          requester?.fullName ?? requester?.username ?? "مستخدم WTS",
          request.amount,
          request.id
        ).catch(() => {});
        return send("REQUEST_RESULT", { message: `تم إرسال طلب بمبلغ ${money(amount)} إلى ${data.payer_label}.` });
      } catch (err: any) {
        return send("REQUEST_RESULT", { message: `تعذر إرسال الطلب: ${err.message ?? "خطأ غير معروف"}` });
      }
    }

    // ---- شاشة الـ PIN الموحّدة: تنفيذ فعلي بعد تحقق السيرفر ----
    if (screen === "PIN_ENTRY" && op === "execute") {
      const kind = String(data.kind ?? "");
      const refId = String(data.ref_id ?? "");
      const pin = String(data.pin ?? "").trim();
      if (!/^\d{6}$/.test(pin)) {
        return send("PIN_ENTRY", { kind, ref_id: refId, summary: "أدخل رمز مكوّن من 6 أرقام." });
      }
      if (kind === "transfer") {
        // executeWtsAction's CONFIRM_TRANSFER بالفعل بتبعت إشعار المستلم
        // وتقيّم أهلية الإحالة جوّاها — من غير تكرار هنا.
        const result = await executeWtsAction(userId, WTS_FLOW_ACTIONS.CONFIRM_TRANSFER, { authorizationId: refId, pin });
        return send("RESULT", resultScreenData(result));
      }
      if (kind === "request") {
        try {
          const { transaction } = await acceptTransferRequest(prisma, { requestId: refId, payerId: userId, pin });
          await notifyTransferReceived(transaction.id).catch(() => {});
          return send("RESULT", {
            title: "✅ تمت العملية بنجاح",
            message: `تم تحويل ${money(transaction.amount)}.`,
          });
        } catch (err: any) {
          if (err instanceof PinError) {
            return send("PIN_ENTRY", { kind, ref_id: refId, summary: err.message });
          }
          const msg = err instanceof TransferRequestError ? err.message : "تعذر تنفيذ العملية.";
          return send("RESULT", { title: "❌ لم يتم تنفيذ العملية", message: msg });
        }
      }
      return send("RESULT", { title: "❌ خطأ", message: "نوع عملية غير معروف." });
    }

    // مسار غير متوقع — نرجّع المستخدم لأمان الشاشة الرئيسية بدل ما نعلّق الفلو
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { demoBalance: true } });
    return send("HOME", { balance_label: money(user?.demoBalance) });
  } catch (err) {
    logger.error("Wallet flow data-exchange error", err);
    return send("RESULT", { title: "❌ خطأ", message: "حصل خطأ غير متوقع، جرب تاني من *menu*." });
  }
}

async function buildRequestsHomeData(userId: string) {
  const pending = await listIncomingRequests(prisma, userId);
  const options = pending.slice(0, 8).map((r: any) => ({
    id: r.id,
    title: `${r.amount.toLocaleString("en-US")} جنيه`,
    description: `من ${r.requester?.username ?? "مستخدم WTS"}`,
  }));
  options.push({ id: "new", title: "➕ طلب أموال جديد", description: "" });
  options.push({ id: "back", title: "🔙 رجوع للتحويلات", description: "" });
  return { pending_options: options };
}

async function buildStatementLines(userId: string): Promise<string> {
  const txs = await prisma.transaction.findMany({
    where: { OR: [{ senderId: userId }, { receiverId: userId }] },
    orderBy: { createdAt: "desc" },
    take: 15,
    include: { sender: { select: { phone: true } }, receiver: { select: { phone: true } } },
  });
  if (txs.length === 0) return "لا يوجد عمليات بعد.";
  return txs
    .map((t: any) => {
      const dir = t.senderId === userId ? "إرسال" : "استلام";
      const other = t.senderId === userId ? t.receiver?.phone ?? "؟" : t.sender?.phone ?? "؟";
      return `• ${money(t.amount)} ${dir} (${other}) — ${t.reference}`;
    })
    .join("\n");
}

async function buildReferralsInfo(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { referralCode: true, referralCount: true } });
  if (!user) return "الحساب غير موجود.";
  const rewarded = await prisma.referral.count({ where: { referrerId: userId, status: "REWARDED" } });
  return (
    `كود الإحالة بتاعك: ${user.referralCode}\n` +
    `شاركه مع أصحابك! بعد ما يسجّلوا ويتوثّقوا ويعملوا أول تحويل، هتاخد مكافأة الإحالة.\n\n` +
    `عدد المدعوّين: ${user.referralCount} • اتكافئ منهم: ${rewarded}`
  );
}

async function buildAccountInfo(userId: string): Promise<string> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { username: true, phone: true, fullName: true, wtsId: true, walletId: true, status: true, verificationStatus: true, createdAt: true },
  });
  if (!u) return "الحساب غير موجود.";
  return (
    `الاسم: ${u.fullName ?? "-"}\nWTS ID: ${u.wtsId ?? "-"}\nالمحفظة: ${u.walletId ?? "-"}\n` +
    `الرقم: ${u.phone}\nالحالة: ${u.status}\nالتوثيق: ${u.verificationStatus}\n` +
    `عضو منذ: ${u.createdAt.toLocaleDateString("ar-EG")}`
  );
}
