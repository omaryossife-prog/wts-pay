// ---------------------------------------------------------------------------
// THE single source of truth for transfer fee calculation.
// fee = CEILING(amount / divisor), default divisor = 1000.
// Admin-configurable later via the Config table (key: "fee").
// ---------------------------------------------------------------------------
import type { Db } from "../utils/prisma.js";

export interface FeeConfig {
  mode: "per_thousand_ceiling";
  divisor: number;
}

const DEFAULT_FEE_CONFIG: FeeConfig = { mode: "per_thousand_ceiling", divisor: 1000 };

export async function getFeeConfig(db: Db): Promise<FeeConfig> {
  const row = await (db as any).config?.findUnique?.({ where: { key: "fee" } });
  if (row && row.value && typeof row.value === "object") {
    return { ...DEFAULT_FEE_CONFIG, ...(row.value as Partial<FeeConfig>) };
  }
  return DEFAULT_FEE_CONFIG;
}

export function calculateTransferFee(amount: number, divisor = 1000): number {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("Amount must be a positive integer number of demo credits.");
  }
  if (!Number.isInteger(divisor) || divisor <= 0) {
    throw new Error("Fee divisor must be a positive integer.");
  }
  return Math.ceil(amount / divisor);
}

export async function computeFee(db: Db, amount: number): Promise<{ fee: number; totalDebit: number }> {
  const cfg = await getFeeConfig(db);
  const fee = calculateTransferFee(amount, cfg.divisor);
  return { fee, totalDebit: amount + fee };
}
