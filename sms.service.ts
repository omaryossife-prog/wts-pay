// ---------------------------------------------------------------------------
// SMS sending via SMSGate (sms-gate.app) — يحوّل موبايل أندرويد عليه شريحة
// إلى بوابة SMS. الـ Worker بينادي الـ API بتاع SMSGate (سحابي أو self-hosted)،
// والسيرفر بيبعّت الأمر للموبايل اللي بيبعت الرسالة من الشريحة نفسها.
//
// ملحوظة مهمة: وضع "Local Server" في التطبيق مش هينفع مع Cloudflare Worker
// (الموبايل مش reachable من الإنترنت) — استخدم Cloud mode أو سيرفر خاص.
// ---------------------------------------------------------------------------
import { config } from "../config.js";

export class SmsError extends Error {
  code: "NOT_CONFIGURED" | "GATEWAY_ERROR" | "TIMEOUT" = "GATEWAY_ERROR";
  constructor(code: SmsError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

export function smsConfigured(): boolean {
  return config.smsGate.enabled;
}

// SMSGate API: POST {base}/messages  (Basic Auth)
// body: { textMessage: { text }, phoneNumbers: [phone] }
export async function sendSms(phone: string, text: string): Promise<void> {
  if (!config.smsGate.enabled) {
    throw new SmsError(
      "NOT_CONFIGURED",
      "SMS gateway is not configured. Set SMSGATE_USERNAME / SMSGATE_PASSWORD secrets."
    );
  }

  const base = config.smsGate.url.replace(/\/+$/, "");
  const auth = Buffer.from(
    `${config.smsGate.username}:${config.smsGate.password}`
  ).toString("base64");

  let res: Response;
  try {
    res = await fetch(`${base}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({
        textMessage: { text },
        phoneNumbers: [phone],
      }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (e: any) {
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      throw new SmsError("TIMEOUT", "SMS gateway request timed out.");
    }
    throw new SmsError("GATEWAY_ERROR", `SMS gateway unreachable: ${String(e?.message ?? e)}`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new SmsError(
      "GATEWAY_ERROR",
      `SMS gateway rejected the message (${res.status}): ${body.slice(0, 200)}`
    );
  }
}
