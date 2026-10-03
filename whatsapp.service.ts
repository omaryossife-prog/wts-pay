// ---------------------------------------------------------------------------
// WhatsApp conversation logic. All money movement goes through the SAME
// wallet/fee/authorization services used by the website. WhatsApp identity
// (waId) identifies the account; the WTS PIN authorizes transactions.
//
// MEDIA POLICY: ID photos and face videos are never downloaded or stored.
// We only record metadata. Admins review media inside WhatsApp.
//
// LANGUAGE: every exported function that returns user-facing text takes a
// `lang` parameter ("ar" | "en"). Callers (whatsapp.handler.ts) pass the
// user's stored language (user.language, default "ar"). See ../i18n/lang.ts.
// ---------------------------------------------------------------------------
import { prisma } from "../utils/prisma.js";
import { computeFee } from "../services/fee.service.js";
import { getLimitsConfig, getMaintenanceConfig } from "../services/config.service.js";
import { evaluateReferralEligibility } from "../services/referral.service.js";
import { getFraudWarning } from "../services/wallet.service.js";
import {
  createTransferAuthorization,
  executeAuthorizedTransfer,
  cancelAuthorization,
} from "../services/txauth.service.js";
import { verifyPin, setPin, PinError } from "../services/pin.service.js";
import {
  createTransferRequest, listIncomingRequests, rejectTransferRequest,
  acceptTransferRequest, TransferRequestError,
} from "../services/transferRequest.service.js";
import type { WaListSectionRow } from "./whatsapp.templates.js";
import {
  validateFourPartName, findByWhatsAppIdentity, createRegistration, recordFullName,
  recordIdSubmitted, recordFaceVideoSubmitted, normalizeWaPhone,
  validateGender, validateGovernorateInput, validateNationalId,
  recordGender, recordGovernorate, recordNationalId, RegDetailsError,
} from "../services/registration.service.js";
import { sendPhoneCode, verifyPhoneCode, PhoneVerificationError } from "../services/phoneVerification.service.js";
import { governoratesNumberedList } from "../services/governorates.js";
import { logger } from "../utils/logger.js";
import type { Db } from "../utils/prisma.js";
import { type Lang, tr, normalizeLang } from "../i18n/lang.js";

export const SESSION_TTL_MS = 10 * 60 * 1000;

export const SessionState = {
  IDLE: "IDLE",
  // registration
  REG_NAME: "REG_NAME",
  REG_PHONE_OTP: "REG_PHONE_OTP",
  // Registration-details (gender/governorate/national ID): the Flow is
  // primary (WHATSAPP_REG_DETAILS_FLOW_ID); REG_GENDER/REG_GOVERNORATE/
  // REG_NATIONAL_ID are the documented chat fallback when it isn't configured.
  REG_DETAILS_FLOW: "REG_DETAILS_FLOW",
  REG_GENDER: "REG_GENDER",
  REG_GOVERNORATE: "REG_GOVERNORATE",
  REG_NATIONAL_ID: "REG_NATIONAL_ID",
  REG_ID_FRONT: "REG_ID_FRONT",
  REG_ID_BACK: "REG_ID_BACK",
  REG_FACE_VIDEO: "REG_FACE_VIDEO",
  // PIN setup (fallback when Flow not configured)
  PIN_CREATE: "PIN_CREATE",
  PIN_CONFIRM: "PIN_CONFIRM",
  // send money with authorization
  SEND_WAIT_PHONE: "SEND_WAIT_PHONE",
  SEND_WAIT_AMOUNT: "SEND_WAIT_AMOUNT",
  SEND_ESCROW_CHOICE: "SEND_ESCROW_CHOICE",
  SEND_CONFIRMATION: "SEND_CONFIRMATION",
  SEND_PIN: "SEND_PIN",
  // money requests (ask someone to pay you)
  REQ_WAIT_PHONE: "REQ_WAIT_PHONE",
  REQ_WAIT_AMOUNT: "REQ_WAIT_AMOUNT",
  REQ_PIN: "REQ_PIN",
} as const;
export type SessionState = (typeof SessionState)[keyof typeof SessionState];

interface WaSessionData {
  recipientId?: string;
  recipientPhone?: string;
  recipientWtsId?: string;
  recipientName?: string;
  amount?: number;
  fee?: number;
  totalDebit?: number;
  authorizationId?: string;
  escrowEnabled?: boolean;
  pendingRequestId?: string; // for accepting a specific money request via PIN
  pendingPin?: string; // fallback setup only, never persisted beyond setup
}

export async function getUserByWaIdentity(db: Db, waId: string, phoneDigits: string) {
  return findByWhatsAppIdentity(db, waId, phoneDigits);
}

export async function getUserLanguage(userId: string): Promise<Lang> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { language: true } });
  return normalizeLang(user?.language);
}

export async function setUserLanguage(userId: string, lang: Lang): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { language: lang } });
}

export async function getSession(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { whatsappSessionState: true, whatsappSessionData: true, whatsappSessionExpiresAt: true },
  });
  if (!user) return { state: SessionState.IDLE as SessionState, data: {} as WaSessionData };
  if (user.whatsappSessionExpiresAt && user.whatsappSessionExpiresAt < new Date()) {
    return { state: SessionState.IDLE as SessionState, data: {} as WaSessionData };
  }
  return {
    state: (user.whatsappSessionState as SessionState) ?? SessionState.IDLE,
    data: (user.whatsappSessionData as WaSessionData) ?? {},
  };
}

