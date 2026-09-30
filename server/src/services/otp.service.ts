// ---------------------------------------------------------------------------
// Phone OTP lifecycle — التحقق من رقم الهاتف برسالة SMS قبل تسجيل محفظة جديدة.
//
// التخزين: جدول Config الموجود أصلاً (key: `phoneOtp:<phone>`) عشان منحتاجش
// migration جديدة لـ Prisma. الكود متخزّن كـ hash فقط — مش نص صريح أبدًا.
//
// بعد نجاح التحقق بنصدر phoneToken (JWT قصير العمر، purpose=phone_verify)
// وعملية التسجيل /api/auth/register بترفض أي طلب من غيره.
// ---------------------------------------------------------------------------
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import type { Db } from "../utils/prisma.js";
import { getConfigJson, setConfig } from "./config.service.js";
import { sendSms } from "./sms.service.js";
import { logger } from "../utils/logger.js";

export class OtpError extends Error {
  code:
    | "INVALID_PHONE"
    | "PHONE_TAKEN"
    | "TOO_SOON"
    | "DAILY_LIMIT"
    | "EXPIRED"
    | "TOO_MANY_ATTEMPTS"
    | "INVALID_CODE"
    | "INVALID_TOKEN"
    | "SEND_FAILED" = "INVALID_CODE";
  status = 400;
  retryAfterSeconds?: number;
  constructor(code: OtpError["code"], message: string, status = 400, retryAfterSeconds?: number) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const OTP_TTL_MS = 5 * 60 * 1000;          // صلاحية الكود: 5 دقائق
const RESEND_COOLDOWN_MS = 45 * 1000;      // أقل فترة بين إرسالين
const MAX_VERIFY_ATTEMPTS = 5;             // محاولات إدخال الكود
const MAX_SENDS_PER_DAY = 5;               // حد الرسائل اليومي لكل رقم
const DAY_MS = 24 * 3600 * 1000;
const PHONE_TOKEN_TTL = "15m";             // صلاحية توكن التحقق بعد نجاح OTP

interface OtpRecord {
  codeHash: string;
  expiresAt: string;
  lastSentAt: string;
  attempts: number;
  sends: number;
  windowStart: string;
}

// نفس تطبيع التسجيل: شيل المسافات والشرط والأقواس، ووحّد 00 → +
export function normalizePhone(raw: string): string {
  let p = raw.replace(/[\s\-()]/g, "");
  if (p.startsWith("00")) p = "+" + p.slice(2);
  return p;
}

export function validateIntlPhone(phone: string): boolean {
  // لازم صيغة دولية بعلامة + وكود الدولة عشان البوابة تقدر تبعت
  return /^\+[0-9]{8,15}$/.test(phone);
}

function hashCode(code: string, phone: string): string {
  return crypto
    .createHash("sha256")
    .update(`${code}:${phone}:${config.jwtSecret}`)
    .digest("hex");
}

function keyFor(phone: string): string {
  return `phoneOtp:${phone}`;
}

function generateCode(): string {
  // 6 أرقام، من 100000 لـ 999999
  return String(crypto.randomInt(100000, 1000000));
}

export async function requestOtp(db: Db, rawPhone: string): Promise<{ cooldownSeconds: number }> {
  const client: any = db;
  const phone = normalizePhone(rawPhone);
  if (!validateIntlPhone(phone)) {
    throw new OtpError(
      "INVALID_PHONE",
      "Enter the number in international format with country code, e.g. +2010xxxxxxxx."
    );
  }

  const existing = await client.user.findUnique({ where: { phone } });
  if (existing) {
    throw new OtpError("PHONE_TAKEN", "An account with this phone number already exists.");
  }

  const now = Date.now();
  const prev = (await getConfigJson(db, keyFor(phone))) as unknown as OtpRecord | null;

  if (prev) {
    const sinceLast = now - new Date(prev.lastSentAt).getTime();
    if (sinceLast < RESEND_COOLDOWN_MS) {
      const wait = Math.ceil((RESEND_COOLDOWN_MS - sinceLast) / 1000);
      throw new OtpError("TOO_SOON", `Please wait ${wait}s before requesting a new code.`, 429, wait);
    }
    const windowAge = now - new Date(prev.windowStart).getTime();
    if (windowAge < DAY_MS && prev.sends >= MAX_SENDS_PER_DAY) {
      throw new OtpError(
        "DAILY_LIMIT",
        "Too many verification SMS today. Please try again tomorrow.",
        429
      );
    }
  }

  const code = generateCode();
  const sameWindow =
    prev && now - new Date(prev.windowStart).getTime() < DAY_MS;

  const record: OtpRecord = {
    codeHash: hashCode(code, phone),
    expiresAt: new Date(now + OTP_TTL_MS).toISOString(),
    lastSentAt: new Date(now).toISOString(),
    attempts: 0,
    sends: sameWindow ? (prev!.sends ?? 0) + 1 : 1,
    windowStart: sameWindow ? prev!.windowStart : new Date(now).toISOString(),
  };

  // ابعت الرسالة الأول — لو البوابة وقعت مش هنخزّن الكود (المستخدم يقدر يجرب تاني فورًا)
  try {
    await sendSms(
      phone,
      `WTS Pay: Your verification code is ${code}. It expires in 5 minutes. Never share it with anyone.`
    );
  } catch (e: any) {
    logger.warn("OTP SMS send failed", { phone, error: e?.message });
    throw new OtpError(
      "SEND_FAILED",
      "Could not send the SMS right now. Check the gateway phone and try again.",
      502
    );
  }

  await setConfig(db, keyFor(phone), record);
  logger.info("OTP sent", { phone });
  return { cooldownSeconds: RESEND_COOLDOWN_MS / 1000 };
}

export interface PhoneTokenPayload {
  purpose: "phone_verify";
  phone: string;
}

export async function verifyOtp(db: Db, rawPhone: string, code: string): Promise<{ phoneToken: string }> {
  const phone = normalizePhone(rawPhone);
  const record = (await getConfigJson(db, keyFor(phone))) as unknown as OtpRecord | null;

  if (!record || Date.now() > new Date(record.expiresAt).getTime()) {
    throw new OtpError("EXPIRED", "The code expired or was never requested. Request a new one.");
  }
  if (record.attempts >= MAX_VERIFY_ATTEMPTS) {
    throw new OtpError("TOO_MANY_ATTEMPTS", "Too many wrong attempts. Request a new code.", 429);
  }

  const expected = Buffer.from(record.codeHash, "hex");
  const actual = Buffer.from(hashCode(code.trim(), phone), "hex");
  const match = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);

