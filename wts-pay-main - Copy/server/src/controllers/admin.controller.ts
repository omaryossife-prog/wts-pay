import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../utils/prisma.js";
import { adjustBalance, reverseReward, setFrozen, setTransfersEnabled } from "../services/wallet.service.js";
import { setConfig, getReferralConfig, getSignupRewardConfig, getReferralRewardConfig, getSecurityConfig, getLimitsConfig, getMaintenanceConfig } from "../services/config.service.js";
import { logAudit } from "../services/audit.service.js";
import { getFeeConfig } from "../services/fee.service.js";
import { pendingVerifications, approveRegistration, rejectRegistration } from "../services/registration.service.js";
import { adminResetPin } from "../services/pin.service.js";
import { notifyFreeze, notifyApproval, notifyRejection } from "../whatsapp/whatsapp.service.js";

export const adjustSchema = z.object({
  userId: z.string().uuid(),
  amount: z.number().int().min(-1_000_000).max(1_000_000).refine((v) => v !== 0, "Amount cannot be 0"),
  reason: z.string().min(3).max(300),
  idempotencyKey: z.string().min(8).max(100),
});

export const freezeSchema = z.object({ userId: z.string().uuid() });

export const transfersSchema = z.object({
  userId: z.string().uuid(),
  enabled: z.boolean(),
});

export const approveSchema = z.object({ userId: z.string().uuid() });

export const rejectSchema = z.object({
  userId: z.string().uuid(),
  reason: z.string().min(3).max(300),
});

export const configSchema = z.object({
  key: z.enum(["fee", "signupReward", "referralReward", "referral", "security", "limits", "maintenanceMode", "approval"]),
  value: z.record(z.unknown()),
});

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------
export async function statsController(_req: Request, res: Response) {
  const [
    totalUsers, activeUsers, frozenUsers, pendingReview, balanceAgg,
    transferAgg, transferCount, referrals, rewardedReferrals, rewardsAgg,
    suspicious,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { status: "ACTIVE" } }),
    prisma.user.count({ where: { status: "FROZEN" } }),
    prisma.user.count({ where: { verificationStatus: "PENDING_REVIEW" } }),
    prisma.user.aggregate({ _sum: { demoBalance: true } }),
    prisma.transaction.aggregate({ where: { type: "TRANSFER", status: "COMPLETED" }, _sum: { amount: true } }),
    prisma.transaction.count({ where: { type: "TRANSFER", status: "COMPLETED" } }),
    prisma.referral.count(),
    prisma.referral.count({ where: { status: "REWARDED" } }),
    prisma.transaction.aggregate({
      where: { type: { in: ["SIGNUP_REWARD", "REFERRAL_REWARD"] }, status: "COMPLETED" },
      _sum: { amount: true }, _count: true,
    }),
    prisma.auditLog.count({ where: { action: { contains: "FLAG" } } }),
  ]);
  res.json({
    totalUsers, activeUsers, frozenUsers, pendingReview,
    demoBalanceInCirculation: balanceAgg._sum.demoBalance ?? 0,
    transferVolume: transferAgg._sum.amount ?? 0,
    transfersCount: transferCount,
    totalReferrals: referrals,
    rewardedReferrals,
    totalRewardsPaid: rewardsAgg._sum.amount ?? 0,
    rewardsCount: rewardsAgg._count ?? 0,
    suspiciousAccounts: suspicious,
  });
}

// ---------------------------------------------------------------------------
// Verification review (metadata only - media is reviewed inside WhatsApp)
// ---------------------------------------------------------------------------
export async function pendingVerificationsController(_req: Request, res: Response) {
  const items = await pendingVerifications(prisma);
  // Provide a direct link to open the WhatsApp conversation for manual review.
  const enriched = items.map((u) => ({
    ...u,
    whatsappConversationUrl: u.whatsappPhone ? `https://wa.me/${u.whatsappPhone.replace(/\D/g, "")}` : null,
  }));
  res.json({ items: enriched });
}

export async function approveController(req: Request, res: Response) {
  const updated = await approveRegistration(prisma, {
    adminId: req.user!.userId,
    userId: req.body.userId,
    ip: req.ip,
  });
  if (updated.whatsappPhone) {
    await notifyApproval(updated.whatsappPhone, updated.wtsId!, updated.walletId!, updated.demoBalance).catch(() => {});
  }
  res.json({ id: updated.id, wtsId: updated.wtsId, walletId: updated.walletId, status: updated.verificationStatus, balance: updated.demoBalance });
}