export async function setSession(userId: string, state: SessionState, data: WaSessionData = {}) {
  await prisma.user.update({
    where: { id: userId },
    data: {
      whatsappSessionState: state,
      whatsappSessionData: data,
      whatsappSessionExpiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
}

export async function maintenanceActive(): Promise<{ enabled: boolean; message: string }> {
  const m = await getMaintenanceConfig(prisma);
  return m;
}

// ---------------- Registration steps ----------------

export async function startRegistration(waId: string, phoneDigits: string, profileName?: string, lang: Lang = "ar") {
  const user = await createRegistration(prisma, { waId, phoneDigits, profileName, language: lang });
  await setSession(user.id, SessionState.REG_NAME, {});
  return tr(
    lang,
    "رقم الواتساب بتاعك مش مسجّل في WTS Pay.\nعايز تعمل حساب جديد؟",
    "Your WhatsApp account is not registered with WTS Pay.\nWould you like to create a new account?"
  );
}

export async function handleNameInput(userId: string, raw: string, lang: Lang = "ar"): Promise<{ text: string; ok: boolean }> {
  const v = validateFourPartName(raw, lang);
  if (!v.ok || !v.fullName) return { text: v.error ?? tr(lang, "الاسم غير صحيح.", "Invalid name."), ok: false };
  await recordFullName(prisma, userId, v.fullName);
  // بعد الاسم مباشرة: تحقّق من رقم الواتساب نفسه برسالة SMS — ده اللي
  // بيثبت فعلًا إن الشريحة الفعلية معاه (مش مجرد جلسة واتساب مفتوحة على
  // رقم قديم/مزيّف)، بخلاف سؤال "ده رقمك؟" اللي كان بيتجاوب بـ "آه" بس.
  const sent = await sendRegistrationOtp(userId, lang);
  return { text: sent.text, ok: true };
}

// بيبعت كود SMS لرقم المستخدم (نفس نظام SMSGate المستخدم في تسجيل الموقع)
// ويضبط الجلسة على استنى الكود. مُصدَّرة لوحدها عشان تُستخدم من "إعادة الإرسال" والبدء المباشر.
export async function sendRegistrationOtp(userId: string, lang: Lang): Promise<{ text: string }> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { whatsappPhone: true } });
  const phone = user?.whatsappPhone ?? "";
  try {
    await sendPhoneCode(prisma, { phone, allowUserId: userId });
    await setSession(userId, SessionState.REG_PHONE_OTP, {});
    return {
      text: tr(
        lang,
        `\u{1F4F2} بعتنا كود تحقّق من 6 أرقام برسالة SMS لرقم ${phone}.\nاكتب الكود هنا. لو مجاش، اكتب *إعادة إرسال* بعد شوية.`,
        `\u{1F4F2} We sent a 6-digit verification code by SMS to ${phone}.\nType the code here. If it doesn't arrive, type *resend* after a bit.`
      ),
    };
  } catch (err: any) {
    if (err instanceof PhoneVerificationError && err.code === "COOLDOWN") {
      await setSession(userId, SessionState.REG_PHONE_OTP, {});
      return { text: tr(lang, `استنى ${err.retryAfterSeconds ?? 45} ثانية وبعدين اكتب *إعادة إرسال*.`, `Wait ${err.retryAfterSeconds ?? 45} seconds, then type *resend*.`) };
    }
    await setSession(userId, SessionState.REG_PHONE_OTP, {});
    return {
      text: tr(
        lang,
        "معرفناش نبعت كود التحقّق دلوقتي. اكتب *إعادة إرسال* عشان نحاول تاني.",
        "We couldn't send the verification code right now. Type *resend* to try again."
      ),
    };
  }
}

export async function handleRegistrationOtpResend(userId: string, lang: Lang = "ar"): Promise<string> {
  const r = await sendRegistrationOtp(userId, lang);
  return r.text;
}

export async function handleRegistrationOtpInput(userId: string, raw: string, lang: Lang = "ar"): Promise<{ text: string; ok: boolean }> {
  const code = raw.trim();
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { whatsappPhone: true } });
  const phone = user?.whatsappPhone ?? "";
  try {
    await verifyPhoneCode(prisma, { phone, code });
  } catch (err: any) {
    const msg = err instanceof PhoneVerificationError ? err.message : tr(lang, "الكود غلط.", "Incorrect code.");
    return { text: msg, ok: false };
  }
  // اتحقّق من الرقم فعليًا. دلوقتي نبدأ فلو البيانات (الاسم/الجنس/المحافظة/الرقم القومي).
  const { sendRegDetailsFlow } = await import("./whatsapp.flows.js");
  const u2 = await prisma.user.findUnique({ where: { id: userId }, select: { whatsappPhone: true } });
  const sentFlow = await sendRegDetailsFlow(u2?.whatsappPhone ?? phone, userId).catch(() => false);
  if (sentFlow) {
    await setSession(userId, SessionState.REG_DETAILS_FLOW, {});
    return {
      text: tr(lang, "✅ اتأكد رقمك. كمّل بياناتك في الفورم اللي فوق (الاسم، الجنس، المحافظة، الرقم القومي).", "✅ Number verified. Fill in your details in the form above (name, gender, governorate, national ID)."),
      ok: true,
    };
  }
  // Fallback: لو الفلو مش متظبط — نطلب الاسم في الشات
  await setSession(userId, SessionState.REG_NAME, {});
  return {
    text: tr(lang, "✅ اتأكد رقمك.\n\n" + "اكتب اسمك الرباعي بالكامل زي ما هو في البطاقة.\nمثال: أحمد محمد علي حسن", "✅ Number verified.\n\nEnter your full four-part name exactly as on your ID.\nExample: Ahmed Mohamed Ali Hassan"),
    ok: true,
  };
}

function genderPromptText(lang: Lang): string {
  return tr(lang, "النوع؟", "Gender?");
}

export async function handleGenderButton(userId: string, choice: "male" | "female", lang: Lang = "ar"): Promise<string> {
  await recordGender(prisma, userId, choice);
  await setSession(userId, SessionState.REG_GOVERNORATE, {});
  return tr(
    lang,
    `اختار محافظتك — اكتب الرقم:\n\n${governoratesNumberedList(lang)}`,
    `Choose your governorate — type the number:\n\n${governoratesNumberedList(lang)}`
  );
}

export async function handleGovernorateInput(userId: string, raw: string, lang: Lang = "ar"): Promise<{ text: string; ok: boolean }> {
  const v = validateGovernorateInput(raw, lang);
  if (!v.ok) return { text: v.error, ok: false };
  await recordGovernorate(prisma, userId, v.code);
  await setSession(userId, SessionState.REG_NATIONAL_ID, {});
  return { text: tr(lang, "اكتب الرقم القومي (14 رقم) زي ما هو في البطاقة.", "Enter your national ID number (14 digits) as printed on your ID."), ok: true };
}

export async function handleNationalIdInput(userId: string, raw: string, lang: Lang = "ar"): Promise<{ text: string; ok: boolean }> {
  const v = validateNationalId(raw, lang);
  if (!v.ok) return { text: v.error, ok: false };
  try {
    await recordNationalId(prisma, userId, v.digits, lang);
  } catch (err: any) {
    const msg = err instanceof RegDetailsError ? err.message : tr(lang, "معرفناش نسجّل الرقم القومي.", "Could not save the national ID.");
    return { text: msg, ok: false };
  }
  await setSession(userId, SessionState.REG_ID_FRONT, {});
  return { text: tr(lang, "\u{1F4CE} من فضلك ابعت صورة واضحة لوش البطاقة الشخصية.", "\u{1F4CE} Please send a clear photo of the front of your ID card."), ok: true };
}

