// ---------------------------------------------------------------------------
// SMSGate (capcom6/android-sms-gateway) client — Cloud Server mode.
// الرسالة بتتبعت من موبايل الأندرويد بتاعك عن طريق https://api.sms-gate.app
// الـ credentials (username/password) بتظهر في تطبيق SMSGate → تبويب "الرئيسية"
// بعد تفعيل Cloud Server والضغط على Online. بتتحط كـ secrets في الـ Worker فقط.
//
// بنقرأ process.env وقت الاستدعاء (مش وقت تحميل الملف) عشان الـ Worker
// بيملّا الـ env مع أول request.
// ---------------------------------------------------------------------------
import { logger } from "../utils/logger.js";

export class SmsSendError extends Error {
  constructor(message: string, public status = 0) {
    super(message);
  }
}

export type SmsSender = (phone: string, text: string) => Promise<void>;

const DEFAULT_URL = "https://api.sms-gate.app/3rdparty/v1/messages";

export function isSmsConfigured(): boolean {
  return Boolean(process.env.SMSGATE_USERNAME && process.env.SMSGATE_PASSWORD);
}

export const sendSms: SmsSender = async (phone, text) => {
  const username = process.env.SMSGATE_USERNAME;
  const password = process.env.SMSGATE_PASSWORD;
  if (!username || !password) {
    throw new SmsSendError("SMS gateway is not configured.");
  }
  const url = process.env.SMSGATE_URL || DEFAULT_URL;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${btoa(`${username}:${password}`)}`,
      },
      body: JSON.stringify({
        textMessage: { text },
        phoneNumbers: [phone],
        // لو الموبايل أوفلاين أكتر من 5 دقايق الكود خلاص انتهى — مالوش لازمة يتبعت متأخر
        ttl: 300,
      }),
    });
  } catch (err) {
    logger.error("SMSGate request failed", err);
    throw new SmsSendError("Could not reach the SMS gateway.");
  }

  if (!res.ok) {
    // مبنسجّلش نص الرسالة (فيه الكود) — الـ status بس
    const body = await res.text().catch(() => "");
    logger.error("SMSGate rejected message", res.status, body.slice(0, 200));
    throw new SmsSendError("SMS gateway rejected the message.", res.status);
  }
};
