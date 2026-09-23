import type { Db } from "../utils/prisma.js";
import { computeFee } from "./fee.service.js";
import { logAudit } from "./audit.service.js";

export class WalletError extends Error {
  code:
    | "USER_NOT_FOUND"
    | "ACCOUNT_FROZEN"
    | "ACCOUNT_UNVERIFIED"
    | "TRANSFERS_DISABLED"
    | "SELF_TRANSFER"
    | "INSUFFICIENT_BALANCE"
    | "INVALID_AMOUNT"
    | "LIMIT_EXCEEDED"
    | "AUTHORIZATION_INVALID"
    | "AUTHORIZATION_EXPIRED" = "INVALID_AMOUNT";
  constructor(code: WalletError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-()]/g, "");
}

async function creditInternal(
  db: any,
  userId: string,
  amount: number,
  type: string,
  idempotencyKey: string,
  description: string,
  senderId: string | null = null
) {
  const res = await db.user.updateMany({
    where: { id: userId, status: "ACTIVE" },
    data: { demoBalance: { increment: amount } },
  });
  if (res.count !== 1) throw new WalletError("USER_NOT_FOUND", "Receiver account unavailable.");
  return db.transaction.create({
    data: {
      senderId,
      receiverId: userId,
      amount,
      fee: 0,
      totalDebit: amount,
      type,
      idempotencyKey,
      description,
      status: "COMPLETED",
    },
  });
}

// Guards shared by every transfer entry point (website or WhatsApp).
async function assertCanTransfer(tx: any, userId: string, role: "sender" | "receiver") {
  const u = await tx.user.findUnique({ where: { id: userId } });
  if (!u) throw new WalletError("USER_NOT_FOUND", `${role === "sender" ? "Sender" : "Recipient"} not found.`);
  if (u.status !== "ACTIVE") throw new WalletError("ACCOUNT_FROZEN", `${role === "sender" ? "Your" : "Recipient"} account is frozen.`);
  if (u.verificationStatus !== "VERIFIED") {
    throw new WalletError("ACCOUNT_UNVERIFIED", "Account is not verified yet.");
  }
  if (u.transfersEnabled === false) {
    throw new WalletError("TRANSFERS_DISABLED", `${role === "sender" ? "Your" : "Recipient"} transfers are disabled.`);
  }
  return u;
}

export interface TransferInput {
  senderId: string;
  recipientPhone: string;
  amount: number;
  idempotencyKey: string;
  description?: string;
}

export interface TransferResult {
  transaction: any;
  duplicate: boolean;
}

// Core transfer body - MUST run inside a transaction (tx). Public transfer()
// and the authorization executor both delegate here so the whole operation
// (guards, guarded debit/credit, ledger) stays atomic.
export async function transferInTx(tx: any, input: TransferInput): Promise<TransferResult> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new WalletError("INVALID_AMOUNT", "Amount must be a positive integer.");
  }
  const phone = normalizePhone(input.recipientPhone);

  // 1) Idempotency: return existing transaction on retry
  const existing = await tx.transaction.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) return { transaction: existing, duplicate: true };

  // 2) Guards (verified, active, transfers enabled)
  const sender = await assertCanTransfer(tx, input.senderId, "sender");
  const receiver = await tx.user.findUnique({ where: { phone } });
  if (!receiver) throw new WalletError("USER_NOT_FOUND", "No WTS user with that phone number.");
  if (receiver.id === sender.id) throw new WalletError("SELF_TRANSFER", "You cannot send to yourself.");
  await assertCanTransfer(tx, receiver.id, "receiver");

  // 3) Fee via the single dedicated fee service
  const { fee, totalDebit } = await computeFee(tx, input.amount);

  // 4) Atomic guarded debit
  const debit = await tx.user.updateMany({
    where: { id: sender.id, status: "ACTIVE", demoBalance: { gte: totalDebit } },
    data: { demoBalance: { decrement: totalDebit } },
  });
  if (debit.count !== 1) {
    throw new WalletError("INSUFFICIENT_BALANCE", "Insufficient demo balance (amount + fee).");
  }

  // 5) Atomic guarded credit
  const credit = await tx.user.updateMany({
    where: { id: receiver.id, status: "ACTIVE" },
    data: { demoBalance: { increment: input.amount } },
  });
  if (credit.count !== 1) {
    throw new WalletError("USER_NOT_FOUND", "Could not credit receiver.");
  }

  // 6) Immutable ledger record
  const transaction = await tx.transaction.create({
    data: {
      senderId: sender.id,
      receiverId: receiver.id,
      amount: input.amount,
      fee,
      totalDebit,
      type: "TRANSFER",
      idempotencyKey: input.idempotencyKey,
      description: input.description ?? "Wallet transfer",
      status: "COMPLETED",
    },
  });

  return { transaction, duplicate: false };
}

export async function transfer(db: Db, input: TransferInput): Promise<TransferResult> {
  const client: any = db;
  return client.$transaction((tx: any) => transferInTx(tx, input));
}

export async function creditReward(
  db: Db,
  input: {
    userId: string;
    amount: number;
    type: "SIGNUP_REWARD" | "REFERRAL_REWARD";
    idempotencyKey: string;
    description: string;
  }
): Promise<any> {
  const client: any = db;
  return client.$transaction(async (tx: any) => {
    const existing = await tx.transaction.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return existing;
    const user = await tx.user.findUnique({ where: { id: input.userId } });
    if (!user) throw new WalletError("USER_NOT_FOUND", "User not found.");
    if (user.status !== "ACTIVE") throw new WalletError("ACCOUNT_FROZEN", "Account is frozen.");
    return creditInternal(tx, input.userId, input.amount, input.type, input.idempotencyKey, input.description);
  });
}

