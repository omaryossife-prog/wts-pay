// ---------------------------------------------------------------------------
// Phone ownership verification by SMS (OTP) before website registration.
//
//  1. sendPhoneCode   → يولّد كود 6 أرقام، يخزّن hash بس، ويبعته SMS عن طريق SMSGate
//  2. verifyPhoneCode → يتحقق من الكود ويصدر phoneToken صالح 15 دقيقة
//  3. assertPhoneToken → بيستدعيه /auth/register ويرفض أي طلب من غير token مطابق للرقم
//
// التخزين: جدول Config الموجود (مفيش migration):
//   phoneotp:<phone>    → حالة كود الرقم
//   phoneotp-ip:<ip>    → عداد الإرسال اليومي للـ IP
// ---------------------------------------------------------------------------
import crypto from "crypto";
import jwt from "jsonwebtoken";
import type { Db } from "../utils/prisma.js";
import { config } from "../config.js";
import { sendSms, SmsSendError, type SmsSender } from "./smsgate.service.js";

export const OTP_TTL_MS = 5 * 60 * 1000;          // صلاحية الكود 5 دقائق
export const OTP_MAX_ATTEMPTS = 5;                // 5 محاولات إدخال كحد أقصى
export const OTP_RESEND_COOLDOWN_MS = 45 * 1000;  // 45 ثانية بين كل إرسال
export const OTP_MAX_SENDS_PER_DAY = 5;           // 5 رسائل يوميًا لكل رقم
export const OTP_MAX_SENDS_PER_IP_PER_DAY = 10;   // حماية رصيد الشريحة من الاستنزاف
export const PHONE_TOKEN_TTL_SECONDS = 15 * 60;   // phoneToken صالح 15 دقيقة

export type PhoneVerificationErrorCode =
  | "INVALID_PHONE"
  | "PHONE_TAKEN"
  | "COOLDOWN"
  | "DAILY_LIMIT"
  | "IP_LIMIT"
  | "SMS_UNAVAILABLE"
  | "NO_CODE"
  | "CODE_EXPIRED"
  | "TOO_MANY_ATTEMPTS"
  | "INVALID_CODE"
  | "PHONE_NOT_VERIFIED"
  | "IDENTITY_MISMATCH";