// ID front/back and face video: metadata only. We intentionally never fetch or
// store the media (acceptance criterion 7).
export async function handleIdFront(userId: string, lang: Lang = "ar"): Promise<string> {
  await recordIdSubmitted(prisma, userId);
  await setSession(userId, SessionState.REG_ID_BACK, {});
  return tr(lang, "تم استلام وش البطاقة.\nدلوقتي ابعت صورة واضحة لضهر البطاقة الشخصية.", "ID front received.\nNow send a clear photo of the back of your ID card.");
}

export async function handleIdBack(userId: string, lang: Lang = "ar"): Promise<string> {
  await setSession(userId, SessionState.REG_FACE_VIDEO, {});
  return tr(
    lang,
    "\u{1F3A5} آخر خطوة في التحقق.\n" +
      "ابعت فيديو قصير لوشك، حوالي 5-10 ثواني.\n" +
      "خلي وشك واضح والإضاءة كويسة.",
    "\u{1F3A5} Final verification step.\n" +
      "Please send a short video of your face, around 5\u201310 seconds.\n" +
      "Make sure your face is clearly visible and the lighting is good."
  );
}

export async function handleFaceVideo(userId: string, lang: Lang = "ar"): Promise<string> {
  await recordFaceVideoSubmitted(prisma, userId);
  await setSession(userId, SessionState.IDLE, {});
  return tr(
    lang,
    "تم إرسال طلب التسجيل بتاعك للمراجعة. \u2705\nمن فضلك استنى الموافقة. هنبلّغك هنا.",
    "Your registration has been submitted for review. \u2705\nPlease wait for approval. You will be notified here."
  );
}

// ---------------- PIN setup ----------------

export async function handlePinCreateInput(userId: string, raw: string, lang: Lang = "ar"): Promise<{ text: string; ok: boolean }> {
  const pin = raw.trim();
  if (!/^\d{6}$/.test(pin)) {
    return { text: tr(lang, "الرقم السري لازم يكون 6 أرقام بالظبط. جرّب تاني.", "The PIN must be exactly 6 digits. Try again."), ok: false };
  }
  await setSession(userId, SessionState.PIN_CONFIRM, { pendingPin: pin });
  return { text: tr(lang, "أكّد الرقم السري بكتابة نفس الـ 6 أرقام تاني.", "Confirm your PIN by entering the same 6 digits again."), ok: true };
}

export async function handlePinConfirmInput(userId: string, raw: string, lang: Lang = "ar"): Promise<{ text: string; ok: boolean }> {
  const session = await getSession(userId);
  if (!session.data.pendingPin) {
    await setSession(userId, SessionState.PIN_CREATE, {});
    return { text: tr(lang, "نبدأ من الأول. اعمل رقم سري من 6 أرقام:", "Let's start over. Create your 6-digit WTS PIN:"), ok: false };
  }
  if (raw.trim() !== session.data.pendingPin) {
    await setSession(userId, SessionState.PIN_CREATE, {});
    return { text: tr(lang, "الرقمين مش متطابقين. اعمل الرقم السري من 6 أرقام تاني:", "PINs did not match. Create your 6-digit WTS PIN again:"), ok: false };
  }
  await setPin(prisma, { userId, pin: session.data.pendingPin, lang });
  await setSession(userId, SessionState.IDLE, {});
  return { text: tr(lang, "\u{1F512} الرقم السري اتسجّل. محفظتك بقت شغالة بالكامل. اكتب *menu*.", "\u{1F512} Your WTS transaction PIN is set. Your wallet is fully active. Type *menu*."), ok: true };
}

// Called by the WhatsApp Flow data-exchange endpoint when a Flow-based PIN
// entry completes (preferred, no chat fallback needed).
export async function completePinFromFlow(userId: string, pin: string) {
  await setPin(prisma, { userId, pin });
  await setSession(userId, SessionState.IDLE, {});
}

// ---------------- Menu actions ----------------

export async function getBalanceText(userId: string, lang: Lang = "ar"): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { demoBalance: true, status: true, wtsId: true, walletId: true },
  });
  if (!user) return tr(lang, "الحساب مش موجود.", "Account not found.");
  if (user.status !== "ACTIVE") return tr(lang, "حسابك مجمّد. تواصل مع الدعم.", "Your account is frozen. Contact support.");
  return tr(
    lang,
    `كود WTS: ${user.wtsId ?? "قيد الإصدار"}\n` +
      `رصيدك التجريبي ${user.demoBalance} جنيه.\n` +
      `_(الأرصدة التجريبية مالهاش قيمة نقدية ومتسحبش.)_`,
    `WTS ID: ${user.wtsId ?? "pending"}\n` +
      `Your demo balance is ${user.demoBalance} EGP.\n` +
      `_(Demo credits have no cash value and cannot be withdrawn.)_`
  );
}

export async function getTransactionsText(userId: string, lang: Lang = "ar"): Promise<string> {
  const txs = await prisma.transaction.findMany({
    where: { OR: [{ senderId: userId }, { receiverId: userId }] },
    orderBy: { createdAt: "desc" },
    take: 10,
    include: { sender: { select: { phone: true } }, receiver: { select: { phone: true } } },
  });
  if (txs.length === 0) return tr(lang, "لسه مفيش عمليات.", "No transactions yet.");
  const lines = txs.map((t) => {
    const dir = t.senderId === userId ? tr(lang, "اتبعت", "sent") : tr(lang, "اتستلم", "received");
    const other = t.senderId === userId ? t.receiver?.phone ?? "?" : t.sender?.phone ?? "?";
    return tr(lang, `\u2022 ${t.amount} جنيه ${dir} (مع ${other}) ${t.type.toLowerCase()}`, `\u2022 ${t.amount} EGP ${dir} (with ${other}) ${t.type.toLowerCase()}`);
  });
  return tr(lang, "آخر العمليات:\n", "Recent transactions:\n") + lines.join("\n");
}

