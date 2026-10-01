// ---------------------------------------------------------------------------
// Unified WhatsApp Flow action layer. This module is the ONLY bridge between
// WhatsApp Flow data-exchange payloads and the existing WTS services.
// It never invents parallel wallet logic: reads use the same Prisma models,
// transfers use transaction authorization + PIN verification + wallet ledger.
//
// LANGUAGE: getActor() resolves the user's stored language once per call and
// every response message below is built with tr(lang, ar, en).
// ---------------------------------------------------------------------------
import { prisma } from "../utils/prisma.js";
import { getLimitsConfig, getMaintenanceConfig } from "../services/config.service.js";
import { evaluateReferralEligibility } from "../services/referral.service.js";
import { createTransferAuthorization, executeAuthorizedTransfer } from "../services/txauth.service.js";
import { verifyPin, PinError } from "../services/pin.service.js";
import { acceptTransferRequest, TransferRequestError } from "../services/transferRequest.service.js";
import { WalletError } from "../services/wallet.service.js";
import { normalizeWaPhone } from "../services/registration.service.js";
import { sendTextMessage } from "./whatsapp.client.js";
import { notifyTransferReceived } from "./whatsapp.service.js";
import { logger } from "../utils/logger.js";
import { type Lang, tr, normalizeLang } from "../i18n/lang.js";

export const WTS_FLOW_ACTIONS = {
  GET_BALANCE: "GET_BALANCE",
  SEND_MONEY: "SEND_MONEY",
  CREATE_TRANSFER: "CREATE_TRANSFER",
  CONFIRM_TRANSFER: "CONFIRM_TRANSFER",
  ACCEPT_REQUEST: "ACCEPT_REQUEST",
  VERIFY_PIN: "VERIFY_PIN",
  GET_TRANSACTIONS: "GET_TRANSACTIONS",
  GET_REFERRALS: "GET_REFERRALS",
} as const;

export type WtsFlowAction = (typeof WTS_FLOW_ACTIONS)[keyof typeof WTS_FLOW_ACTIONS];

export type WtsActionStatus = "SUCCESS" | "INSUFFICIENT_BALANCE" | "INVALID_PIN" | "REJECTED" | "ERROR";

export interface WtsTransactionLine {
  amount: number;
  fee: number;
  total: number;
  status: string;
  type: string;
  direction: "sent" | "received";
  other: string;
  createdAt: string;
}

export interface WtsActionResponse {
  success: boolean;
  status: WtsActionStatus;
  message: string;
  transactionId?: string;
  amount?: number;
  fee?: number;
  total?: number;
  balanceAfter?: number;
  authorizationId?: string;
  recipientPhone?: string;
  recipientWtsId?: string;
  recipientName?: string;
  referralCode?: string;
  invited?: number;
  rewarded?: number;
  transactions?: WtsTransactionLine[];
}

function ok(partial: Omit<WtsActionResponse, "success" | "status"> & { status?: WtsActionStatus }): WtsActionResponse {
  return { success: true, status: partial.status ?? "SUCCESS", message: partial.message, ...partial };
}

function fail(status: WtsActionStatus, message: string, extra: Partial<WtsActionResponse> = {}): WtsActionResponse {
  return { success: false, status, message, ...extra };
}

