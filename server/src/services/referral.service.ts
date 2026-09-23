import type { Db } from "../utils/prisma.js";
import {
  getReferralConfig,
  getReferralRewardConfig,
  getSignupRewardConfig,
  campaignActive,
} from "./config.service.js";
import { creditReward } from "./wallet.service.js";
import { logAudit } from "./audit.service.js";
import { logger } from "../utils/logger.js";

function makeReferralCode(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return "WTS-" + digits.slice(-6).toUpperCase();
}

// ---------------------------------------------------------------------------
// Called once at registration. Links referred user to referrer (PENDING) and
// grants the configurable signup reward. Rewards go through the ledger.
// ---------------------------------------------------------------------------
export async function handleSignup(db: Db, input: { userId: string; phone: string; referralCodeUsed?: string | null }) {
  const client: any = db;
  await client.$transaction(async (tx: any) => {
    if (input.referralCodeUsed) {
      const code = input.referralCodeUsed.trim().toUpperCase();
      const referrer = await tx.user.findUnique({ where: { referralCode: code } });
      if (referrer && referrer.id !== input.userId) {
        const existing = await tx.referral.findUnique({ where: { referredId: input.userId } });
        if (!existing) {
          await tx.referral.create({
            data: { referrerId: referrer.id, referredId: input.userId, status: "PENDING" },
          });
          await tx.user.update({ where: { id: referrer.id }, data: { referralCount: { increment: 1 } } });
        }
      } else if (referrer && referrer.id === input.userId) {
        await logAudit(tx, { userId: input.userId, action: "REFERRAL_SELF_USE_FLAGGED", detail: { code } });
      }
    }
  });

  const signupCfg = await getSignupRewardConfig(client);
  if (signupCfg.enabled && signupCfg.amount > 0 && (await campaignActive(client))) {
    await creditReward(client, {
      userId: input.userId,
      amount: signupCfg.amount,
      type: "SIGNUP_REWARD",
      idempotencyKey: `signup:${input.userId}`,
      description: "Signup reward",
    });
  }
}

// ---------------------------------------------------------------------------
// Anti-abuse: a referral only becomes eligible (and pays out) after the
// referred user meets configurable activation requirements (e.g. completed at
// least one eligible internal transaction) and the referrer is under the
// per-user reward cap. Never rewards unlimited self-created accounts.
// ---------------------------------------------------------------------------
export async function evaluateReferralEligibility(db: Db, referredUserId: string) {
  const client: any = db;
  await client.$transaction(async (tx: any) => {
    const referral = await tx.referral.findUnique({
      where: { referredId: referredUserId },
      include: { referrer: true, referred: true },
    });
    if (!referral || referral.status !== "PENDING") return;

    const cfg = await getReferralConfig(tx);
    if (!(await campaignActive(tx))) return;

    const completedTx = await tx.transaction.count({
      where: { senderId: referredUserId, type: "TRANSFER", status: "COMPLETED" },
    });
    const uniquePhone = referral.referred.phone && referral.referrer.phone !== referral.referred.phone;
    const active = referral.referred.status === "ACTIVE" && referral.referrer.status === "ACTIVE";
    const meetsTx = completedTx >= cfg.minTransactions;

    if (uniquePhone && active && meetsTx) {
      await tx.referral.update({ where: { id: referral.id }, data: { status: "ELIGIBLE" } });
      await payoutReferralReward(tx, referral.referrer, referral.referred);
    } else if (!uniquePhone) {
      await tx.referral.update({ where: { id: referral.id }, data: { status: "REJECTED" } });
      await logAudit(tx, {
        userId: referral.referrerId,
        action: "REFERRAL_REJECTED_DUPLICATE_PHONE",
        detail: { referredId: referredUserId },
      });
    }
  });
}

async function payoutReferralReward(tx: any, referrer: any, referred: any) {
  const rewardCfg = await getReferralRewardConfig(tx);
  const cfg = await getReferralConfig(tx);
  if (!rewardCfg.enabled || rewardCfg.amount <= 0) return;

  // Cap: lifetime rewards per user
  if (referrer.totalEarned + rewardCfg.amount > cfg.maxRewardPerUser) {
    await logAudit(tx, {
      userId: referrer.id,
      action: "REFERRAL_REWARD_CAPPED",
      detail: { totalEarned: referrer.totalEarned, attempted: rewardCfg.amount, cap: cfg.maxRewardPerUser },
    });
    return;
  }

  await creditReward(tx, {
    userId: referrer.id,
    amount: rewardCfg.amount,
    type: "REFERRAL_REWARD",
    idempotencyKey: `referral:${referred.id}`,
    description: `Referral reward for inviting ${referred.phone}`,
  });
  await tx.user.update({ where: { id: referrer.id }, data: { totalEarned: { increment: rewardCfg.amount } } });
  await tx.referral.update({ where: { referredId: referred.id }, data: { status: "REWARDED", rewardedAt: new Date() } });
  logger.info("Referral reward paid", { referrer: referrer.id, referred: referred.id });
}

export { makeReferralCode };
