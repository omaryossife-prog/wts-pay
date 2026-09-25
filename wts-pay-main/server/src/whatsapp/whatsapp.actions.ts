// ---------------------------------------------------------------------------
// Unified WhatsApp Flow action layer. This module is the ONLY bridge between
// WhatsApp Flow data-exchange payloads and the existing WTS services.
// It never invents parallel wallet logic: reads use the same Prisma models,
// transfers use transaction authorization + PIN verification + wallet ledger.
// ---------------------------------------------------------------------------
import { prisma } from "../utils/prisma.js";
import { getLimitsConfig, getMaintenanceConfig } from "../services/config.service.js";
import { evaluateReferralEligibility } from "../services/referral.service.js";
import { createTransferAuthorization, executeAuthorizedTransfer } from "../services/txauth.service.js";
import { verifyPin, PinError } from "../services/pin.service.js";
import { WalletError } from "../services/wallet.service.js";
import { normalizeWaPhone } from "../services/registration.service.js";
import { sendTextMessage } from "./whatsapp.client.js";
import { logger } from "../utils/logger.js";

export const WTS_FLOW_ACTIONS = {
  GET_BALANCE: "GET_BALANCE",
  SEND_MONEY: "SEND_MONEY",
  CREATE_TRANSFER: "CREATE_TRANSFER",
  CONFIRM_TRANSFER: "CONFIRM_TRANSFER",
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

function errorResponse(err: unknown): WtsActionResponse {
  if (err instanceof WalletError) {
    switch (err.code) {
      case "INSUFFICIENT_BALANCE":
        return fail("INSUFFICIENT_BALANCE", "الرصيد غير كافٍ");
      case "ACCOUNT_FROZEN":
        return fail("REJECTED", "الحساب مجمد");
      case "ACCOUNT_UNVERIFIED":
        return fail("REJECTED", "الحساب غير موثق");
      case "TRANSFERS_DISABLED":
        return fail("REJECTED", "التحويلات متوقفة لهذا الحساب");
      case "SELF_TRANSFER":
        return fail("REJECTED", "لا يمكن الإرسال إلى نفسك");
      case "USER_NOT_FOUND":
        return fail("REJECTED", "لم يتم العثور على المستخدم");
      case "INVALID_AMOUNT":
        return fail("REJECTED", "المبلغ غير صالح");
      case "LIMIT_EXCEEDED":
        return fail("REJECTED", "المبلغ خارج الحدود المسموحة");
      default:
        return fail("ERROR", "حدث خطأ، حاول مرة أخرى");
    }
  }
  if (err instanceof PinError) {
    if (err.code === "PIN_INVALID" || err.code === "PIN_WEAK") return fail("INVALID_PIN", "الرمز السري غير صحيح");
    if (err.code === "PIN_LOCKED") return fail("INVALID_PIN", "تم قفل الرمز السري مؤقتًا");
    return fail("INVALID_PIN", "لا يوجد رمز سري مفعّل");
  }
  const maybe = err as { code?: string; message?: string } | null;
  if (maybe?.code?.startsWith("AUTH_")) return fail("REJECTED", "العملية لم تعد صالحة أو انتهت صلاحيتها");
  logger.error("WTS Flow action failed", err);
  return fail("ERROR", "حدث خطأ، حاول مرة أخرى");
}

async function getActor(userId: string) {
  const maintenance = await getMaintenanceConfig(prisma);
  if (maintenance.enabled) return fail("REJECTED", maintenance.message || "النظام في وضع الصيانة حاليًا") as const;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return fail("ERROR", "الحساب غير موجود") as const;
  if (user.status !== "ACTIVE") return fail("REJECTED", "الحساب مجمد") as const;
  if (user.verificationStatus !== "VERIFIED") return fail("REJECTED", "الحساب غير موثق") as const;
  if (user.transfersEnabled === false) return fail("REJECTED", "التحويلات متوقفة لهذا الحساب") as const;
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
  const actor = await getActor(userId);
  if ("status" in actor) return actor as WtsActionResponse;
  const user = actor.user;

  try {
    switch (action as WtsFlowAction) {
      case WTS_FLOW_ACTIONS.GET_BALANCE: {
        return ok({ message: `رصيدك الحالي: ${user.demoBalance} جنيه`, balanceAfter: user.demoBalance });
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
        return ok({ message: txs.length ? `تم جلب آخر ${txs.length} عمليات.` : "لا توجد عمليات بعد.", transactions });
      }

      case WTS_FLOW_ACTIONS.GET_REFERRALS: {
        const rewarded = await prisma.referral.count({ where: { referrerId: userId, status: "REWARDED" } });
        return ok({
          message: `كود الإحالة: ${user.referralCode} • المدعوون: ${user.referralCount} • المكتملون: ${rewarded}`,
          referralCode: user.referralCode,
          invited: user.referralCount,
          rewarded,
        });
      }

      case WTS_FLOW_ACTIONS.SEND_MONEY: {
        const rawPhone = cleanPhone(payload.recipientPhone ?? payload.recipient_phone);
        const lookup = normalizeWaPhone(rawPhone.replace("+", ""));
        const recipient = await prisma.user.findUnique({ where: { phone: lookup } });
        if (!recipient) return fail("REJECTED", "لا يوجد مستخدم WTS بهذا الرقم");
        if (recipient.id === user.id) return fail("REJECTED", "لا يمكن الإرسال إلى نفسك");
        if (recipient.status !== "ACTIVE") return fail("REJECTED", "حساب المستلم مجمد");
        if (recipient.verificationStatus !== "VERIFIED") return fail("REJECTED", "حساب المستلم غير موثق");
        if (recipient.transfersEnabled === false) return fail("REJECTED", "حساب المستلم لا يستقبل تحويلات الآن");
        return ok({
          message: "تم العثور على المستلم. أدخل المبلغ.",
          recipientPhone: recipient.phone,
          recipientWtsId: recipient.wtsId ?? undefined,
          recipientName: recipient.fullName ?? recipient.username,
        });
      }

      case WTS_FLOW_ACTIONS.CREATE_TRANSFER: {
        const recipientPhone = String(payload.recipientPhone ?? payload.recipient_phone ?? "");
        const amount = parseAmount(payload.amount);
        if (!recipientPhone || !amount) return fail("REJECTED", "بيانات التحويل غير مكتملة");
        const limits = await getLimitsConfig(prisma);
        if (amount < limits.minTransfer || amount > limits.maxTransfer) {
          return fail("REJECTED", `المبلغ يجب أن يكون بين ${limits.minTransfer} و ${limits.maxTransfer} جنيه`);
        }
        const auth = await createTransferAuthorization(prisma, { senderId: userId, recipientPhone, amount });
        return ok({
          message: "راجع بيانات التحويل ثم اضغط تأكيد.",
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
        if (!/^\d{6}$/.test(pin)) return fail("INVALID_PIN", "الرمز السري يجب أن يكون 6 أرقام");
        await verifyPin(prisma, { userId, pin });
        return ok({ message: "تم التحقق من الرمز السري." });
      }

      case WTS_FLOW_ACTIONS.CONFIRM_TRANSFER: {
        const authorizationId = String(payload.authorizationId ?? payload.authorization_id ?? "");
        const pin = String(payload.pin ?? "").trim();
        if (!authorizationId) return fail("REJECTED", "لا توجد عملية تحويل قيد التنفيذ");
        if (!/^\d{6}$/.test(pin)) return fail("INVALID_PIN", "الرمز السري يجب أن يكون 6 أرقام");
        await verifyPin(prisma, { userId, pin });
        const { authorization, transaction, duplicate } = await executeAuthorizedTransfer(prisma, { authorizationId, senderId: userId });
        if (!duplicate) await evaluateReferralEligibility(prisma, userId).catch(() => {});
        const balanceAfter = await currentBalance(userId);
        return ok({
          message: duplicate ? "تمت معالجة هذا التحويل مسبقًا." : "تم التحويل بنجاح",
          transactionId: transaction.idempotencyKey,
          amount: transaction.amount,
          fee: transaction.fee,
          total: transaction.totalDebit,
          balanceAfter,
          recipientPhone: authorization.recipientPhone,
          recipientWtsId: authorization.recipientWtsId ?? undefined,
        });
      }

      default:
        return fail("ERROR", "إجراء غير معروف");
    }
  } catch (err) {
    const response = errorResponse(err);
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

function buildWhatsAppMessage(action: string, r: WtsActionResponse): string {
  if (action === WTS_FLOW_ACTIONS.CONFIRM_TRANSFER) {
    if (!r.success) {
      const lines = ["❌ لم يتم تنفيذ التحويل", "", `السبب: ${r.message}`];
      if (r.balanceAfter !== undefined) lines.push(`الرصيد المتاح: ${r.balanceAfter} جنيه`);
      return lines.join("\n");
    }
    return [
      "✅ تم التحويل بنجاح",
      "",
      `المبلغ: ${r.amount ?? 0} جنيه`,
      `الرسوم: ${r.fee ?? 0} جنيه`,
      `إجمالي الخصم: ${r.total ?? 0} جنيه`,
      `رقم العملية: ${r.transactionId ?? "-"}`,
      r.recipientWtsId ? `المستلم: ${r.recipientWtsId}` : "",
      r.balanceAfter !== undefined ? `رصيدك بعد العملية: ${r.balanceAfter} جنيه` : "",
    ].filter(Boolean).join("\n");
  }

  if (!r.success) return `❌ ${r.message}`;
  if (action === WTS_FLOW_ACTIONS.GET_BALANCE) return `💰 ${r.message}`;
  if (action === WTS_FLOW_ACTIONS.GET_REFERRALS) return `🎁 ${r.message}`;
  if (action === WTS_FLOW_ACTIONS.GET_TRANSACTIONS) {
    const lines = r.transactions?.map((t, i) => `${i + 1}. ${t.amount} جنيه ${t.direction === "sent" ? "إلى" : "من"} ${t.other} • ${t.type}`) ?? [];
    return ["📜 آخر العمليات", ...lines].join("\n");
  }
  return r.success ? `✅ ${r.message}` : `❌ ${r.message}`;
}

export async function notifyWtsActionResult(userId: string, action: string, r: WtsActionResponse): Promise<void> {
  if (!shouldNotify(action)) return;
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { whatsappPhone: true, phone: true } });
    const to = (user?.whatsappPhone ?? user?.phone ?? "").replace("+", "");
    if (!to) return;
    await sendTextMessage(to, buildWhatsAppMessage(action, r));
  } catch (err) {
    logger.error("Failed to send post-action WhatsApp message", err);
  }
}