export class PhoneVerificationError extends Error {
  code: PhoneVerificationErrorCode;
  retryAfterSeconds?: number;
  constructor(code: PhoneVerificationErrorCode, message: string, retryAfterSeconds?: number) {
    super(message);
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

interface OtpState {
  codeHash: string | null;   // null = مفيش كود فعّال (اتستخدم / اتلغى / خلص محاولاته)
  expiresAt: number;
  attempts: number;
  lastSentAt: number;
  day: string;               // YYYY-MM-DD (UTC)
  sentToday: number;
}

interface IpState { day: string; count: number }

// الصيغة الدولية فقط: +<country><number>
export function normalizeInternationalPhone(raw: string): string {
  const phone = raw.replace(/[\s\-()]/g, "");
  if (!/^\+[1-9][0-9]{7,14}$/.test(phone)) {
    throw new PhoneVerificationError("INVALID_PHONE", "اكتب الرقم بالصيغة الدولية، مثال: +2010xxxxxxxx");
  }
  return phone;
}

const dayKey = (now: number) => new Date(now).toISOString().slice(0, 10);

// HMAC-SHA256 بمفتاح السيرفر + ربط الكود بالرقم: حتى لو الـ DB اتسربت،
// مساحة الـ 6 أرقام (مليون احتمال) مينفعش تتجرب offline من غير المفتاح.
function hashCode(phone: string, code: string): string {
  return crypto.createHmac("sha256", config.jwtSecret).update(`${phone}:${code}`).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// مفتاح منفصل للـ phoneToken عشان مينفعش يتستخدم كـ auth token والعكس
const phoneTokenSecret = () => `${config.jwtSecret}:phone-verify`;

async function getConfigRow<T>(db: Db, key: string): Promise<T | null> {
  const row = await (db as any).config.findUnique({ where: { key } });
  return row && typeof row.value === "object" ? (row.value as T) : null;
}

async function putConfigRow(db: Db, key: string, value: unknown) {
  await (db as any).config.upsert({ where: { key }, update: { value }, create: { key, value } });
}

export interface SendCodeInput {
  phone: string;
  ip?: string;
  now?: number;
  sender?: SmsSender; // للاختبارات
  // لو ده رقم مستخدم واتساب لسه بيكمّل تسجيله (الصف اتعمل أول ما دوس "ابدأ"،
  // قبل ما يوصل لخطوة الـ OTP) — مسموح نبعت كود حتى لو الصف موجود، طالما
  // نفس المستخدم ده بالظبط.
  allowUserId?: string;
}

export async function sendPhoneCode(db: Db, input: SendCodeInput) {
  const client: any = db;
  const now = input.now ?? Date.now();
  const sender = input.sender ?? sendSms;
  const phone = normalizeInternationalPhone(input.phone);
  const today = dayKey(now);

  // لو الرقم مسجل قبل كده: مفيش SMS أصلًا — إلا لو ده نفس صف تسجيل
  // الواتساب الجاري استكماله دلوقتي (allowUserId).
  const existing = await client.user.findUnique({ where: { phone } });
  if (existing && existing.id !== input.allowUserId) {
    throw new PhoneVerificationError("PHONE_TAKEN", "في حساب مسجل بالرقم ده بالفعل.");
  }

  // حد يومي لكل IP (بيحمي من تدوير أرقام كتير لاستنزاف رصيد الشريحة)
  const ipKey = input.ip ? `phoneotp-ip:${input.ip}` : null;
  let ipState: IpState | null = null;
  if (ipKey) {
    ipState = await getConfigRow<IpState>(client, ipKey);
    if (!ipState || ipState.day !== today) ipState = { day: today, count: 0 };
    if (ipState.count >= OTP_MAX_SENDS_PER_IP_PER_DAY) {
      throw new PhoneVerificationError("IP_LIMIT", "تم تجاوز الحد اليومي للطلبات. جرّب بكرة.");
    }
  }

  const key = `phoneotp:${phone}`;
  const prev = await getConfigRow<OtpState>(client, key);
  const sameDay = prev && prev.day === today;

  if (prev) {
    const waitMs = prev.lastSentAt + OTP_RESEND_COOLDOWN_MS - now;
    if (waitMs > 0) {
      const secs = Math.ceil(waitMs / 1000);
      throw new PhoneVerificationError("COOLDOWN", `استنى ${secs} ثانية قبل طلب كود جديد.`, secs);
    }
    if (sameDay && prev.sentToday >= OTP_MAX_SENDS_PER_DAY) {
      throw new PhoneVerificationError("DAILY_LIMIT", "وصلت للحد الأقصى من الرسائل النهارده لهذا الرقم. جرّب بكرة.");
    }
  }

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const next: OtpState = {
    codeHash: hashCode(phone, code),
    expiresAt: now + OTP_TTL_MS,
    attempts: 0,
    lastSentAt: now,
    day: today,
    sentToday: (sameDay ? prev!.sentToday : 0) + 1,
  };

  // نحفظ الأول ثم نبعت — وده يمنع الإرسال المتكرر السريع
  await putConfigRow(client, key, next);
  if (ipKey && ipState) await putConfigRow(client, ipKey, { ...ipState, count: ipState.count + 1 });

  try {
    await sender(phone, `كود التحقق الخاص بك في WTS Pay هو: ${code}\nصالح لمدة 5 دقائق. لا تشاركه مع أي شخص.`);
  } catch (err) {
    // الإرسال فشل (الموبايل أوفلاين مثلًا): نرجّع الحالة زي ما كانت عشان المستخدم ميتعاقبش
    if (prev) await putConfigRow(client, key, prev);
    else await putConfigRow(client, key, { ...next, codeHash: null, sentToday: 0, lastSentAt: 0 });
    if (ipKey && ipState) await putConfigRow(client, ipKey, ipState);
    if (err instanceof SmsSendError) {
      throw new PhoneVerificationError("SMS_UNAVAILABLE", "مش قادرين نبعت الرسالة دلوقتي. جرّب بعد شوية.");
    }
    throw err;
  }

  return { ok: true, phone, expiresInSeconds: OTP_TTL_MS / 1000, resendAfterSeconds: OTP_RESEND_COOLDOWN_MS / 1000 };
}

// ---------------------------------------------------------------------------
// Forgot password: phone + last 6 digits of the national ID (collected at
// registration) proves identity, then the SAME SMS-OTP code/verify machinery
// above is reused (same Config key namespace "phoneotp:<phone>") — only the
// existence check is inverted: here the user MUST already exist and match.
// ---------------------------------------------------------------------------
export interface SendResetCodeInput {
  phone: string;
  nationalIdLast6: string;
  ip?: string;
  now?: number;
  sender?: SmsSender;
}

export async function sendPasswordResetCode(db: Db, input: SendResetCodeInput) {
  const client: any = db;
  const now = input.now ?? Date.now();
  const sender = input.sender ?? sendSms;
  const phone = normalizeInternationalPhone(input.phone);
  const today = dayKey(now);
  const last6 = input.nationalIdLast6.replace(/\D/g, "");

  const user = await client.user.findUnique({ where: { phone } });
  if (!user || !user.nationalIdLast6 || last6.length !== 6 || user.nationalIdLast6 !== last6) {
    // رسالة عامة ومتعمّدة إنها متطابقة لحالة عدم التطابق بأي شكل (رقم
    // مش موجود، أو آخر 6 أرقام غلط) — عشان محدش يقدر يتأكد هل رقم موجود
    // في النظام من غير ما يعرف آخر 6 أرقام صح.
    throw new PhoneVerificationError("IDENTITY_MISMATCH", "البيانات دي مش متطابقة مع أي حساب عندنا.");
  }

  const ipKey = input.ip ? `phoneotp-ip:${input.ip}` : null;
  let ipState: IpState | null = null;
  if (ipKey) {
    ipState = await getConfigRow<IpState>(client, ipKey);
    if (!ipState || ipState.day !== today) ipState = { day: today, count: 0 };
    if (ipState.count >= OTP_MAX_SENDS_PER_IP_PER_DAY) {
      throw new PhoneVerificationError("IP_LIMIT", "تم تجاوز الحد اليومي للطلبات. جرّب بكرة.");
    }
  }

  const key = `phoneotp:${phone}`;
  const prev = await getConfigRow<OtpState>(client, key);
  const sameDay = prev && prev.day === today;

  if (prev) {
    const waitMs = prev.lastSentAt + OTP_RESEND_COOLDOWN_MS - now;
    if (waitMs > 0) {
      const secs = Math.ceil(waitMs / 1000);
      throw new PhoneVerificationError("COOLDOWN", `استنى ${secs} ثانية قبل طلب كود جديد.`, secs);
    }
    if (sameDay && prev.sentToday >= OTP_MAX_SENDS_PER_DAY) {
      throw new PhoneVerificationError("DAILY_LIMIT", "وصلت للحد الأقصى من الرسائل النهارده لهذا الرقم. جرّب بكرة.");
    }
  }

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const next: OtpState = {
    codeHash: hashCode(phone, code),
    expiresAt: now + OTP_TTL_MS,
    attempts: 0,
    lastSentAt: now,
    day: today,
    sentToday: (sameDay ? prev!.sentToday : 0) + 1,
  };

  await putConfigRow(client, key, next);
  if (ipKey && ipState) await putConfigRow(client, ipKey, { ...ipState, count: ipState.count + 1 });

  try {
    await sender(phone, `كود استعادة كلمة السر في WTS Pay هو: ${code}\nصالح لمدة 5 دقائق. لا تشاركه مع أي شخص.`);
  } catch (err) {
    if (prev) await putConfigRow(client, key, prev);
    else await putConfigRow(client, key, { ...next, codeHash: null, sentToday: 0, lastSentAt: 0 });
    if (ipKey && ipState) await putConfigRow(client, ipKey, ipState);
    if (err instanceof SmsSendError) {
      throw new PhoneVerificationError("SMS_UNAVAILABLE", "مش قادرين نبعت الرسالة دلوقتي. جرّب بعد شوية.");
    }
    throw err;
  }

  return { ok: true, phone, expiresInSeconds: OTP_TTL_MS / 1000, resendAfterSeconds: OTP_RESEND_COOLDOWN_MS / 1000 };
}

// مفتاح JWT منفصل بالـ purpose "password-reset" — مش نفس phoneToken بتاع
// التسجيل، عشان التوكنين مايتبادلوش استخدام مع بعض.
export function issueResetToken(phone: string): string {
  return jwt.sign({ purpose: "password-reset", phone }, phoneTokenSecret(), { expiresIn: PHONE_TOKEN_TTL_SECONDS });
}

export function assertResetToken(token: string | undefined, phone: string) {
  const fail = () => new PhoneVerificationError("PHONE_NOT_VERIFIED", "لازم تتحقق من الرقم وآخر 6 أرقام من البطاقة الأول.");
  if (!token) throw fail();
  let payload: any;
  try {
    payload = jwt.verify(token, phoneTokenSecret());
  } catch {
    throw fail();
  }
  const normalized = phone.replace(/[\s\-()]/g, "");
  if (payload?.purpose !== "password-reset" || payload?.phone !== normalized) throw fail();
}

export async function verifyPhoneCode(db: Db, input: { phone: string; code: string; now?: number }) {
  const client: any = db;
  const now = input.now ?? Date.now();
  const phone = normalizeInternationalPhone(input.phone);
  const key = `phoneotp:${phone}`;

  const state = await getConfigRow<OtpState>(client, key);
  if (!state || !state.codeHash) {
    throw new PhoneVerificationError("NO_CODE", "مفيش كود فعّال. اطلب كود جديد.");
  }
  if (now > state.expiresAt) {
    await putConfigRow(client, key, { ...state, codeHash: null });
    throw new PhoneVerificationError("CODE_EXPIRED", "الكود انتهت صلاحيته. اطلب كود جديد.");
  }
  if (state.attempts >= OTP_MAX_ATTEMPTS) {
    await putConfigRow(client, key, { ...state, codeHash: null });
    throw new PhoneVerificationError("TOO_MANY_ATTEMPTS", "محاولات كتير غلط. اطلب كود جديد.");
  }

  if (!safeEqualHex(state.codeHash, hashCode(phone, input.code))) {
    const attempts = state.attempts + 1;
    const exhausted = attempts >= OTP_MAX_ATTEMPTS;
    await putConfigRow(client, key, { ...state, attempts, codeHash: exhausted ? null : state.codeHash });
    throw new PhoneVerificationError(
      exhausted ? "TOO_MANY_ATTEMPTS" : "INVALID_CODE",
      exhausted ? "محاولات كتير غلط. اطلب كود جديد." : `الكود غلط. باقي ${OTP_MAX_ATTEMPTS - attempts} محاولات.`
    );
  }

  // نجاح: الكود يتحرق (استخدام مرة واحدة) مع الحفاظ على عدّادات الإرسال اليومية
  await putConfigRow(client, key, { ...state, codeHash: null });

  const phoneToken = jwt.sign({ purpose: "phone-verify", phone }, phoneTokenSecret(), {
    expiresIn: PHONE_TOKEN_TTL_SECONDS,
  });
  return { phoneToken, phone, expiresInSeconds: PHONE_TOKEN_TTL_SECONDS };
}

// بيستدعيه /api/auth/register: التوكن لازم يكون صالح وخاص بنفس الرقم بالظبط
export function assertPhoneToken(token: string | undefined, phone: string) {
  const fail = () =>
    new PhoneVerificationError("PHONE_NOT_VERIFIED", "لازم تتحقق من رقم الموبايل برسالة SMS قبل التسجيل.");
  if (!token) throw fail();
  let payload: any;
  try {
    payload = jwt.verify(token, phoneTokenSecret());
  } catch {
    throw fail();
  }
  const normalized = phone.replace(/[\s\-()]/g, "");
  if (payload?.purpose !== "phone-verify" || payload?.phone !== normalized) throw fail();
}
