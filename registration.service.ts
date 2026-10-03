// ---------------------------------------------------------------------------
// WhatsApp-first registration & admin verification lifecycle.
// Identity rule: the stable WhatsApp identity (waId from the official Cloud API
// webhook) + the internal WTS user ID are the only identities. The WhatsApp
// display name is NEVER used as an account identifier.
//
// MEDIA POLICY: ID photos and face videos stay in WhatsApp. We persist metadata
// only (idSubmitted, faceVideoSubmitted, timestamps, status). Nothing is
// downloaded, copied, or archived into the WTS database/Supabase Storage.
// ---------------------------------------------------------------------------
import crypto from "crypto";
import type { Db } from "../utils/prisma.js";
import { logAudit } from "./audit.service.js";
import { getConfigJson } from "./config.service.js";
import { generateTxReference } from "./wallet.service.js";
import { config } from "../config.js";
import { matchGovernorate } from "./governorates.js";
import { type Lang, tr } from "../i18n/lang.js";

export type RegDetailsErrorCode = "INVALID_GENDER" | "INVALID_GOVERNORATE" | "INVALID_NATIONAL_ID" | "DUPLICATE_NATIONAL_ID";

export class RegDetailsError extends Error {
  code: RegDetailsErrorCode;
  constructor(code: RegDetailsErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

// One-way HMAC hash of the national ID (never the plain number, never
// reversible). Used only to block the same ID card registering twice.
function hashNationalId(digits: string): string {
  return crypto.createHmac("sha256", config.encryptionKey).update(`national-id:${digits}`).digest("hex");
}

export function validateGender(raw: string, lang: Lang = "ar"): { ok: true; value: "male" | "female" } | { ok: false; error: string } {
  const v = raw.trim().toLowerCase();
  if (v === "male" || v === "ذكر" || v === "m") return { ok: true, value: "male" };
  if (v === "female" || v === "أنثى" || v === "f") return { ok: true, value: "female" };
  return { ok: false, error: tr(lang, "اختار النوع من الزرارين.", "Please choose a gender from the buttons.") };
}

export function validateGovernorateInput(raw: string, lang: Lang = "ar"): { ok: true; code: string } | { ok: false; error: string } {
  const g = matchGovernorate(raw);
  if (!g) return { ok: false, error: tr(lang, "اختار رقم المحافظة من القائمة اللي فوق.", "Please choose a governorate number from the list above.") };
  return { ok: true, code: g.code };
}

// Egyptian national ID: exactly 14 digits, first digit is the century marker (2 or 3).
export function validateNationalId(raw: string, lang: Lang = "ar"): { ok: true; digits: string } | { ok: false; error: string } {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 14 || !/^[23]/.test(digits)) {
    return { ok: false, error: tr(lang, "الرقم القومي لازم يكون 14 رقم زي ما هو في البطاقة.", "The national ID must be exactly 14 digits, as printed on the card.") };
  }
  return { ok: true, digits };
}

export async function recordGender(db: Db, userId: string, gender: "male" | "female") {
  return (db as any).user.update({ where: { id: userId }, data: { gender } });
}

export async function recordGovernorate(db: Db, userId: string, governorate: string) {
  return (db as any).user.update({ where: { id: userId }, data: { governorate } });
}

// Hashes + checks uniqueness (prevents the same ID card registering twice)
// before saving. Throws RegDetailsError("DUPLICATE_NATIONAL_ID", ...) if the
// hash already belongs to a different user.
export async function recordNationalId(db: Db, userId: string, digits: string, lang: Lang = "ar") {
  const client: any = db;
  const hash = hashNationalId(digits);
  const existing = await client.user.findUnique({ where: { nationalIdEnc: hash } });
  if (existing && existing.id !== userId) {
    throw new RegDetailsError(
      "DUPLICATE_NATIONAL_ID",
      tr(lang, "الرقم القومي ده متسجّل بحساب تاني بالفعل. تواصل مع الدعم لو فاكر إن ده غلط.", "This national ID is already registered to another account. Contact support if you believe this is a mistake.")
    );
  }
  return client.user.update({
    where: { id: userId },
    data: { nationalIdEnc: hash, nationalIdLast6: digits.slice(-6) },
  });
}

// Four-part legal name validation, e.g. "Ahmed Mohamed Ali Hassan"
export function validateFourPartName(raw: string, lang: Lang = "ar"): { ok: boolean; fullName?: string; error?: string } {
  const cleaned = raw.trim().replace(/\s+/g, " ");
  const parts = cleaned.split(" ");
  if (parts.length !== 4) {
    return {
      ok: false,
      error: tr(
        lang,
        `من فضلك اكتب اسمك الرباعي بالكامل زي ما هو مكتوب في البطاقة (انت كتبت ${parts.length} كلمة بس). مثال: أحمد محمد علي حسن`,
        `Please enter your full four-part legal name exactly as on your ID (you entered ${parts.length} part(s)). Example: Ahmed Mohamed Ali Hassan`
      ),
    };
  }
  if (!parts.every((p) => /^[\p{L}.'-]{2,}$/u.test(p))) {
    return {
      ok: false,
      error: tr(lang, "كل جزء من الاسم لازم يكون حروف بس (ممكن نقطة أو فاصلة علوية أو شرطة).", "Name parts may only contain letters, dots, apostrophes or hyphens."),
    };
  }
  return { ok: true, fullName: cleaned };
}

// Normalize international phone to digits-with-plus form; wa_id from Meta is
// digits only (country code + number).
export function normalizeWaPhone(fromDigits: string): string {
  return "+" + fromDigits.replace(/\D/g, "");
}

// Find a user by authoritative WhatsApp identity, then phone fallback.
export async function findByWhatsAppIdentity(db: Db, waId: string, phoneDigits: string) {
  const client: any = db;
  const byWa = await client.user.findUnique({ where: { waId } });
  if (byWa) return byWa;
  return client.user.findUnique({ where: { phone: normalizeWaPhone(phoneDigits) } });
}

// Create the pre-verification record on "Create Account".
export async function createRegistration(
  db: Db,
  input: { waId: string; phoneDigits: string; profileName?: string; language?: Lang }
) {
  const client: any = db;
  const phone = normalizeWaPhone(input.phoneDigits);
  const existing = await findByWhatsAppIdentity(client, input.waId, input.phoneDigits);
  if (existing) return existing;
  // The WhatsApp profile name is stored only as a display hint, never as identity.
  return client.user.create({
    data: {
      phone,
      username: (input.profileName ?? "WTS User").slice(0, 50),
      passwordHash: "!", // not used - WhatsApp identity is the login
      referralCode: `WTS-${input.phoneDigits.slice(-6)}`,
      waId: input.waId,
      whatsappPhone: phone,
      verificationStatus: "UNVERIFIED",
      demoBalance: 0,
      language: input.language ?? "ar",
    },
  });
}

export async function recordFullName(db: Db, userId: string, fullName: string) {
  return (db as any).user.update({ where: { id: userId }, data: { fullName } });
}

// ID front/back received: metadata only. Media stays in WhatsApp.
export async function recordIdSubmitted(db: Db, userId: string) {
  return (db as any).user.update({
    where: { id: userId },
    data: { idSubmitted: true, idReceivedAt: new Date() },
  });
}

export async function recordFaceVideoSubmitted(db: Db, userId: string) {
  return (db as any).user.update({
    where: { id: userId },
    data: { faceVideoSubmitted: true, faceVideoReceivedAt: new Date(), verificationStatus: "PENDING_REVIEW" },
  });
}

// Atomically issue the next WTS-###### / WALLET-###### pair from config counters.
export async function issueWtsIdentity(tx: any): Promise<{ wtsId: string; walletId: string }> {
  const row = await tx.config.findUnique({ where: { key: "counters" } });
  const counters = (row?.value ?? { wtsSeq: 0, walletSeq: 0 }) as { wtsSeq: number; walletSeq: number };
  const wtsSeq = (counters.wtsSeq ?? 0) + 1;
  const walletSeq = (counters.walletSeq ?? 0) + 1;
  await tx.config.upsert({
    where: { key: "counters" },
    update: { value: { wtsSeq, walletSeq } },
    create: { key: "counters", value: { wtsSeq, walletSeq } },
  });
  const pad = (n: number) => String(n).padStart(6, "0");
  return { wtsId: `WTS-${pad(wtsSeq)}`, walletId: `WALLET-${pad(walletSeq)}` };
}

// Admin approval: creates the verified user identity + wallet + initial balance
// atomically inside one DB transaction.
export async function approveRegistration(
  db: Db,
  input: { adminId: string; userId: string; ip?: string; initialBalance?: number }
) {
  const client: any = db;
  return client.$transaction(async (tx: any) => {
    const user = await tx.user.findUnique({ where: { id: input.userId } });
    if (!user) throw new Error("Registration not found.");
    if (user.verificationStatus === "VERIFIED") return user; // idempotent approve

    const { wtsId, walletId } = await issueWtsIdentity(tx);
    const approvalCfg = await getConfigJson(tx, "approval");
    const initial = input.initialBalance ?? (approvalCfg?.initialBalance as number) ?? 0;

    let balance = user.demoBalance;
    if (initial > 0) {
      await tx.user.update({ where: { id: user.id }, data: { demoBalance: { increment: initial } } });
      await tx.transaction.create({
        data: {
          reference: generateTxReference(),
          receiverId: user.id,
          amount: initial,
          fee: 0,
          totalDebit: initial,
          type: "SIGNUP_REWARD",
          idempotencyKey: `approval:${user.id}`,
          description: "Initial balance at approval",
          status: "COMPLETED",
        },
      });
      balance += initial;
    }

    const updated = await tx.user.update({
      where: { id: user.id },
      data: {
        verificationStatus: "VERIFIED",
        wtsId,
        walletId,
        reviewedAt: new Date(),
        reviewedById: input.adminId,
        transfersEnabled: true,
      },
    });

    await logAudit(tx, {
      adminId: input.adminId,
      userId: user.id,
      action: "USER_APPROVED",
      ip: input.ip,
      detail: { wtsId, walletId, initialBalance: initial, fullName: user.fullName, waId: user.waId },
    });
    return { ...updated, demoBalance: balance };
  });
}

export async function rejectRegistration(
  db: Db,
  input: { adminId: string; userId: string; reason: string; ip?: string }
) {
  const client: any = db;
  const updated = await client.user.update({
    where: { id: input.userId },
    data: {
      verificationStatus: "REJECTED",
      rejectionReason: input.reason,
      reviewedAt: new Date(),
      reviewedById: input.adminId,
    },
  });
  await logAudit(client, {
    adminId: input.adminId,
    userId: input.userId,
    action: "USER_REJECTED",
    ip: input.ip,
    detail: { reason: input.reason },
  });
  return updated;
}

export async function pendingVerifications(db: Db) {
  const client: any = db;
  return client.user.findMany({
    where: { verificationStatus: "PENDING_REVIEW" },
    select: {
      id: true, fullName: true, whatsappPhone: true, waId: true, wtsId: true,
      idSubmitted: true, idReceivedAt: true, faceVideoSubmitted: true,
      faceVideoReceivedAt: true, createdAt: true,
      gender: true, governorate: true, nationalIdLast6: true,
    },
    orderBy: { createdAt: "asc" },
  });
}