// ---------------------------------------------------------------------------
// Manual balance adjustment (admin correction) - NEVER silently modifies a
// balance. Always creates a MANUAL_ADJUSTMENT ledger row with balance
// before/after, plus an append-only audit record (admin, IP, reason).
// ---------------------------------------------------------------------------
export async function adjustBalance(
  db: Db,
  input: { adminId: string; userId: string; amount: number; reason: string; idempotencyKey: string; ip?: string }
): Promise<any> {
  const client: any = db;
  return client.$transaction(async (tx: any) => {
    const existing = await tx.transaction.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return existing;

    const user = await tx.user.findUnique({ where: { id: input.userId } });
    if (!user) throw new WalletError("USER_NOT_FOUND", "User not found.");
    const balanceBefore = user.demoBalance;

    if (input.amount > 0) {
      await tx.user.update({ where: { id: user.id }, data: { demoBalance: { increment: input.amount } } });
    } else {
      const abs = Math.abs(input.amount);
      const res = await tx.user.updateMany({
        where: { id: user.id, demoBalance: { gte: abs } },
        data: { demoBalance: { decrement: abs } },
      });
      if (res.count !== 1) throw new WalletError("INSUFFICIENT_BALANCE", "User balance too low for this deduction.");
    }
    const balanceAfter = balanceBefore + input.amount;

    const txRow = await tx.transaction.create({
      data: {
        senderId: input.amount < 0 ? user.id : null,
        receiverId: input.amount >= 0 ? user.id : null,
        amount: Math.abs(input.amount),
        fee: 0,
        totalDebit: Math.abs(input.amount),
        type: "MANUAL_ADJUSTMENT",
        idempotencyKey: input.idempotencyKey,
        description: input.reason,
        status: "COMPLETED",
        balanceBefore,
        balanceAfter,
      },
    });

    await logAudit(tx, {
      adminId: input.adminId,
      userId: user.id,
      action: "MANUAL_BALANCE_ADJUSTMENT",
      ip: input.ip,
      detail: {
        adjustmentId: txRow.id,
        amount: input.amount,
        balanceBefore,
        balanceAfter,
        reason: input.reason,
      },
    });
    return txRow;
  });
}

export async function reverseReward(
  db: Db,
  input: { adminId: string; transactionId: string; reason: string; idempotencyKey: string; ip?: string }
): Promise<any> {
  const client: any = db;
  return client.$transaction(async (tx: any) => {
    const existing = await tx.transaction.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return existing;

    const original = await tx.transaction.findUnique({ where: { id: input.transactionId } });
    if (!original) throw new WalletError("USER_NOT_FOUND", "Original transaction not found.");
    if (original.type !== "SIGNUP_REWARD" && original.type !== "REFERRAL_REWARD") {
      throw new WalletError("INVALID_AMOUNT", "Only demo rewards can be reversed.");
    }
    if (original.status === "REVERSED") return original;
    if (!original.receiverId) throw new WalletError("USER_NOT_FOUND", "Reward has no receiver.");

    const res = await tx.user.updateMany({
      where: { id: original.receiverId, demoBalance: { gte: original.amount } },
      data: { demoBalance: { decrement: original.amount } },
    });
    if (res.count !== 1) throw new WalletError("INSUFFICIENT_BALANCE", "Balance too low to reverse.");

    await tx.transaction.update({ where: { id: original.id }, data: { status: "REVERSED" } });
    const reversal = await tx.transaction.create({
      data: {
        senderId: original.receiverId,
        receiverId: null,
        amount: original.amount,
        fee: 0,
        totalDebit: original.amount,
        type: original.type,
        idempotencyKey: input.idempotencyKey,
        description: `Reversal of ${original.id}: ${input.reason}`,
        status: "COMPLETED",
      },
    });
    await logAudit(tx, {
      adminId: input.adminId,
      userId: original.receiverId,
      action: "ADMIN_REVERSE_REWARD",
      ip: input.ip,
      detail: { originalTransactionId: original.id, reason: input.reason, reversalId: reversal.id },
    });
    return reversal;
  });
}

// Admin freeze/unfreeze - logged with spec event names.
export async function setFrozen(
  db: Db,
  input: { adminId: string; userId: string; frozen: boolean; ip?: string; notify?: (user: any, frozen: boolean) => Promise<void> }
) {
  const client: any = db;
  const user = await client.user.update({
    where: { id: input.userId },
    data: { status: input.frozen ? "FROZEN" : "ACTIVE" },
  });
  await logAudit(client, {
    adminId: input.adminId,
    userId: user.id,
    action: input.frozen ? "ACCOUNT_FROZEN" : "ACCOUNT_UNFROZEN",
    ip: input.ip,
    detail: { balanceIntact: user.demoBalance },
  });
  if (input.notify) {
    await input.notify(user, input.frozen).catch(() => {});
  }
  return { id: user.id, status: user.status };
}

export async function setTransfersEnabled(
  db: Db,
  input: { adminId: string; userId: string; enabled: boolean; ip?: string }
) {
  const client: any = db;
  const user = await client.user.update({
    where: { id: input.userId },
    data: { transfersEnabled: input.enabled },
  });
  await logAudit(client, {
    adminId: input.adminId,
    userId: user.id,
    action: "USER_STATUS_CHANGED",
    ip: input.ip,
    detail: { field: "transfersEnabled", value: input.enabled },
  });
  return { id: user.id, transfersEnabled: user.transfersEnabled };
}
