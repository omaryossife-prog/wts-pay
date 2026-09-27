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