export async function getReferralText(userId: string, lang: Lang = "ar"): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { referralCode: true, referralCount: true } });
  const rewarded = await prisma.referral.count({ where: { referrerId: userId, status: "REWARDED" } });
  if (!user) return tr(lang, "الحساب مش موجود.", "Account not found.");
  return tr(
    lang,
    `كود الإحالة بتاعك: *${user.referralCode}*\n` +
      `شاركه مع أصحابك! بعد ما يسجّلوا ويتحقق حسابهم ويعملوا أول تحويل، هتاخد مكافأة الإحالة.\n\n` +
      `المدعوين: ${user.referralCount} \u2022 اللي اتكافأوا: ${rewarded}\n` +
      `_(المكافآت بتتصرف بعد فحوصات مكافحة الاحتيال بس.)_`,
    `Your referral code: *${user.referralCode}*\n` +
      `Share it with friends! After they sign up, get verified and complete their first transfer, you earn the referral reward.\n\n` +
      `Invited: ${user.referralCount} \u2022 Rewarded: ${rewarded}\n` +
      `_(Referrals are only rewarded after anti-abuse checks.)_`
  );
}

export async function getAccountText(userId: string, lang: Lang = "ar"): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { username: true, phone: true, fullName: true, wtsId: true, walletId: true, demoBalance: true, status: true, transfersEnabled: true, verificationStatus: true, createdAt: true },
  });
  if (!user) return tr(lang, "الحساب مش موجود.", "Account not found.");
  return tr(
    lang,
    `*حسابي*\n` +
      `الاسم الكامل: ${user.fullName ?? "-"}\nكود WTS: ${user.wtsId ?? "-"}\nالمحفظة: ${user.walletId ?? "-"}\n` +
      `الموبايل: ${user.phone}\nالحالة: ${user.status}\nالتحقق: ${user.verificationStatus}\n` +
      `التحويلات: ${user.transfersEnabled ? "مفعّلة" : "متوقفة"}\n` +
      `الرصيد التجريبي: ${user.demoBalance} جنيه\nعضو من: ${user.createdAt.toDateString()}\n\n` +
      `_اكتب "اللغة" في أي وقت عشان تغيّر لغة المحادثة._`,
    `*My Account*\n` +
      `Full name: ${user.fullName ?? "-"}\nWTS ID: ${user.wtsId ?? "-"}\nWallet: ${user.walletId ?? "-"}\n` +
      `Phone: ${user.phone}\nStatus: ${user.status}\nVerification: ${user.verificationStatus}\n` +
      `Transfers: ${user.transfersEnabled ? "enabled" : "disabled"}\n` +
      `Demo balance: ${user.demoBalance} EGP\nMember since: ${user.createdAt.toDateString()}\n\n` +
      `_Type "language" any time to change the bot's language._`
  );
}

export function helpText(lang: Lang = "ar"): string {
  return tr(
    lang,
    "*مساعدة WTS Pay* (تجريبي)\n\n" +
      "\u2022 الأرصدة تجريبية - مالهاش قيمة نقدية ومتتسحبش.\n" +
      "\u2022 التحويل: اختار تحويل فلوس، المستلم، المبلغ، أكّد، وبعدين اكتب الرقم السري.\n" +
      "\u2022 العمولة: جنيه واحد لكل 1000 جنيه أو جزء منه.\n" +
      "\u2022 الرقم السري (6 أرقام) بيأمّن التحويلات - متشاركهوش مع حد.\n" +
      "\u2022 الإحالات بتكسبك مكافأة بعد ما اللي دعوته يتحقق ويعمل أول تحويل.\n\n" +
      "الدعم: support@wtspay.demo",
    "*WTS Pay Help* (Demo)\n\n" +
      "\u2022 Balances are DEMO credits - no cash value, no withdrawals.\n" +
      "\u2022 Send: choose Send Money, recipient, amount, confirm, then enter your WTS PIN.\n" +
      "\u2022 Fee: 1 EGP per started 1000 EGP.\n" +
      "\u2022 Your WTS PIN (6 digits) authorizes transfers - never share it.\n" +
      "\u2022 Referrals reward you after your invitee is verified and completes their first transfer.\n\n" +
      "Support: support@wtspay.demo"
  );
}
// Backward-compatible constant (Arabic default) kept for any stray imports.
export const HELP_TEXT = helpText("ar");

// ---------------- Send money with PIN authorization ----------------

export async function beginSendMoney(userId: string, lang: Lang = "ar"): Promise<string> {
  await setSession(userId, SessionState.SEND_WAIT_PHONE, {});
  return tr(lang, "اكتب رقم واتساب المستلم (مع كود الدولة، مثلاً +2010...).", "Please enter the recipient's WTS phone number (with country code, e.g. +2010\u2026).");
}

export async function handlePhoneInput(userId: string, phone: string, lang: Lang = "ar"): Promise<{ text: string; ok: boolean }> {
  const clean = phone.replace(/[\s\-()]/g, "");
  if (!/^\+?[0-9]{8,15}$/.test(clean)) {
    return { text: tr(lang, "ده مش رقم موبايل صحيح. جرّب تاني (مثال: +2010xxxxxxx).", "That doesn't look like a valid phone number. Try again (e.g. +2010xxxxxxx)."), ok: false };
  }
  const recipient = await prisma.user.findUnique({ where: { phone: normalizeWaPhone(clean.replace("+", "")) } });
  if (!recipient) return { text: tr(lang, "مفيش مستخدم WTS بالرقم ده. جرّب تاني أو اكتب *menu*.", "No WTS user found with that phone number. Try again or type *menu*."), ok: false };
  if (recipient.id === userId) return { text: tr(lang, "متقدرش تبعت فلوس لنفسك.", "You cannot send money to yourself."), ok: false };
  if (recipient.status !== "ACTIVE") return { text: tr(lang, "الحساب ده مجمّد.", "That account is frozen."), ok: false };
  if (recipient.verificationStatus !== "VERIFIED") return { text: tr(lang, "الحساب ده لسه مش متحقق منه.", "That account is not verified yet."), ok: false };
  if (recipient.transfersEnabled === false) return { text: tr(lang, "الحساب ده مش بيقدر يستقبل تحويلات دلوقتي.", "That account cannot receive transfers right now."), ok: false };
  await setSession(userId, SessionState.SEND_WAIT_AMOUNT, {
    recipientId: recipient.id,
    recipientPhone: recipient.phone,
    recipientWtsId: recipient.wtsId ?? undefined,
    recipientName: recipient.fullName ?? recipient.username,
  });
  return {
    text: tr(
      lang,
      `بتحوّل لـ *${recipient.fullName ?? recipient.username}* (${recipient.wtsId ?? recipient.phone}).\nاكتب المبلغ بالجنيه:`,
      `Sending to *${recipient.fullName ?? recipient.username}* (${recipient.wtsId ?? recipient.phone}).\nEnter the amount in EGP:`
    ),
    ok: true,
  };
}

