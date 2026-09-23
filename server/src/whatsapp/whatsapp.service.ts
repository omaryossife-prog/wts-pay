// ---------------------------------------------------------------------------
// WhatsApp conversation logic. All money movement goes through the SAME
// wallet/fee/authorization services used by the website. WhatsApp identity
// (waId) identifies the account; the WTS PIN authorizes transactions.
//
// MEDIA POLICY: ID photos and face videos are never downloaded or stored.
// We only record metadata. Admins review media inside WhatsApp.
// ---------------------------------------------------------------------------
import { prisma } from "../utils/prisma.js";
import { computeFee } from "../services/fee.service.js";
import { getLimitsConfig, getMaintenanceConfig } from "../services/config.service.js";
import { evaluateReferralEligibility } from "../services/referral.service.js";
import {
  createTransferAuthorization,
  executeAuthorizedTransfer,
  cancelAuthorization,
} from "../services/txauth.service.js";
import { verifyPin, setPin, PinError } from "../services/pin.service.js";
import {
  validateFourPartName, findByWhatsAppIdentity, createRegistration, recordFullName,
  recordIdSubmitted, recordFaceVideoSubmitted, normalizeWaPhone,
} from "../services/registration.service.js";
import { logger } from "../utils/logger.js";
import type { Db } from "../utils/prisma.js";

export const SESSION_TTL_MS = 10 * 60 * 1000;

export const SessionState = {
  IDLE: "IDLE",
  // registration
  REG_NAME: "REG_NAME",
  REG_CONFIRM_NUMBER: "REG_CONFIRM_NUMBER",
  REG_ID_FRONT: "REG_ID_FRONT",
  REG_ID_BACK: "REG_ID_BACK",
  REG_FACE_VIDEO: "REG_FACE_VIDEO",
  // PIN setup (fallback when Flow not configured)
  PIN_CREATE: "PIN_CREATE",
  PIN_CONFIRM: "PIN_CONFIRM",
  // send money with authorization
  SEND_WAIT_PHONE: "SEND_WAIT_PHONE",
  SEND_WAIT_AMOUNT: "SEND_WAIT_AMOUNT",
  SEND_CONFIRMATION: "SEND_CONFIRMATION",
  SEND_PIN: "SEND_PIN",
} as const;
export type SessionState = (typeof SessionState)[keyof typeof SessionState];

interface WaSessionData {
  recipientPhone?: string;
  recipientWtsId?: string;
  recipientName?: string;
  amount?: number;
  fee?: number;
  totalDebit?: number;
  authorizationId?: string;
  pendingPin?: string; // fallback setup only, never persisted beyond setup
}

export async function getUserByWaIdentity(db: Db, waId: string, phoneDigits: string) {
  return findByWhatsAppIdentity(db, waId, phoneDigits);
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

export async function startRegistration(waId: string, phoneDigits: string, profileName?: string) {
  const user = await createRegistration(prisma, { waId, phoneDigits, profileName });
  await setSession(user.id, SessionState.REG_NAME, {});
  return (
    "Your WhatsApp account is not registered with WTS Pay.\n" +
    "Would you like to create a new account?"
  );
}

export async function handleNameInput(userId: string, raw: string): Promise<{ text: string; ok: boolean }> {
  const v = validateFourPartName(raw);
  if (!v.ok || !v.fullName) return { text: v.error ?? "Invalid name.", ok: false };
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { whatsappPhone: true } });
  await recordFullName(prisma, userId, v.fullName);
  await setSession(userId, SessionState.REG_CONFIRM_NUMBER, {});
  return {
    text: `Full name recorded: ${v.fullName}\n\nWhatsApp number:\n${user?.whatsappPhone ?? ""}\nIs this your WhatsApp number?`,
    ok: true,
  };
}

export async function confirmNumberYes(userId: string): Promise<string> {
  await setSession(userId, SessionState.REG_ID_FRONT, {});
  return "\u{1F4CE} Please send a clear photo of the front of your ID card.";
}

export const NUMBER_NO_TEXT =
  "The WhatsApp identity received from the official API is the authoritative channel identity, " +
  "so an account can only be created for this exact WhatsApp number. " +
  "If this is not your number, please continue from your own WhatsApp account.";

// ID front/back and face video: metadata only. We intentionally never fetch or
// store the media (acceptance criterion 7).
export async function handleIdFront(userId: string): Promise<string> {
  await recordIdSubmitted(prisma, userId);
  await setSession(userId, SessionState.REG_ID_BACK, {});
  return "ID front received.\nNow send a clear photo of the back of your ID card.";
}