function errorResponse(err: unknown, lang: Lang): WtsActionResponse {
  if (err instanceof WalletError) {
    switch (err.code) {
      case "INSUFFICIENT_BALANCE":
        return fail("INSUFFICIENT_BALANCE", tr(lang, "الرصيد غير كافٍ", "Insufficient balance"));
      case "ACCOUNT_FROZEN":
        return fail("REJECTED", tr(lang, "الحساب مجمد", "Account is frozen"));
      case "ACCOUNT_UNVERIFIED":
        return fail("REJECTED", tr(lang, "الحساب غير موثق", "Account is not verified"));
      case "TRANSFERS_DISABLED":
        return fail("REJECTED", tr(lang, "التحويلات متوقفة لهذا الحساب", "Transfers are disabled for this account"));
      case "SELF_TRANSFER":
        return fail("REJECTED", tr(lang, "لا يمكن الإرسال إلى نفسك", "You cannot send money to yourself"));
      case "USER_NOT_FOUND":
        return fail("REJECTED", tr(lang, "لم يتم العثور على المستخدم", "User not found"));
      case "INVALID_AMOUNT":
        return fail("REJECTED", tr(lang, "المبلغ غير صالح", "Invalid amount"));
      case "LIMIT_EXCEEDED":
        return fail("REJECTED", tr(lang, "المبلغ خارج الحدود المسموحة", "Amount is outside the allowed limits"));
      default:
        return fail("ERROR", tr(lang, "حدث خطأ، حاول مرة أخرى", "Something went wrong, please try again"));
    }
  }
  if (err instanceof PinError) {
    if (err.code === "PIN_INVALID" || err.code === "PIN_WEAK") return fail("INVALID_PIN", tr(lang, "الرمز السري غير صحيح", "Incorrect PIN"));
    if (err.code === "PIN_LOCKED") return fail("INVALID_PIN", tr(lang, "تم قفل الرمز السري مؤقتًا", "The PIN is temporarily locked"));
    return fail("INVALID_PIN", tr(lang, "لا يوجد رمز سري مفعّل", "No PIN is set yet"));
  }
  const maybe = err as { code?: string; message?: string } | null;
  if (maybe?.code?.startsWith("AUTH_")) return fail("REJECTED", tr(lang, "العملية لم تعد صالحة أو انتهت صلاحيتها", "This operation is no longer valid or has expired"));
  logger.error("WTS Flow action failed", err);
  return fail("ERROR", tr(lang, "حدث خطأ، حاول مرة أخرى", "Something went wrong, please try again"));
}

async function getActor(userId: string, lang: Lang) {
  const maintenance = await getMaintenanceConfig(prisma);
  if (maintenance.enabled) return fail("REJECTED", maintenance.message || tr(lang, "النظام في وضع الصيانة حاليًا", "The system is under maintenance right now")) as const;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return fail("ERROR", tr(lang, "الحساب غير موجود", "Account not found")) as const;
  if (user.status !== "ACTIVE") return fail("REJECTED", tr(lang, "الحساب مجمد", "Account is frozen")) as const;
  if (user.verificationStatus !== "VERIFIED") return fail("REJECTED", tr(lang, "الحساب غير موثق", "Account is not verified")) as const;
  if (user.transfersEnabled === false) return fail("REJECTED", tr(lang, "التحويلات متوقفة لهذا الحساب", "Transfers are disabled for this account")) as const;
  return { user } as const;
}

function parseAmount(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isInteger(raw) && raw > 0 ? raw : null;
  const s = String(raw ?? "").replace(/[\s,]/g, "");
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function cleanPhone(raw: unknown): string {
  return String(raw ?? "").replace(/[\s\-()]/g, "");
}

async function currentBalance(userId: string): Promise<number | undefined> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { demoBalance: true } });
  return u?.demoBalance;
}

