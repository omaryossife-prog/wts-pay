// ---------------------------------------------------------------------------
// WhatsApp Flows support - official native in-chat UI only (no browser).
// Existing PIN Flow is preserved. The generic "actions" Flow exposes WTS
// operations through the same backend services used by the website/chat.
// ---------------------------------------------------------------------------
import crypto from "crypto";
import { logger } from "../utils/logger.js";
import { completePinFromFlow } from "./whatsapp.service.js";
import { validatePinFormat } from "../services/pin.service.js";
import { executeWtsAction, notifyWtsActionResult, WTS_FLOW_ACTIONS, type WtsActionResponse } from "./whatsapp.actions.js";

interface FlowKeys {
  aesKey: Buffer;
  iv: Buffer;
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

function flowScreenData(screen: string, data: Record<string, unknown>) {
  return { screen, data };
}

function resultScreenData(r: WtsActionResponse) {
  return flowScreenData("RESULT", {
    success: r.success,
    status: r.status,
    title: r.success ? "✅ تمت العملية بنجاح" : "❌ لم يتم تنفيذ العملية",
    message: r.message,
    transaction_id: r.transactionId ?? "",
    amount_label: r.amount !== undefined ? `${r.amount} جنيه` : "",
    fee_label: r.fee !== undefined ? `${r.fee} جنيه` : "",
    total_label: r.total !== undefined ? `${r.total} جنيه` : "",
    balance_label: r.balanceAfter !== undefined ? `${r.balanceAfter} جنيه` : "",
  });
}

function selectableActions() {
  return [
    { id: WTS_FLOW_ACTIONS.SEND_MONEY, title: "إرسال أموال", description: "تحويل إلى مستخدم WTS" },
    { id: WTS_FLOW_ACTIONS.GET_BALANCE, title: "الرصيد", description: "عرض الرصيد الحالي" },
    { id: WTS_FLOW_ACTIONS.GET_TRANSACTIONS, title: "العمليات", description: "آخر 10 عمليات" },
    { id: WTS_FLOW_ACTIONS.GET_REFERRALS, title: "الإحالات", description: "كودك وحالة المكافآت" },
  ];
}

// Send the existing PIN creation Flow.
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

// Send the generic WTS actions Flow (Send Money + read-only operations).
export async function sendWtsActionsFlow(to: string, userId: string): Promise<boolean> {
  const flowId = process.env.WHATSAPP_WTS_ACTIONS_FLOW_ID;
  if (!flowId) return false;
  const { sendInteractiveMessage } = await import("./whatsapp.client.js");
  const { flowMessagePayload } = await import("./whatsapp.templates.js");
  const r = await sendInteractiveMessage(
    flowMessagePayload(to, flowId, userId, "Run WTS Pay actions inside WhatsApp. Results come from the backend only.", "WTS Actions")
  );
  return r.ok;
}

// POST /api/whatsapp/flows/pin - legacy secure PIN creation Flow.
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

// POST /api/whatsapp/flows/actions - generic WTS actions Flow with RESULT screen.
export async function handleWtsActionsFlowDataExchange(body: any): Promise<any> {
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

  if (!userId) return send("RESULT", resultScreenData({ success: false, status: "ERROR", message: "تعذر التحقق من هوية المستخدم" }).data);

  if (screen === "INIT" || flowData?.action === "INIT") {
    return send("SELECT_ACTION", { actions: selectableActions(), message: "اختر العملية المطلوبة" });
  }

  if (flowData?.action === "BACK") {
    return send("SELECT_ACTION", { actions: selectableActions(), message: "اختر العملية المطلوبة" });
  }

  if (flowData?.action !== "data_exchange") {
    return send("SELECT_ACTION", { actions: selectableActions(), message: "اختر العملية المطلوبة" });
  }

  if (screen === "SELECT_ACTION") {
    const selected = String(data.wts_action ?? "");
    if (selected === WTS_FLOW_ACTIONS.SEND_MONEY) {
      return send("RECIPIENT", { message: "أدخل رقم هاتف المستلم مع كود الدولة" });
    }
    const result = await executeWtsAction(userId, selected, {});
    await notifyWtsActionResult(userId, selected, result);
    return send("RESULT", resultScreenData(result).data);
  }

  if (screen === "RECIPIENT") {
    const result = await executeWtsAction(userId, WTS_FLOW_ACTIONS.SEND_MONEY, { recipientPhone: data.recipient_phone });
    if (!result.success) {
      await notifyWtsActionResult(userId, WTS_FLOW_ACTIONS.SEND_MONEY, result);
      return send("RESULT", resultScreenData(result).data);
    }
    return send("AMOUNT", {
      recipient_phone: result.recipientPhone,
      recipient_label: `${result.recipientName ?? ""} ${result.recipientWtsId ? `(${result.recipientWtsId})` : ""}`.trim(),
      message: `إرسال إلى ${result.recipientName ?? result.recipientPhone}`,
    });
  }

  if (screen === "AMOUNT") {
    const result = await executeWtsAction(userId, WTS_FLOW_ACTIONS.CREATE_TRANSFER, {
      recipientPhone: data.recipient_phone,
      amount: data.amount,
    });
    if (!result.success) {
      await notifyWtsActionResult(userId, WTS_FLOW_ACTIONS.CREATE_TRANSFER, result);
      return send("RESULT", resultScreenData(result).data);
    }
    return send("REVIEW", {
      authorization_id: result.authorizationId,
      recipient_label: String(data.recipient_label ?? result.recipientWtsId ?? result.recipientPhone ?? ""),
      amount_label: `${result.amount} جنيه`,
      fee_label: `${result.fee} جنيه`,
      total_label: `${result.total} جنيه`,
      message: "راجع التحويل قبل تأكيده",
    });
  }

  if (screen === "REVIEW") {
    return send("PIN", {
      authorization_id: data.authorization_id,
      recipient_label: data.recipient_label,
      amount_label: data.amount_label,
      fee_label: data.fee_label,
      total_label: data.total_label,
      message: "أدخل رمز WTS السري المكوّن من 6 أرقام",
    });
  }

  if (screen === "PIN") {
    const result = await executeWtsAction(userId, WTS_FLOW_ACTIONS.CONFIRM_TRANSFER, {
      authorizationId: data.authorization_id,
      pin: data.pin,
    });
    await notifyWtsActionResult(userId, WTS_FLOW_ACTIONS.CONFIRM_TRANSFER, result);
    return send("RESULT", resultScreenData(result).data);
  }

  return send("RESULT", resultScreenData({ success: false, status: "ERROR", message: "مسار Flow غير معروف" }).data);
}