export async function handleAmountInput(userId: string, raw: string, lang: Lang = "ar"): Promise<{ text: string; askEscrow: true } | { text: string; ok: false }> {
  const amount = Number(raw.replace(/[^0-9]/g, ""));
  if (!Number.isInteger(amount) || amount <= 0) return { text: tr(lang, "اكتب مبلغ صحيح أكبر من 0، مثلاً 500.", "Enter a whole number amount greater than 0, e.g. 500."), ok: false };
  const limits = await getLimitsConfig(prisma);
  if (amount < limits.minTransfer || amount > limits.maxTransfer) {
    return { text: tr(lang, `المبلغ لازم يكون بين ${limits.minTransfer} و ${limits.maxTransfer} جنيه.`, `Amount must be between ${limits.minTransfer} and ${limits.maxTransfer} EGP.`), ok: false };
  }
  const { fee, totalDebit } = await computeFee(prisma, amount);
  const session = await getSession(userId);
  const warning = await getFraudWarning(prisma, userId, session.data.recipientId ?? "").catch(() => null);
  await setSession(userId, SessionState.SEND_ESCROW_CHOICE, { ...session.data, amount, fee, totalDebit });
  return {
    text:
      (warning ? `${warning}\n\n` : "") +
      tr(
        lang,
        "\u{1F6E1}\uFE0F تفعّل حماية مكافحة الاحتيال للتحويل ده؟\nمفضّل لو بتحوّل لحد مش عارفه كويس — هتقدر تبلّغ عن التحويل لو حسّيت بحاجة غلط.",
        "\u{1F6E1}\uFE0F Enable Anti-Fraud protection for this transfer?\nRecommended for people you don't know well — you'll be able to report this transfer if something feels wrong."
      ),
    askEscrow: true,
  };
}

function buildConfirmationSummary(session: { data: WaSessionData }, lang: Lang): string {
  const { recipientWtsId, recipientPhone, amount, fee, totalDebit, escrowEnabled } = session.data;
  return tr(
    lang,
    `تأكيد التحويل\n` +
      `المستلم:\n${recipientWtsId ?? recipientPhone}\n` +
      `المبلغ:\n${amount!.toLocaleString()} جنيه\n` +
      `العمولة:\n${fee} جنيه\n` +
      `الإجمالي:\n${totalDebit!.toLocaleString()} جنيه` +
      (escrowEnabled ? `\n\u{1F6E1}\uFE0F حماية مكافحة الاحتيال: مفعّلة` : ""),
    `Confirm Transfer\n` +
      `Recipient:\n${recipientWtsId ?? recipientPhone}\n` +
      `Amount:\n${amount!.toLocaleString()} EGP\n` +
      `Fee:\n${fee} EGP\n` +
      `Total:\n${totalDebit!.toLocaleString()} EGP` +
      (escrowEnabled ? `\n\u{1F6E1}\uFE0F Anti-Fraud protection: ON` : "")
  );
}

export async function handleEscrowChoice(userId: string, enabled: boolean, lang: Lang = "ar"): Promise<{ text: string; summary: string }> {
  const session = await getSession(userId);
  await setSession(userId, SessionState.SEND_CONFIRMATION, { ...session.data, escrowEnabled: enabled });
  const summary = buildConfirmationSummary({ data: { ...session.data, escrowEnabled: enabled } }, lang);
  return { text: summary, summary };
}

// Button press "Confirm Transfer" -> create the pending authorization. The
// transfer itself does NOT execute until the PIN is verified.
export async function confirmTransfer(userId: string, lang: Lang = "ar"): Promise<{ text: string; authorizationId?: string }> {
  const session = await getSession(userId);
  const { recipientPhone, amount, escrowEnabled } = session.data;
  if (!recipientPhone || !amount) {
    await setSession(userId, SessionState.IDLE, {});
    return { text: tr(lang, "الجلسة خلصت. اكتب *menu* عشان تبدأ تاني.", "Session expired. Type *menu* to start again.") };
  }
  try {
    const auth = await createTransferAuthorization(prisma, { senderId: userId, recipientPhone, amount, escrowEnabled });
    await setSession(userId, SessionState.SEND_PIN, { ...session.data, authorizationId: auth.authorizationId });
    return {
      text: tr(
        lang,
        `\u{1F512} تأكيد تحويل WTS\nاكتب الرقم السري من 6 أرقام عشان تأكد تحويل ${auth.amount.toLocaleString()} جنيه (الإجمالي ${auth.total.toLocaleString()} جنيه).`,
        `\u{1F512} Confirm WTS Transfer\nEnter your 6-digit WTS PIN to authorize ${auth.amount.toLocaleString()} EGP (total ${auth.total.toLocaleString()} EGP).`
      ),
      authorizationId: auth.authorizationId,
    };
  } catch (err: any) {
    await setSession(userId, SessionState.IDLE, {});
    return { text: tr(lang, `معرفناش نجهّز التحويل: ${err.message ?? "خطأ غير معروف"}. اكتب *menu* عشان تحاول تاني.`, `Could not prepare the transfer: ${err.message ?? "unknown error"}. Type *menu* to try again.`) };
  }
}

export async function cancelTransfer(userId: string, lang: Lang = "ar"): Promise<string> {
  const session = await getSession(userId);
  if (session.data.authorizationId) {
    await cancelAuthorization(prisma, { authorizationId: session.data.authorizationId, senderId: userId }).catch(() => {});
  }
  await setSession(userId, SessionState.IDLE, {});
  return tr(lang, "اتلغى التحويل. اكتب *menu* عشان تفتح القائمة الرئيسية.", "Transfer cancelled. Type *menu* for the main menu.");
}

