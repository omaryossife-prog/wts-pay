import type { Request, Response } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "../utils/prisma.js";
import { transfer } from "../services/wallet.service.js";
import { evaluateReferralEligibility } from "../services/referral.service.js";
import { computeFee } from "../services/fee.service.js";
import { maskPhone } from "../utils/phone-mask.js";
import { setPin, PinError } from "../services/pin.service.js";

export const setPinSchema = z.object({
  password: z.string().min(1),
  pin: z.string().length(6),
});

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
      transfersEnabled: true, pinHash: true,
    },
  });
  const { pinHash, ...safeUser } = user ?? {};
  res.json({
    user: { ...safeUser, pinSet: !!pinHash },
    notice: "Demo Balance — No Cash Value. Demo credits cannot be withdrawn or exchanged for real money.",
  });
}

export async function setPinController(req: Request, res: Response) {
  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  if (!user) throw new PinError("PIN_NOT_SET", "Account not found.");
  const ok = await bcrypt.compare(req.body.password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: "Incorrect password.", code: "INVALID_PASSWORD" });
  }
  await setPin(prisma, { userId: req.user!.userId, pin: req.body.pin, ip: req.ip });
  res.json({ ok: true });
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

  // نخفي رقم الطرف التاني بس — رقم المستخدم نفسه يفضل ظاهر كامل.
  const masked = items.map((t) => {
    const isSender = t.senderId === req.user!.userId;
    return {
      ...t,
      sender: t.sender ? { ...t.sender, phone: isSender ? t.sender.phone : maskPhone(t.sender.phone) } : t.sender,
      receiver: t.receiver ? { ...t.receiver, phone: isSender ? maskPhone(t.receiver.phone) : t.receiver.phone } : t.receiver,
    };
  });

  res.json({ items: masked, total, page, limit });
}
