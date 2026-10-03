import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

function makeReferralCode(phone: string): string {
  return "WTS-" + phone.replace(/\D/g, "").slice(-6);
}

async function main() {
  const adminPass = await bcrypt.hash("AdminDemo123!", 10);
  const userPass = await bcrypt.hash("UserDemo123!", 10);

  await prisma.user.upsert({
    where: { phone: "+201000000001" },
    update: {},
    create: {
      phone: "+201000000001",
      username: "WTS Admin",
      passwordHash: adminPass,
      role: "ADMIN",
      referralCode: "WTS-ADMIN1",
      demoBalance: 0,
      verificationStatus: "VERIFIED",
      wtsId: "WTS-000001",
      walletId: "WALLET-000001",
    },
  });

  await prisma.user.upsert({
    where: { phone: "+201000000002" },
    update: {},
    create: {
      phone: "+201000000002",
      username: "Demo User",
      passwordHash: userPass,
      referralCode: makeReferralCode("+201000000002"),
      demoBalance: 500,
      verificationStatus: "VERIFIED",
      wtsId: "WTS-000002",
      walletId: "WALLET-000002",
      fullName: "Demo User One Two",
    },
  });

  await prisma.user.upsert({
    where: { phone: "+201000000003" },
    update: {},
    create: {
      phone: "+201000000003",
      username: "Demo User 2",
      passwordHash: userPass,
      referralCode: makeReferralCode("+201000000003"),
      demoBalance: 500,
      verificationStatus: "VERIFIED",
      wtsId: "WTS-000003",
      walletId: "WALLET-000003",
      fullName: "Demo User Two Three",
    },
  });

  const defaults: Record<string, unknown> = {
    fee: { mode: "per_thousand_ceiling", divisor: 1000 },
    signupReward: { amount: 50, enabled: true },
    referralReward: { amount: 25, enabled: true },
    referral: {
      requiredReferrals: 1,
      minTransactions: 1,
      maxRewardPerUser: 500,
      campaignStart: null,
      campaignEnd: null,
      campaignEnabled: true,
    },
    security: {
      pinMaxAttempts: 5,          // failed PIN tries before lockout
      pinLockMinutes: 15,         // temporary lock duration
      authorizationTtlMinutes: 5, // transfer authorization expiry
    },
    limits: { minTransfer: 1, maxTransfer: 100000 },
    maintenanceMode: { enabled: false, message: "WTS Pay is under maintenance. Please try again soon." },
    approval: { initialBalance: 0 },     // demo credits granted at approval
    counters: { wtsSeq: 3, walletSeq: 3 }, // last issued WTS/WALLET sequence
  };
  for (const [key, value] of Object.entries(defaults)) {
    await prisma.config.upsert({ where: { key }, update: {}, create: { key, value } });
  }

  console.log("Seed complete:");
  console.log("  Admin login: +201000000001 / AdminDemo123!");
  console.log("  User login : +201000000002 / UserDemo123!");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