// PIN entered for an authorization -> verify -> execute exactly once.
export async function handleAuthorizationPin(userId: string, raw: string, lang: Lang = "ar"): Promise<string> {
  const pin = raw.trim();
  const session = await getSession(userId);
  if (!/^\d{6}$/.test(pin)) return tr(lang, "اكتب الرقم السري من 6 أرقام (أرقام بس).", "Enter your 6-digit WTS PIN (numbers only).");
  if (!session.data.authorizationId) {
    await setSession(userId, SessionState.IDLE, {});
    return tr(lang, "مفيش تحويل معلّق. اكتب *menu* عشان تبدأ تاني.", "No pending transfer. Type *menu* to start again.");
  }
  try {
    await verifyPin(prisma, { userId, pin, lang });
  } catch (err: any) {
    if (err instanceof PinError && err.code === "PIN_LOCKED") {
      await setSession(userId, SessionState.IDLE, {});
      return `\u{1F512} ${err.message}`;
    }
    if (err instanceof PinError && err.code === "PIN_NOT_SET") {
      await setSession(userId, SessionState.IDLE, {});
      return tr(lang, "لسه معملتش رقم سري. اكتب *menu* واعمل الرقم السري الأول.", "You have no WTS PIN yet. Type *menu* and create your PIN first.");
    }
    return err.message ?? tr(lang, "الرقم السري غلط.", "Incorrect PIN.");
  }
  try {
    const { authorization, transaction, duplicate } = await executeAuthorizedTransfer(prisma, {
      authorizationId: session.data.authorizationId,
      senderId: userId,
    });
    await evaluateReferralEligibility(prisma, userId).catch(() => {});
    await setSession(userId, SessionState.IDLE, {});
    if (duplicate) return tr(lang, "التحويل ده كان اتنفّذ بالفعل.", "This transfer was already processed.");
    return tr(
      lang,
      `\u2705 التحويل تم بنجاح\n` +
        `اتبعت:\n${transaction.amount.toLocaleString()} جنيه\n` +
        `العمولة:\n${transaction.fee} جنيه\n` +
        `الإجمالي:\n${transaction.totalDebit.toLocaleString()} جنيه\n` +
        `المستلم:\n${authorization.recipientWtsId ?? authorization.recipientPhone}\n\n` +
        `حالة التفويض: ${authorization.status}. اكتب *menu* عشان تفتح القائمة الرئيسية.`,
      `\u2705 Transfer successful\n` +
        `Sent:\n${transaction.amount.toLocaleString()} EGP\n` +
        `Fee:\n${transaction.fee} EGP\n` +
        `Total:\n${transaction.totalDebit.toLocaleString()} EGP\n` +
        `Recipient:\n${authorization.recipientWtsId ?? authorization.recipientPhone}\n\n` +
        `Authorization ${authorization.status}. Type *menu* for the main menu.`
    );
  } catch (err: any) {
    await setSession(userId, SessionState.IDLE, {});
    return tr(lang, `التحويل فشل: ${err.message ?? "خطأ غير معروف"}. اكتب *menu* عشان تحاول تاني.`, `Transfer failed: ${err.message ?? "unknown error"}. Type *menu* to try again.`);
  }
}

// ---------------- Money requests (ask someone to pay you) ----------------

export async function getRequestsMenuRows(userId: string, lang: Lang = "ar"): Promise<WaListSectionRow[]> {
  const pending = await listIncomingRequests(prisma, userId);
  const rows: WaListSectionRow[] = pending.slice(0, 9).map((r: any) => ({
    id: `req_view_${r.id}`,
    title: tr(lang, `${r.amount} جنيه`, `${r.amount} EGP`),
    description: tr(lang, `من ${r.requester?.username ?? "مستخدم WTS"}`, `from ${r.requester?.username ?? "WTS user"}`),
  }));
  rows.push({ id: "req_new", title: tr(lang, "\u2795 اطلب فلوس", "\u2795 Request money"), description: tr(lang, "اطلب من حد يدفعلك", "Ask someone to pay you") });
  return rows;
}

export async function beginMoneyRequest(userId: string, lang: Lang = "ar"): Promise<string> {
  await setSession(userId, SessionState.REQ_WAIT_PHONE, {});
  return tr(lang, "عايز تطلب فلوس من مين؟ اكتب رقم الواتساب بتاعه (مثلاً +2010...).", "Who do you want to request money from? Enter their WhatsApp number (e.g. +2010\u2026).");
}

export async function handleRequestPhoneInput(userId: string, phone: string, lang: Lang = "ar"): Promise<{ text: string; ok: boolean }> {
  const clean = phone.replace(/[\s\-()]/g, "");
  if (!/^\+?[0-9]{8,15}$/.test(clean)) {
    return { text: tr(lang, "ده مش رقم موبايل صحيح. جرّب تاني (مثال: +2010xxxxxxx).", "That doesn't look like a valid phone number. Try again (e.g. +2010xxxxxxx)."), ok: false };
  }
  const payer = await prisma.user.findUnique({ where: { phone: normalizeWaPhone(clean.replace("+", "")) } });
  if (!payer) return { text: tr(lang, "مفيش مستخدم WTS بالرقم ده. جرّب تاني أو اكتب *menu*.", "No WTS user found with that phone number. Try again or type *menu*."), ok: false };
  if (payer.id === userId) return { text: tr(lang, "متقدرش تطلب فلوس من نفسك.", "You cannot request money from yourself."), ok: false };
  await setSession(userId, SessionState.REQ_WAIT_AMOUNT, {
    recipientPhone: payer.phone,
    recipientName: payer.fullName ?? payer.username,
  });
  return { text: tr(lang, `بتطلب من *${payer.fullName ?? payer.username}*.\nاكتب المبلغ بالجنيه:`, `Requesting from *${payer.fullName ?? payer.username}*.\nEnter the amount in EGP:`), ok: true };
}

export async function handleRequestAmountInput(userId: string, raw: string, lang: Lang = "ar"): Promise<string> {
  const amount = Number(raw.replace(/[^0-9]/g, ""));
  if (!Number.isInteger(amount) || amount <= 0) return tr(lang, "اكتب مبلغ صحيح أكبر من 0، مثلاً 500.", "Enter a whole number amount greater than 0, e.g. 500.");
  const session = await getSession(userId);
  const payerPhone = session.data.recipientPhone;
  if (!payerPhone) {
    await setSession(userId, SessionState.IDLE, {});
    return tr(lang, "الجلسة خلصت. اكتب *menu* عشان تبدأ تاني.", "Session expired. Type *menu* to start again.");
  }
  try {
    const requester = await prisma.user.findUnique({ where: { id: userId } });
    const { request, payer } = await createTransferRequest(prisma, {
      requesterId: userId,
      payerPhone,
      amount,
    });
    await setSession(userId, SessionState.IDLE, {});
    await notifyMoneyRequest(
      payer.whatsappPhone ?? payer.phone,
      requester?.fullName ?? requester?.username ?? tr(lang, "مستخدم WTS", "A WTS user"),
      request.amount,
      request.id,
      await getUserLanguage(payer.id)
    ).catch(() => {});
    return tr(
      lang,
      `\u2705 اتبعت الطلب لـ *${session.data.recipientName ?? payerPhone}* بمبلغ ${amount.toLocaleString()} جنيه. هتتبلّغ هنا لما يرد.`,
      `\u2705 Request sent to *${session.data.recipientName ?? payerPhone}* for ${amount.toLocaleString()} EGP. You'll be notified here when they respond.`
    );
  } catch (err: any) {
    await setSession(userId, SessionState.IDLE, {});
    return tr(lang, `معرفناش نبعت الطلب: ${err.message ?? "خطأ غير معروف"}. اكتب *menu* عشان تحاول تاني.`, `Could not send the request: ${err.message ?? "unknown error"}. Type *menu* to try again.`);
  }
}

