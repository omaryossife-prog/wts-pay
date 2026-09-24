import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../utils/prisma.js";
import { transfer } from "../services/wallet.service.js";
import { evaluateReferralEligibility } from "../services/referral.service.js";
import { computeFee } from "../services/fee.service.js";
import { HttpError } from "../middleware/errorHandler.js";

export const transferSchema = z.object({
  recipientPhone: z.string().min(8).max(20),
  amount: z.number().int().positive().max(1_000_000),
  description: z.string().max(200).optional(),
});

export const quoteSchema = z.object({
  amount: z.number().int().positive().max(1_000_000),
});

export async function getWalletController(req: Request, res: Response) {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    select: {
      id: true, phone: true, username: true, demoBalance: true,
      referralCode: true, referralCount: true, status: true, createdAt: true,
      wtsId: true, walletId: true, fullName: true, verificationStatus: true,
      transfersEnabled: true,
    },
  });
  if (!user) {
    throw new HttpError(404, "User not found");
  }
  res.json({ user, notice: "Demo Balance — No Cash Value. Demo credits cannot be withdrawn or exchanged for real money." });
}

export async function quoteController(req: Request, res: Response) {
  const { fee, totalDebit } = await computeFee(prisma, req.body.amount);
  res.json({ amount: req.body.amount, fee, totalDebit });
}

export async function transferController(req: Request, res: Response) {
  const { transaction, duplicate } = await transfer(prisma, {
    senderId: req.user!.userId,
    recipientPhone: req.body.recipientPhone,
    amount: req.body.amount,
    idempotencyKey: req.idempotencyKey!,
    description: req.body.description,
  });
  // Referral activation hook: a completed transfer may make a referral eligible.
  if (!duplicate) {
    await evaluateReferralEligibility(prisma, req.user!.userId).catch(() => {});
  }
  res.status(duplicate ? 200 : 201).json({ transaction, duplicate });
}

export async function transactionsController(req: Request, res: Response) {
  const page = Math.max(1, Number(req.query.page ?? 1));
  const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 20)));
  const [items, total] = await Promise.all([
    prisma.transaction.findMany({
      where: { OR: [{ senderId: req.user!.userId }, { receiverId: req.user!.userId }] },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        sender: { select: { phone: true, username: true } },
        receiver: { select: { phone: true, username: true } },
      },
    }),
    prisma.transaction.count({
      where: { OR: [{ senderId: req.user!.userId }, { receiverId: req.user!.userId }] },
    }),
  ]);
  res.json({ items, total, page, limit });
}