export async function rejectController(req: Request, res: Response) {
  const updated = await rejectRegistration(prisma, {
    adminId: req.user!.userId,
    userId: req.body.userId,
    reason: req.body.reason,
    ip: req.ip,
  });
  if (updated.whatsappPhone) {
    await notifyRejection(updated.whatsappPhone, req.body.reason).catch(() => {});
  }
  res.json({ id: updated.id, status: updated.verificationStatus });
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
export async function searchUsersController(req: Request, res: Response) {
  const q = String(req.query.q ?? "").trim();
  const select = {
    id: true, phone: true, username: true, status: true, demoBalance: true,
    referralCode: true, referralCount: true, createdAt: true, role: true,
    wtsId: true, walletId: true, fullName: true, verificationStatus: true,
    transfersEnabled: true, waId: true, whatsappPhone: true,
  } as const;
  const users = q
    ? await prisma.user.findMany({
        where: {
          OR: [
            { phone: { contains: q } },
            { username: { contains: q, mode: "insensitive" } },
            { fullName: { contains: q, mode: "insensitive" } },
            { referralCode: { contains: q, mode: "insensitive" } },
            { wtsId: { contains: q, mode: "insensitive" } },
          ],
        },
        select, take: 50, orderBy: { createdAt: "desc" },
      })
    : await prisma.user.findMany({ select, take: 50, orderBy: { createdAt: "desc" } });
  res.json({ users });
}

export async function userProfileController(req: Request, res: Response) {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: {
      id: true, phone: true, username: true, status: true, demoBalance: true,
      referralCode: true, referralCount: true, totalEarned: true, role: true,
      createdAt: true, whatsappPhone: true, waId: true,
      wtsId: true, walletId: true, fullName: true, verificationStatus: true,
      idSubmitted: true, idReceivedAt: true, faceVideoSubmitted: true,
      faceVideoReceivedAt: true, rejectionReason: true, reviewedAt: true,
      pinFailedAttempts: true, pinLockedUntil: true, transfersEnabled: true,
      pinHash: true,
    },
  });
  if (!user) return res.status(404).json({ error: "User not found" });
  const [transactions, referrals, auditLogs] = await Promise.all([
    prisma.transaction.findMany({ where: { OR: [{ senderId: user.id }, { receiverId: user.id }] }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.referral.findMany({ where: { referrerId: user.id }, include: { referred: { select: { phone: true, username: true } } } }),
    prisma.auditLog.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  res.json({ user, transactions, referrals, auditLogs });
}

export async function freezeController(req: Request, res: Response) {
  const result = await setFrozen(prisma, {
    adminId: req.user!.userId,
    userId: req.body.userId,
    frozen: true,
    ip: req.ip,
    notify: async (user, frozen) => {
      if (user.whatsappPhone) await notifyFreeze(user.whatsappPhone, frozen);
    },
  });
  res.json(result);
}

export async function unfreezeController(req: Request, res: Response) {
  const result = await setFrozen(prisma, {
    adminId: req.user!.userId,
    userId: req.body.userId,
    frozen: false,
    ip: req.ip,
    notify: async (user, frozen) => {
      if (user.whatsappPhone) await notifyFreeze(user.whatsappPhone, frozen);
    },
  });
  res.json(result);
}

export async function setTransfersController(req: Request, res: Response) {
  const result = await setTransfersEnabled(prisma, {
    adminId: req.user!.userId,
    userId: req.body.userId,
    enabled: req.body.enabled,
    ip: req.ip,
  });
  res.json(result);
}

export async function resetPinController(req: Request, res: Response) {
  await adminResetPin(prisma, { adminId: req.user!.userId, userId: req.body.userId, ip: req.ip });
  res.json({ ok: true });
}

// ---------------------------------------------------------------------------
// Adjustments & reversal
// ---------------------------------------------------------------------------
export async function adjustController(req: Request, res: Response) {
  const tx = await adjustBalance(prisma, {
    adminId: req.user!.userId,
    userId: req.body.userId,
    amount: req.body.amount,
    reason: req.body.reason,
    idempotencyKey: req.body.idempotencyKey,
    ip: req.ip,
  });
  res.status(201).json({ transaction: tx });
}

export async function reverseController(req: Request, res: Response) {
  const reversal = await reverseReward(prisma, {
    adminId: req.user!.userId,
    transactionId: req.body.transactionId,
    reason: req.body.reason,
    idempotencyKey: req.body.idempotencyKey,
    ip: req.ip,
  });
  res.status(201).json({ reversal });
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
export async function getConfigController(_req: Request, res: Response) {
  const [fee, signupReward, referralReward, referral, security, limits, maintenanceMode, approval] = await Promise.all([
    getFeeConfig(prisma),
    getSignupRewardConfig(prisma),
    getReferralRewardConfig(prisma),
    getReferralConfig(prisma),
    getSecurityConfig(prisma),
    getLimitsConfig(prisma),
    getMaintenanceConfig(prisma),
    (async () => (await prisma.config.findUnique({ where: { key: "approval" } }))?.value ?? { initialBalance: 0 })(),
  ]);
  res.json({ fee, signupReward, referralReward, referral, security, limits, maintenanceMode, approval });
}

export async function setConfigController(req: Request, res: Response) {
  await setConfig(prisma, req.body.key, req.body.value);
  const actionByKey: Record<string, string> = {
    fee: "FEE_SETTING_CHANGED",
    referralReward: "REFERRAL_SETTING_CHANGED",
    referral: "REFERRAL_SETTING_CHANGED",
    signupReward: "REFERRAL_SETTING_CHANGED",
  };
  await logAudit(prisma, {
    adminId: req.user!.userId,
    action: actionByKey[req.body.key] ?? "SYSTEM_CONFIG_CHANGED",
    ip: req.ip,
    detail: { key: req.body.key, value: req.body.value },
  });
  res.json({ ok: true });
}

// ---------------------------------------------------------------------------
// Audit & transactions
// ---------------------------------------------------------------------------
export async function auditController(_req: Request, res: Response) {
  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { admin: { select: { username: true } }, user: { select: { phone: true } } },
  });
  res.json({ logs });
}

export async function allTransactionsController(req: Request, res: Response) {
  const where = req.query.type ? { type: String(req.query.type) } : {};
  const items = await prisma.transaction.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      sender: { select: { phone: true, wtsId: true } },
      receiver: { select: { phone: true, wtsId: true } },
    },
  });
  res.json({ items });
}