export async function viewIncomingRequest(userId: string, requestId: string, lang: Lang = "ar"): Promise<{ text: string; buttons: { id: string; title: string }[] }> {
  const pending = await listIncomingRequests(prisma, userId);
  const request = pending.find((r: any) => r.id === requestId);
  if (!request) {
    return { text: tr(lang, "الطلب ده مش متاح دلوقتي. اكتب *menu*.", "This request is no longer available. Type *menu*."), buttons: [] };
  }
  return {
    text: tr(
      lang,
      `*${request.requester?.username ?? "مستخدم WTS"}* طالب منك *${request.amount} جنيه*.${request.description ? `\nالسبب: ${request.description}` : ""}`,
      `*${request.requester?.username ?? "A WTS user"}* is requesting *${request.amount} EGP* from you.${request.description ? `\nReason: ${request.description}` : ""}`
    ),
    buttons: [
      { id: `req_accept_${request.id}`, title: tr(lang, "\u2705 قبول", "\u2705 Accept") },
      { id: `req_reject_${request.id}`, title: tr(lang, "\u274C رفض", "\u274C Reject") },
    ],
  };
}

export async function rejectIncomingRequest(userId: string, requestId: string, lang: Lang = "ar"): Promise<string> {
  try {
    const updated = await rejectTransferRequest(prisma, { requestId, payerId: userId });
    const requester = await prisma.user.findUnique({ where: { id: updated.requesterId } });
    if (requester) {
      await notifyRequestRejected(requester.whatsappPhone ?? requester.phone, updated.amount, await getUserLanguage(requester.id)).catch(() => {});
    }
    return tr(lang, "اتم رفض الطلب.", "Request rejected.");
  } catch (err: any) {
    return err instanceof TransferRequestError ? err.message : tr(lang, "معرفناش نرفض الطلب ده.", "Could not reject this request.");
  }
}

export async function beginAcceptRequest(userId: string, requestId: string, lang: Lang = "ar"): Promise<string> {
  await setSession(userId, SessionState.REQ_PIN, { pendingRequestId: requestId });
  return tr(lang, "\u{1F512} اكتب الرقم السري من 6 أرقام عشان توافق على الطلب وتبعت الفلوس.", "\u{1F512} Enter your 6-digit WTS PIN to accept this request and send the money.");
}

export async function handleRequestPinInput(userId: string, raw: string, lang: Lang = "ar"): Promise<string> {
  const pin = raw.trim();
  if (!/^\d{6}$/.test(pin)) return tr(lang, "اكتب الرقم السري من 6 أرقام (أرقام بس).", "Enter your 6-digit WTS PIN (numbers only).");
  const session = await getSession(userId);
  const requestId = session.data.pendingRequestId;
  if (!requestId) {
    await setSession(userId, SessionState.IDLE, {});
    return tr(lang, "الجلسة خلصت. اكتب *menu* عشان تبدأ تاني.", "Session expired. Type *menu* to start again.");
  }
  try {
    const { transaction } = await acceptTransferRequest(prisma, { requestId, payerId: userId, pin });
    await setSession(userId, SessionState.IDLE, {});
    await notifyTransferReceived(transaction.id).catch(() => {});
    return tr(lang, `\u2705 تم القبول. ${transaction.amount.toLocaleString()} جنيه اتبعتوا. اكتب *menu* عشان القائمة الرئيسية.`, `\u2705 Accepted. ${transaction.amount.toLocaleString()} EGP sent. Type *menu* for the main menu.`);
  } catch (err: any) {
    if (err instanceof PinError) {
      return err.message; // includes lockout / attempts-remaining messaging
    }
    await setSession(userId, SessionState.IDLE, {});
    return err instanceof TransferRequestError
      ? tr(lang, `${err.message} اكتب *menu*.`, `${err.message} Type *menu*.`)
      : tr(lang, "معرفناش نكمّل الطلب ده. اكتب *menu* عشان تحاول تاني.", "Could not complete this request. Type *menu* to try again.");
  }
}

// ── بلاغات النصب: إشعارات المستخدم المبلَّغ عنه ─────────────────────────
export async function notifyReportFiled(phone: string, lang: Lang = "ar") {
  const { sendTextMessage } = await import("./whatsapp.client.js");
  await sendTextMessage(
    phone.replace("+", ""),
    tr(
      lang,
      "\u26A0\uFE0F اتقدّم بلاغ ضدك بخصوص عملية مؤخرًا. من فضلك رد هنا بأي دليل أو توضيح — هيراجعه فريقنا قبل ما ناخد أي إجراء.",
      "\u26A0\uFE0F A complaint was filed against you regarding a recent transaction. Please reply here with any evidence or explanation — our team will review it before taking any action."
    )
  );
}

export async function notifyReportResolved(
  phone: string,
  status: "CONFIRMED" | "DISMISSED",
  banned: boolean,
  frozenUntil: Date | null,
  lang: Lang = "ar"
) {
  const { sendTextMessage } = await import("./whatsapp.client.js");
  if (status === "DISMISSED") {
    await sendTextMessage(phone.replace("+", ""), tr(lang, "\u2705 البلاغ ضدك اتراجع وتم رفضه. مفيش إجراء اتاخد.", "\u2705 The complaint against you was reviewed and dismissed. No action was taken."));
    return;
  }
  if (banned) {
    await sendTextMessage(phone.replace("+", ""), tr(lang, "\u274C محفظتك اتوقفت نهائيًا بسبب بلاغات متكررة مؤكدة.", "\u274C Your wallet has been permanently disabled following repeated confirmed complaints."));
    return;
  }
  if (frozenUntil) {
    await sendTextMessage(
      phone.replace("+", ""),
      tr(lang, `\u274C بلاغ ضدك اتأكد. محفظتك مجمّدة لحد ${frozenUntil.toLocaleDateString()}.`, `\u274C A complaint against you was confirmed. Your wallet is frozen until ${frozenUntil.toLocaleDateString()}.`)
    );
    return;
  }
  await sendTextMessage(phone.replace("+", ""), tr(lang, "\u26A0\uFE0F بلاغ ضدك اتأكد. ده متسجّل في حسابك.", "\u26A0\uFE0F A complaint against you was confirmed. This is recorded on your account."));
}

