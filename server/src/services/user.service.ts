import bcrypt from "bcryptjs";
import type { Db } from "../utils/prisma.js";
import { makeReferralCode, handleSignup } from "./referral.service.js";
import { issueWtsIdentity } from "./registration.service.js";
import { logger } from "../utils/logger.js";

export class AuthError extends Error {
  code: "PHONE_TAKEN" | "INVALID_CREDENTIALS" | "VALIDATION" = "VALIDATION";
  constructor(code: AuthError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

export interface RegisterInput {
  phone: string;
  username: string;
  password: string;
  referralCode?: string | null;
}

export async function register(db: Db, input: RegisterInput) {
  const client: any = db;
  if (input.password.length < 8) throw new AuthError("VALIDATION", "Password must be at least 8 characters.");
  if (!/^\+?[0-9]{8,15}$/.test(input.phone.replace(/[\s\-()]/g, ""))) {
    throw new AuthError("VALIDATION", "Invalid phone number.");
  }
  const phone = input.phone.replace(/[\s\-()]/g, "");
  const existing = await client.user.findUnique({ where: { phone } });
  if (existing) throw new AuthError("PHONE_TAKEN", "An account with this phone number already exists.");

  const passwordHash = await bcrypt.hash(input.password, 12);

  const user = await client.$transaction(async (tx: any) => {
    // Unique referral code with collision retry
    let code = makeReferralCode(phone);
    for (let i = 0; i < 5; i++) {
      const clash = await tx.user.findUnique({ where: { referralCode: code } });
      if (!clash) break;
      code = makeReferralCode(phone) + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
    }
    // Website registrations are pre-verified demo accounts with full identity.
    const { wtsId, walletId } = await issueWtsIdentity(tx);
    return tx.user.create({
      data: {
        phone,
        username: input.username.trim(),
        passwordHash,
        referralCode: code,
        referredById: null,
        demoBalance: 0,
        verificationStatus: "VERIFIED",
        transfersEnabled: true,
        wtsId,
        walletId,
        fullName: input.username.trim(),
      },
    });
  });

  await handleSignup(client, { userId: user.id, phone, referralCodeUsed: input.referralCode ?? null });
  logger.info("User registered", { userId: user.id, phone });
  return { id: user.id, phone: user.phone, username: user.username, referralCode: user.referralCode };
}

export async function login(db: Db, input: { phone: string; password: string }) {
  const client: any = db;
  const phone = input.phone.replace(/[\s\-()]/g, "");
  const user = await client.user.findUnique({ where: { phone } });
  if (!user) throw new AuthError("INVALID_CREDENTIALS", "Invalid phone or password.");
  const ok = await bcrypt.compare(input.password, user.passwordHash);
  if (!ok) throw new AuthError("INVALID_CREDENTIALS", "Invalid phone or password.");
  if (user.status !== "ACTIVE") throw new AuthError("INVALID_CREDENTIALS", "Account is frozen. Contact support.");
  return {
    id: user.id,
    phone: user.phone,
    username: user.username,
    role: user.role,
    referralCode: user.referralCode,
  };
}
