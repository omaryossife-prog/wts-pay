import type { Request, Response } from "express";
import { prisma } from "../utils/prisma.js";
import { getReferralConfig, getReferralRewardConfig, getSignupRewardConfig } from "../services/config.service.js";

export async function referralOverviewController(req: Request, res: Response) {
  const userId = req.user!.userId;
  const [referrals, rewardedCount, totalEarned] = await Promise.all([
    prisma.referral.findMany({
      where: { referrerId: userId },
      include: { referred: { select: { phone: true, username: true, createdAt: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.referral.count({ where: { referrerId: userId, status: "REWARDED" } }),
    prisma.transaction.aggregate({
      where: { receiverId: userId, type: { in: ["SIGNUP_REWARD", "REFERRAL_REWARD"] }, status: "COMPLETED" },
      _sum: { amount: true },
    }),
  ]);
  const [signup, referralReward, cfg] = await Promise.all([
    getSignupRewardConfig(prisma),
    getReferralRewardConfig(prisma),
    getReferralConfig(prisma),
  ]);
  res.json({
    referralCode: (await prisma.user.findUnique({ where: { id: userId }, select: { referralCode: true } }))!.referralCode,
    referrals,
    rewardedCount,
    totalEarned: totalEarned._sum.amount ?? 0,
    rules: {
      signupReward: signup,
      referralReward,
      minTransactionsToActivate: cfg.minTransactions,
      maxRewardPerUser: cfg.maxRewardPerUser,
      campaignEnabled: cfg.campaignEnabled,
    },
  });
}