export async function notifyFreeze(userPhone: string, frozen: boolean, lang: Lang = "ar") {
  const { sendTextMessage } = await import("./whatsapp.client.js");
  await sendTextMessage(
    userPhone.replace("+", ""),
    frozen
      ? tr(lang, "\u26A0 حساب WTS Pay بتاعك اتجمّد من الأدمن. رصيدك سليم. تواصل مع الدعم.", "\u26A0 Your WTS Pay account has been frozen by an administrator. Your balance remains intact. Contact support.")
      : tr(lang, "\u2705 حساب WTS Pay بتاعك اترفع عنه التجميد. محفظتك شغالة تاني.", "\u2705 Your WTS Pay account has been unfrozen. Your wallet is active again.")
  );
}

export async function notifyApproval(phone: string, wtsId: string, walletId: string, balance: number, lang: Lang = "ar") {
  const { sendButtonMessage } = await import("./whatsapp.client.js");
  const { ACTIONS } = await import("./whatsapp.templates.js");
  await sendButtonMessage(
    phone.replace("+", ""),
    tr(
      lang,
      `\u{1F389} تم قبول حساب WTS Pay بتاعك.\nمحفظتك بقت شغالة دلوقتي.\n\nكود WTS:\n${wtsId}\nالرصيد:\n${balance} جنيه`,
      `\u{1F389} Your WTS Pay account has been approved.\nYour wallet is now active.\n\nWTS ID:\n${wtsId}\nBalance:\n${balance} EGP`
    ),
    [
      { id: ACTIONS.BALANCE, title: tr(lang, "\u{1F4B0} المحفظة", "\u{1F4B0} Wallet") },
      { id: ACTIONS.SEND_MONEY, title: tr(lang, "\u{1F4B8} تحويل فلوس", "\u{1F4B8} Send Money") },
      { id: ACTIONS.CREATE_PIN, title: tr(lang, "\u{1F512} اعمل رقم سري", "\u{1F512} Create PIN") },
    ]
  );
}

export async function notifyRejection(phone: string, reason: string, lang: Lang = "ar") {
  const { sendTextMessage } = await import("./whatsapp.client.js");
  await sendTextMessage(
    phone.replace("+", ""),
    tr(lang, `طلب التسجيل في WTS Pay اترفض. السبب: ${reason}. تواصل مع الدعم لو فاكر إن ده غلط.`, `Your WTS Pay registration was rejected. Reason: ${reason}. Contact support if you believe this is a mistake.`)
  );
}

// ── طلب تحويل: إشعارات واتساب (نصية) ────────────────────────────────────
// الرد (قبول/رفض) ممكن يتم من الموقع أو من واتساب نفسه دلوقتي.
export async function notifyMoneyRequest(phone: string, requesterName: string, amount: number, requestId: string, lang: Lang = "ar") {
  const { sendTextMessage } = await import("./whatsapp.client.js");
  await sendTextMessage(
    phone.replace("+", ""),
    tr(
      lang,
      `\u{1F4E9} ${requesterName} طالب منك ${amount} جنيه على WTS Pay.\nافتح التطبيق عشان توافق أو ترفض الطلب.`,
      `\u{1F4E9} ${requesterName} is requesting ${amount} EGP from you on WTS Pay.\nOpen the app to accept or reject this request.`
    )
  );
}

// يُستدعى بعد أي تحويل ناجح (من الموقع أو الواتساب، تحويل مباشر أو قبول
// طلب تحويل) عشان يوصل للمستلم إشعار: مين حوّل له، بكام، ورصيده بقى قد إيه.
export async function notifyTransferReceived(transactionId: string): Promise<void> {
  const t = await prisma.transaction.findUnique({
    where: { id: transactionId },
    include: {
      sender: { select: { fullName: true, username: true } },
      receiver: { select: { whatsappPhone: true, phone: true, language: true } },
    },
  });
  if (!t || !t.receiver) return;
  const to = (t.receiver.whatsappPhone ?? t.receiver.phone ?? "").replace("+", "");
  if (!to) return;
  const lang = normalizeLang((t.receiver as any).language);
  const senderName = t.sender?.fullName ?? t.sender?.username ?? tr(lang, "حد ما", "Someone");
  const balance = t.receiverBalanceAfter;
  const { sendTextMessage } = await import("./whatsapp.client.js");
  await sendTextMessage(
    to,
    tr(
      lang,
      `\u{1F4B0} استلمت ${t.amount.toLocaleString()} جنيه من ${senderName}.` +
        (balance !== null && balance !== undefined ? `\nرصيدك دلوقتي: ${balance.toLocaleString()} جنيه.` : ""),
      `\u{1F4B0} You received ${t.amount.toLocaleString()} EGP from ${senderName}.` +
        (balance !== null && balance !== undefined ? `\nNew balance: ${balance.toLocaleString()} EGP.` : "")
    )
  );
}

export async function notifyRequestAccepted(phone: string, amount: number, lang: Lang = "ar") {
  const { sendTextMessage } = await import("./whatsapp.client.js");
  await sendTextMessage(
    phone.replace("+", ""),
    tr(lang, `\u2705 طلبك بمبلغ ${amount} جنيه اتوافق عليه والفلوس اتبعتت لمحفظتك.`, `\u2705 Your request for ${amount} EGP was accepted and the money has been sent to your wallet.`)
  );
}

export async function notifyRequestRejected(phone: string, amount: number, lang: Lang = "ar") {
  const { sendTextMessage } = await import("./whatsapp.client.js");
  await sendTextMessage(phone.replace("+", ""), tr(lang, `\u274C طلبك بمبلغ ${amount} جنيه اترفض.`, `\u274C Your request for ${amount} EGP was rejected.`));
}

export function walletLogger() {
  return logger;
}