export async function executeWtsAction(userId: string, action: string, payload: Record<string, unknown> = {}): Promise<WtsActionResponse> {
  // Resolve language once, from the user's stored preference (falls back to "ar").
  const langRow = await prisma.user.findUnique({ where: { id: userId }, select: { language: true } });
  const lang: Lang = normalizeLang(langRow?.language);

  const actor = await getActor(userId, lang);
  if ("status" in actor) return actor as WtsActionResponse;
  const user = actor.user;

  try {
    switch (action as WtsFlowAction) {
      case WTS_FLOW_ACTIONS.GET_BALANCE: {
        return ok({ message: tr(lang, `رصيدك الحالي: ${user.demoBalance} جنيه`, `Your current balance: ${user.demoBalance} EGP`), balanceAfter: user.demoBalance });
      }

      case WTS_FLOW_ACTIONS.GET_TRANSACTIONS: {
        const txs = await prisma.transaction.findMany({
          where: { OR: [{ senderId: userId }, { receiverId: userId }] },
          orderBy: { createdAt: "desc" },
          take: 10,
          include: { sender: { select: { phone: true } }, receiver: { select: { phone: true } } },
        });
        const transactions: WtsTransactionLine[] = txs.map((t) => ({
          amount: t.amount,
          fee: t.fee,
          total: t.totalDebit,
          status: t.status,
          type: t.type,
          direction: t.senderId === userId ? "sent" : "received",
          other: t.senderId === userId ? t.receiver?.phone ?? "?" : t.sender?.phone ?? "?",
          createdAt: t.createdAt.toISOString(),
        }));
        return ok({ message: txs.length ? tr(lang, `تم جلب آخر ${txs.length} عمليات.`, `Loaded your last ${txs.length} transactions.`) : tr(lang, "لا توجد عمليات بعد.", "No transactions yet."), transactions });
      }

      case WTS_FLOW_ACTIONS.GET_REFERRALS: {
        const rewarded = await prisma.referral.count({ where: { referrerId: userId, status: "REWARDED" } });
        return ok({
          message: tr(lang, `كود الإحالة: ${user.referralCode} • المدعوون: ${user.referralCount} • المكتملون: ${rewarded}`, `Referral code: ${user.referralCode} • Invited: ${user.referralCount} • Rewarded: ${rewarded}`),
          referralCode: user.referralCode,
          invited: user.referralCount,
          rewarded,
        });
      }

      case WTS_FLOW_ACTIONS.SEND_MONEY: {
        const rawPhone = cleanPhone(payload.recipientPhone ?? payload.recipient_phone);
        const lookup = normalizeWaPhone(rawPhone.replace("+", ""));
        const recipient = await prisma.user.findUnique({ where: { phone: lookup } });
        if (!recipient) return fail("REJECTED", tr(lang, "لا يوجد مستخدم WTS بهذا الرقم", "No WTS user found with that phone number"));
        if (recipient.id === user.id) return fail("REJECTED", tr(lang, "لا يمكن الإرسال إلى نفسك", "You cannot send money to yourself"));
        if (recipient.status !== "ACTIVE") return fail("REJECTED", tr(lang, "حساب المستلم مجمد", "The recipient's account is frozen"));
        if (recipient.verificationStatus !== "VERIFIED") return fail("REJECTED", tr(lang, "حساب المستلم غير موثق", "The recipient's account is not verified"));
        if (recipient.transfersEnabled === false) return fail("REJECTED", tr(lang, "حساب المستلم لا يستقبل تحويلات الآن", "The recipient's account cannot receive transfers right now"));
        return ok({
          message: tr(lang, "تم العثور على المستلم. أدخل المبلغ.", "Recipient found. Enter the amount."),
          recipientPhone: recipient.phone,
          recipientWtsId: recipient.wtsId ?? undefined,
          recipientName: recipient.fullName ?? recipient.username,
        });
      }

      case WTS_FLOW_ACTIONS.CREATE_TRANSFER: {
        const recipientPhone = String(payload.recipientPhone ?? payload.recipient_phone ?? "");
        const amount = parseAmount(payload.amount);
        const escrowEnabled = payload.escrowEnabled === true || payload.escrow_enabled === true || payload.escrow_enabled === "yes";
        if (!recipientPhone || !amount) return fail("REJECTED", tr(lang, "بيانات التحويل غير مكتملة", "Transfer details are incomplete"));
        const limits = await getLimitsConfig(prisma);
        if (amount < limits.minTransfer || amount > limits.maxTransfer) {
          return fail("REJECTED", tr(lang, `المبلغ يجب أن يكون بين ${limits.minTransfer} و ${limits.maxTransfer} جنيه`, `Amount must be between ${limits.minTransfer} and ${limits.maxTransfer} EGP`));
        }
        const auth = await createTransferAuthorization(prisma, { senderId: userId, recipientPhone, amount, escrowEnabled });
        return ok({
          message: tr(lang, "راجع بيانات التحويل ثم اضغط تأكيد.", "Review the transfer details, then tap Confirm."),
          authorizationId: auth.authorizationId,
          amount: auth.amount,
          fee: auth.fee,
          total: auth.total,
          recipientPhone: auth.recipientPhone,
          recipientWtsId: auth.recipientWtsId ?? undefined,
        });
      }

      case WTS_FLOW_ACTIONS.VERIFY_PIN: {
        const pin = String(payload.pin ?? "").trim();
        if (!/^\d{6}$/.test(pin)) return fail("INVALID_PIN", tr(lang, "الرمز السري يجب أن يكون 6 أرقام", "The PIN must be 6 digits"));
        await verifyPin(prisma, { userId, pin, lang });
        return ok({ message: tr(lang, "تم التحقق من الرمز السري.", "PIN verified.") });
      }

      case WTS_FLOW_ACTIONS.CONFIRM_TRANSFER: {
        const authorizationId = String(payload.authorizationId ?? payload.authorization_id ?? "");
        const pin = String(payload.pin ?? "").trim();
        if (!authorizationId) return fail("REJECTED", tr(lang, "لا توجد عملية تحويل قيد التنفيذ", "There is no pending transfer"));
        if (!/^\d{6}$/.test(pin)) return fail("INVALID_PIN", tr(lang, "الرمز السري يجب أن يكون 6 أرقام", "The PIN must be 6 digits"));
        await verifyPin(prisma, { userId, pin, lang });
        const { authorization, transaction, duplicate } = await executeAuthorizedTransfer(prisma, { authorizationId, senderId: userId });
        if (!duplicate) {
          await evaluateReferralEligibility(prisma, userId).catch(() => {});
          await notifyTransferReceived(transaction.id).catch(() => {});
        }
        const balanceAfter = await currentBalance(userId);
        return ok({
          message: duplicate ? tr(lang, "تمت معالجة هذا التحويل مسبقًا.", "This transfer was already processed.") : tr(lang, "تم التحويل بنجاح", "Transfer successful"),
          transactionId: transaction.idempotencyKey,
          amount: transaction.amount,
          fee: transaction.fee,
          total: transaction.totalDebit,
          balanceAfter,
          recipientPhone: authorization.recipientPhone,
          recipientWtsId: authorization.recipientWtsId ?? undefined,
        });
      }

      case WTS_FLOW_ACTIONS.ACCEPT_REQUEST: {
        const requestId = String(payload.requestId ?? payload.request_id ?? "");
        const pin = String(payload.pin ?? "").trim();
        if (!requestId) return fail("REJECTED", tr(lang, "لا يوجد طلب تحويل صالح", "There is no valid money request"));
        if (!/^\d{6}$/.test(pin)) return fail("INVALID_PIN", tr(lang, "الرمز السري يجب أن يكون 6 أرقام", "The PIN must be 6 digits"));
        const { transaction } = await acceptTransferRequest(prisma, { requestId, payerId: userId, pin });
        await notifyTransferReceived(transaction.id).catch(() => {});
        const balanceAfter = await currentBalance(userId);
        return ok({
          message: tr(lang, "تم قبول الطلب وتحويل المبلغ", "Request accepted and the money has been sent"),
          transactionId: transaction.idempotencyKey,
          amount: transaction.amount,
          fee: transaction.fee,
          total: transaction.totalDebit,
          balanceAfter,
        });
      }

      default:
        return fail("ERROR", tr(lang, "إجراء غير معروف", "Unknown action"));
    }
  } catch (err) {
    if (err instanceof TransferRequestError) {
      return fail("REJECTED", err.message);
    }
    const response = errorResponse(err, lang);
    if (action === WTS_FLOW_ACTIONS.CONFIRM_TRANSFER && !response.success) {
      const balanceAfter = await currentBalance(userId).catch(() => undefined);
      if (balanceAfter !== undefined) return { ...response, balanceAfter };
    }
    return response;
  }
}

