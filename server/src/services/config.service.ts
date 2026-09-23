import type { Db } from "../utils/prisma.js";

export interface ReferralConfig {
  requiredReferrals: number;
  minTransactions: number;
  maxRewardPerUser: number;
  campaignStart: string | null;
  campaignEnd: string | null;
  campaignEnabled: boolean;
}

export interface RewardConfig {
  amount: number;
  enabled: boolean;
}

export interface SecurityConfig {
  pinMaxAttempts: number;
  pinLockMinutes: number;
  authorizationTtlMinutes: number;
}

export interface LimitsConfig {
  minTransfer: number;
  maxTransfer: number;
}

export interface MaintenanceConfig {
  enabled: boolean;
  message: string;
}

const DEFAULT_REFERRAL: ReferralConfig = {
  requiredReferrals: 1,
  minTransactions: 1,
  maxRewardPerUser: 500,
  campaignStart: null,
  campaignEnd: null,
  campaignEnabled: true,
};

const DEFAULT_REWARD: RewardConfig = { amount: 0, enabled: false };
const DEFAULT_SECURITY: SecurityConfig = { pinMaxAttempts: 5, pinLockMinutes: 15, authorizationTtlMinutes: 5 };
const DEFAULT_LIMITS: LimitsConfig = { minTransfer: 1, maxTransfer: 100000 };
const DEFAULT_MAINTENANCE: MaintenanceConfig = { enabled: false, message: "WTS Pay is under maintenance. Please try again soon." };

export async function getConfigJson(db: Db, key: string): Promise<Record<string, unknown> | null> {
  const row = await (db as any).config?.findUnique?.({ where: { key } });
  return row && typeof row.value === "object" ? (row.value as Record<string, unknown>) : null;
}

export async function getReferralConfig(db: Db): Promise<ReferralConfig> {
  const v = await getConfigJson(db, "referral");
  return { ...DEFAULT_REFERRAL, ...(v ?? {}) } as ReferralConfig;
}

export async function getSignupRewardConfig(db: Db): Promise<RewardConfig> {
  const v = await getConfigJson(db, "signupReward");
  return { ...DEFAULT_REWARD, ...(v ?? {}) } as RewardConfig;
}

export async function getReferralRewardConfig(db: Db): Promise<RewardConfig> {
  const v = await getConfigJson(db, "referralReward");
  return { ...DEFAULT_REWARD, ...(v ?? {}) } as RewardConfig;
}

export async function getSecurityConfig(db: Db): Promise<SecurityConfig> {
  const v = await getConfigJson(db, "security");
  return { ...DEFAULT_SECURITY, ...(v ?? {}) } as SecurityConfig;
}

export async function getLimitsConfig(db: Db): Promise<LimitsConfig> {
  const v = await getConfigJson(db, "limits");
  return { ...DEFAULT_LIMITS, ...(v ?? {}) } as LimitsConfig;
}

export async function getMaintenanceConfig(db: Db): Promise<MaintenanceConfig> {
  const v = await getConfigJson(db, "maintenanceMode");
  return { ...DEFAULT_MAINTENANCE, ...(v ?? {}) } as MaintenanceConfig;
}

export async function campaignActive(db: Db, now = new Date()): Promise<boolean> {
  const c = await getReferralConfig(db);
  if (!c.campaignEnabled) return false;
  if (c.campaignStart && now < new Date(c.campaignStart)) return false;
  if (c.campaignEnd && now > new Date(c.campaignEnd)) return false;
  return true;
}

export async function setConfig(db: Db, key: string, value: unknown) {
  return (db as any).config.upsert({ where: { key }, update: { value }, create: { key, value } });
}