  if (!match) {
    await setConfig(db, keyFor(phone), { ...record, attempts: record.attempts + 1 });
    const left = MAX_VERIFY_ATTEMPTS - (record.attempts + 1);
    throw new OtpError(
      "INVALID_CODE",
      left > 0 ? `Wrong code. ${left} attempt(s) left.` : "Too many wrong attempts. Request a new code."
    );
  }

  // نجاح: امسح السجل (الكود مش صالح للاستخدام تاني) واصدر توكن تحقق قصير
  try {
    await (db as any).config.delete({ where: { key: keyFor(phone) } });
  } catch {
    // لو الحذف فشل مش مشكلة — الكود منتهي الصلاحية خلال دقائق على أي حال
  }

  const phoneToken = jwt.sign(
    { purpose: "phone_verify", phone } satisfies PhoneTokenPayload,
    config.jwtSecret,
    { expiresIn: PHONE_TOKEN_TTL }
  );
  return { phoneToken };
}

// بيتنادى جوه /api/auth/register — يرمي OtpError لو التوكن مش صالح للرقم ده
export function assertPhoneVerified(phoneToken: string | undefined, rawPhone: string): string {
  if (!phoneToken) {
    throw new OtpError("INVALID_TOKEN", "Phone verification is required before registration.");
  }
  let payload: PhoneTokenPayload;
  try {
    payload = jwt.verify(phoneToken, config.jwtSecret) as PhoneTokenPayload;
  } catch {
    throw new OtpError("INVALID_TOKEN", "Phone verification expired. Verify your number again.");
  }
  const phone = normalizePhone(rawPhone);
  if (payload.purpose !== "phone_verify" || payload.phone !== phone) {
    throw new OtpError("INVALID_TOKEN", "Phone verification does not match this number.");
  }
  return payload.phone;
}
