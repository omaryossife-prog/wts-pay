import type { Request, Response } from "express";
import { prisma } from "../utils/prisma.js";
import { getReferralConfig, getReferralRewardConfig, getSignupRewardConfig } from "../services/config.service.js";
import { HttpError } from "../middleware/errorHandler.js";

export async function referralOverviewController(req: Request, res: Response) {
  const userId = req.user!.userId;
  // جيب المستخدم الأول — لو مش موجود نرمي 404 بدل ما نقع بـ TypeError
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { referralCode: true },
  });
  if (!user) {
    throw new HttpError(404, "User not found");
  }
  const [referrals, rewardedCount, totalEarned, signup, referralReward, cfg] =
    await Promise.all([
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
      getSignupRewardConfig(prisma),
      getReferralRewardConfig(prisma),
      getReferralConfig(prisma),
    ]);
  res.json({
    referralCode: user.referralCode,
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