export async function handleIdBack(userId: string): Promise<string> {
  await setSession(userId, SessionState.REG_FACE_VIDEO, {});
  return (
    "\u{1F3A5} Final verification step.\n" +
    "Please send a short video of your face, around 5\u201310 seconds.\n" +
    "Make sure your face is clearly visible and the lighting is good."
  );
}

export async function handleFaceVideo(userId: string): Promise<string> {
  await recordFaceVideoSubmitted(prisma, userId);
  await setSession(userId, SessionState.IDLE, {});
  return (
    "Your registration has been submitted for review. \u2705\n" +
    "Please wait for approval. You will be notified here."
  );
}

// ---------------- PIN setup ----------------

export async function handlePinCreateInput(userId: string, raw: string): Promise<{ text: string; ok: boolean }> {
  const pin = raw.trim();
  if (!/^\d{6}$/.test(pin)) {
    return { text: "The PIN must be exactly 6 digits. Try again.", ok: false };
  }
  await setSession(userId, SessionState.PIN_CONFIRM, { pendingPin: pin });
  return { text: "Confirm your PIN by entering the same 6 digits again.", ok: true };
}

export async function handlePinConfirmInput(userId: string, raw: string): Promise<{ text: string; ok: boolean }> {
  const session = await getSession(userId);
  if (!session.data.pendingPin) {
    await setSession(userId, SessionState.PIN_CREATE, {});
    return { text: "Let's start over. Create your 6-digit WTS PIN:", ok: false };
  }
  if (raw.trim() !== session.data.pendingPin) {
    await setSession(userId, SessionState.PIN_CREATE, {});
    return { text: "PINs did not match. Create your 6-digit WTS PIN again:", ok: false };
  }
  await setPin(prisma, { userId, pin: session.data.pendingPin });
  await setSession(userId, SessionState.IDLE, {});
  return { text: "\u{1F512} Your WTS transaction PIN is set. Your wallet is fully active. Type *menu*.", ok: true };
}

// Called by the WhatsApp Flow data-exchange endpoint when a Flow-based PIN
// entry completes (preferred, no chat fallback needed).
export async function completePinFromFlow(userId: string, pin: string) {
  await setPin(prisma, { userId, pin });
  await setSession(userId, SessionState.IDLE, {});
}

// ---------------- Menu actions ----------------

export async function getBalanceText(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { demoBalance: true, status: true, wtsId: true, walletId: true },
  });
  if (!user) return "Account not found.";
  if (user.status !== "ACTIVE") return "Your account is frozen. Contact support.";
  return (
    `WTS ID: ${user.wtsId ?? "pending"}\n` +
    `Your demo balance is ${user.demoBalance} EGP.\n` +
    `_(Demo credits have no cash value and cannot be withdrawn.)_`
  );
}

export async function getTransactionsText(userId: string): Promise<string> {
  const txs = await prisma.transaction.findMany({
    where: { OR: [{ senderId: userId }, { receiverId: userId }] },
    orderBy: { createdAt: "desc" },
    take: 10,
    include: { sender: { select: { phone: true } }, receiver: { select: { phone: true } } },
  });
  if (txs.length === 0) return "No transactions yet.";
  const lines = txs.map((t) => {
    const dir = t.senderId === userId ? "sent" : "received";
    const other = t.senderId === userId ? t.receiver?.phone ?? "?" : t.sender?.phone ?? "?";
    return `\u2022 ${t.amount} EGP ${dir} (with ${other}) ${t.type.toLowerCase()}`;
  });
  return "Recent transactions:\n" + lines.join("\n");
}

export async function getReferralText(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { referralCode: true, referralCount: true } });
  const rewarded = await prisma.referral.count({ where: { referrerId: userId, status: "REWARDED" } });
  if (!user) return "Account not found.";
  return (
    `Your referral code: *${user.referralCode}*\n` +
    `Share it with friends! After they sign up, get verified and complete their first transfer, you earn the referral reward.\n\n` +
    `Invited: ${user.referralCount} \u2022 Rewarded: ${rewarded}\n` +
    `_(Referrals are only rewarded after anti-abuse checks.)_`
  );
}