function shouldNotify(action: string): boolean {
  return [
    WTS_FLOW_ACTIONS.GET_BALANCE,
    WTS_FLOW_ACTIONS.GET_TRANSACTIONS,
    WTS_FLOW_ACTIONS.GET_REFERRALS,
    WTS_FLOW_ACTIONS.CONFIRM_TRANSFER,
  ].includes(action as WtsFlowAction);
}

function buildWhatsAppMessage(action: string, r: WtsActionResponse, lang: Lang): string {
  if (action === WTS_FLOW_ACTIONS.CONFIRM_TRANSFER) {
    if (!r.success) {
      const lines = [
        tr(lang, "\u274C لم يتم تنفيذ التحويل", "\u274C The transfer was not completed"),
        "",
        tr(lang, `السبب: ${r.message}`, `Reason: ${r.message}`),
      ];
      if (r.balanceAfter !== undefined) lines.push(tr(lang, `الرصيد المتاح: ${r.balanceAfter} جنيه`, `Available balance: ${r.balanceAfter} EGP`));
      return lines.join("\n");
    }
    return [
      tr(lang, "\u2705 تم التحويل بنجاح", "\u2705 Transfer successful"),
      "",
      tr(lang, `المبلغ: ${r.amount ?? 0} جنيه`, `Amount: ${r.amount ?? 0} EGP`),
      tr(lang, `الرسوم: ${r.fee ?? 0} جنيه`, `Fee: ${r.fee ?? 0} EGP`),
      tr(lang, `إجمالي الخصم: ${r.total ?? 0} جنيه`, `Total debited: ${r.total ?? 0} EGP`),
      tr(lang, `رقم العملية: ${r.transactionId ?? "-"}`, `Transaction ref: ${r.transactionId ?? "-"}`),
      r.recipientWtsId ? tr(lang, `المستلم: ${r.recipientWtsId}`, `Recipient: ${r.recipientWtsId}`) : "",
      r.balanceAfter !== undefined ? tr(lang, `رصيدك بعد العملية: ${r.balanceAfter} جنيه`, `Your balance after this transfer: ${r.balanceAfter} EGP`) : "",
    ].filter(Boolean).join("\n");
  }

  if (!r.success) return `\u274C ${r.message}`;
  if (action === WTS_FLOW_ACTIONS.GET_BALANCE) return `\u{1F4B0} ${r.message}`;
  if (action === WTS_FLOW_ACTIONS.GET_REFERRALS) return `\u{1F381} ${r.message}`;
  if (action === WTS_FLOW_ACTIONS.GET_TRANSACTIONS) {
    const lines = r.transactions?.map((t, i) => tr(
      lang,
      `${i + 1}. ${t.amount} جنيه ${t.direction === "sent" ? "إلى" : "من"} ${t.other} • ${t.type}`,
      `${i + 1}. ${t.amount} EGP ${t.direction === "sent" ? "to" : "from"} ${t.other} • ${t.type}`
    )) ?? [];
    return [tr(lang, "\u{1F4DC} آخر العمليات", "\u{1F4DC} Recent transactions"), ...lines].join("\n");
  }
  return r.success ? `\u2705 ${r.message}` : `\u274C ${r.message}`;
}

export async function notifyWtsActionResult(userId: string, action: string, r: WtsActionResponse): Promise<void> {
  if (!shouldNotify(action)) return;
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { whatsappPhone: true, phone: true, language: true } });
    const to = (user?.whatsappPhone ?? user?.phone ?? "").replace("+", "");
    if (!to) return;
    await sendTextMessage(to, buildWhatsAppMessage(action, r, normalizeLang(user?.language)));
  } catch (err) {
    logger.error("Failed to send post-action WhatsApp message", err);
  }
}