export async function getAccountText(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { username: true, phone: true, fullName: true, wtsId: true, walletId: true, demoBalance: true, status: true, transfersEnabled: true, verificationStatus: true, createdAt: true },
  });
  if (!user) return "Account not found.";
  return (
    `*My Account*\n` +
    `Full name: ${user.fullName ?? "-"}\nWTS ID: ${user.wtsId ?? "-"}\nWallet: ${user.walletId ?? "-"}\n` +
    `Phone: ${user.phone}\nStatus: ${user.status}\nVerification: ${user.verificationStatus}\n` +
    `Transfers: ${user.transfersEnabled ? "enabled" : "disabled"}\n` +
    `Demo balance: ${user.demoBalance} EGP\nMember since: ${user.createdAt.toDateString()}`
  );
}

export const HELP_TEXT =
  "*WTS Pay Help* (Demo)\n\n" +
  "\u2022 Balances are DEMO credits - no cash value, no withdrawals.\n" +
  "\u2022 Send: choose Send Money, recipient, amount, confirm, then enter your WTS PIN.\n" +
  "\u2022 Fee: 1 EGP per started 1000 EGP.\n" +
  "\u2022 Your WTS PIN (6 digits) authorizes transfers - never share it.\n" +
  "\u2022 Referrals reward you after your invitee is verified and completes their first transfer.\n\n" +
  "Support: support@wtspay.demo";

// ---------------- Send money with PIN authorization ----------------

export async function beginSendMoney(userId: string): Promise<string> {
  await setSession(userId, SessionState.SEND_WAIT_PHONE, {});
  return "Please enter the recipient's WTS phone number (with country code, e.g. +2010\u2026).";
}

export async function handlePhoneInput(userId: string, phone: string): Promise<{ text: string; ok: boolean }> {
  const clean = phone.replace(/[\s\-()]/g, "");
  if (!/^\+?[0-9]{8,15}$/.test(clean)) {
    return { text: "That doesn't look like a valid phone number. Try again (e.g. +2010xxxxxxx).", ok: false };
  }
  const recipient = await prisma.user.findUnique({ where: { phone: normalizeWaPhone(clean.replace("+", "")) } });
  if (!recipient) return { text: "No WTS user found with that phone number. Try again or type *menu*.", ok: false };
  if (recipient.id === userId) return { text: "You cannot send money to yourself.", ok: false };
  if (recipient.status !== "ACTIVE") return { text: "That account is frozen.", ok: false };
  if (recipient.verificationStatus !== "VERIFIED") return { text: "That account is not verified yet.", ok: false };
  if (recipient.transfersEnabled === false) return { text: "That account cannot receive transfers right now.", ok: false };
  await setSession(userId, SessionState.SEND_WAIT_AMOUNT, {
    recipientPhone: recipient.phone,
    recipientWtsId: recipient.wtsId ?? undefined,
    recipientName: recipient.fullName ?? recipient.username,
  });
  return { text: `Sending to *${recipient.fullName ?? recipient.username}* (${recipient.wtsId ?? recipient.phone}).\nEnter the amount in EGP:`, ok: true };
}

export async function handleAmountInput(userId: string, raw: string): Promise<{ text: string; summary?: string; amount: number; fee: number; totalDebit: number } | { text: string; ok: false }> {
  const amount = Number(raw.replace(/[^0-9]/g, ""));
  if (!Number.isInteger(amount) || amount <= 0) return { text: "Enter a whole number amount greater than 0, e.g. 500.", ok: false };
  const limits = await getLimitsConfig(prisma);
  if (amount < limits.minTransfer || amount > limits.maxTransfer) {
    return { text: `Amount must be between ${limits.minTransfer} and ${limits.maxTransfer} EGP.`, ok: false };
  }
  const { fee, totalDebit } = await computeFee(prisma, amount);
  const session = await getSession(userId);
  await setSession(userId, SessionState.SEND_CONFIRMATION, { ...session.data, amount, fee, totalDebit });
  const summary =
    `Confirm Transfer\n` +
    `Recipient:\n${session.data.recipientWtsId ?? session.data.recipientPhone}\n` +
    `Amount:\n${amount.toLocaleString()} EGP\n` +
    `Fee:\n${fee} EGP\n` +
    `Total:\n${totalDebit.toLocaleString()} EGP`;
  return { text: summary, summary, amount, fee, totalDebit };
}

// Button press "Confirm Transfer" -> create the pending authorization. The
// transfer itself does NOT execute until the PIN is verified.
export async function confirmTransfer(userId: string): Promise<{ text: string; authorizationId?: string }> {
  const session = await getSession(userId);
  const { recipientPhone, amount } = session.data;
  if (!recipientPhone || !amount) {
    await setSession(userId, SessionState.IDLE, {});
    return { text: "Session expired. Type *menu* to start again." };
  }
  try {
    const auth = await createTransferAuthorization(prisma, { senderId: userId, recipientPhone, amount });
    await setSession(userId, SessionState.SEND_PIN, { ...session.data, authorizationId: auth.authorizationId });
    return {
      text: `\u{1F512} Confirm WTS Transfer\nEnter your 6-digit WTS PIN to authorize ${auth.amount.toLocaleString()} EGP (total ${auth.total.toLocaleString()} EGP).`,
      authorizationId: auth.authorizationId,
    };
  } catch (err: any) {
    await setSession(userId, SessionState.IDLE, {});
    return { text: `Could not prepare the transfer: ${err.message ?? "unknown error"}. Type *menu* to try again.` };
  }
}

export async function cancelTransfer(userId: string): Promise<string> {
  const session = await getSession(userId);
  if (session.data.authorizationId) {
    await cancelAuthorization(prisma, { authorizationId: session.data.authorizationId, senderId: userId }).catch(() => {});
  }
  await setSession(userId, SessionState.IDLE, {});
  return "Transfer cancelled. Type *menu* for the main menu.";
}

// PIN entered for an authorization -> verify -> execute exactly once.
export async function handleAuthorizationPin(userId: string, raw: string): Promise<string> {
  const pin = raw.trim();
  const session = await getSession(userId);
  if (!/^\d{6}$/.test(pin)) return "Enter your 6-digit WTS PIN (numbers only).";
  if (!session.data.authorizationId) {
    await setSession(userId, SessionState.IDLE, {});
    return "No pending transfer. Type *menu* to start again.";
  }
  try {
    await verifyPin(prisma, { userId, pin });
  } catch (err: any) {
    if (err instanceof PinError && err.code === "PIN_LOCKED") {
      await setSession(userId, SessionState.IDLE, {});
      return `\u{1F512} ${err.message}`;
    }
    if (err instanceof PinError && err.code === "PIN_NOT_SET") {
      await setSession(userId, SessionState.IDLE, {});
      return "You have no WTS PIN yet. Type *menu* and create your PIN first.";
    }
    return err.message ?? "Incorrect PIN.";
  }
  try {
    const { authorization, transaction, duplicate } = await executeAuthorizedTransfer(prisma, {
      authorizationId: session.data.authorizationId,
      senderId: userId,
    });
    await evaluateReferralEligibility(prisma, userId).catch(() => {});
    await setSession(userId, SessionState.IDLE, {});
    if (duplicate) return "This transfer was already processed.";
    return (
      `\u2705 Transfer successful\n` +
      `Sent:\n${transaction.amount.toLocaleString()} EGP\n` +
      `Fee:\n${transaction.fee} EGP\n` +
      `Total:\n${transaction.totalDebit.toLocaleString()} EGP\n` +
      `Recipient:\n${authorization.recipientWtsId ?? authorization.recipientPhone}\n\n` +
      `Authorization ${authorization.status}. Type *menu* for the main menu.`
    );
  } catch (err: any) {
    await setSession(userId, SessionState.IDLE, {});
    return `Transfer failed: ${err.message ?? "unknown error"}. Type *menu* to try again.`;
  }
}

export async function notifyFreeze(userPhone: string, frozen: boolean) {
  const { sendTextMessage } = await import("./whatsapp.client.js");
  await sendTextMessage(
    userPhone.replace("+", ""),
    frozen
      ? "\u26A0 Your WTS Pay account has been frozen by an administrator. Your balance remains intact. Contact support."
      : "\u2705 Your WTS Pay account has been unfrozen. Your wallet is active again."
  );
}

export async function notifyApproval(phone: string, wtsId: string, walletId: string, balance: number) {
  const { sendButtonMessage } = await import("./whatsapp.client.js");
  const { ACTIONS } = await import("./whatsapp.templates.js");
  await sendButtonMessage(phone.replace("+", ""), `\u{1F389} Your WTS Pay account has been approved.\nYour wallet is now active.\n\nWTS ID:\n${wtsId}\nBalance:\n${balance} EGP`, [
    { id: ACTIONS.BALANCE, title: "\u{1F4B0} Wallet" },
    { id: ACTIONS.SEND_MONEY, title: "\u{1F4B8} Send Money" },
    { id: ACTIONS.CREATE_PIN, title: "\u{1F512} Create PIN" },
  ]);
}

export async function notifyRejection(phone: string, reason: string) {
  const { sendTextMessage } = await import("./whatsapp.client.js");
  await sendTextMessage(phone.replace("+", ""), `Your WTS Pay registration was rejected. Reason: ${reason}. Contact support if you believe this is a mistake.`);
}

export function walletLogger() {
  return logger;
}
