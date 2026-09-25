// ---------------------------------------------------------------------------
// Transaction authorization: a transfer is NEVER executed directly from a
// WhatsApp button press. Confirming creates a PENDING, transaction-bound
// authorization; only a successful WTS PIN verification executes it - exactly
// once, atomically, before expiry.
//
// Binding: the authorization carries the exact transferIdempotencyKey that the
// wallet transfer will use. Any change in amount/recipient means a NEW
// authorization; the old one is invalidated. The unique key on Transaction
// makes double-execution impossible even under retries.
// ---------------------------------------------------------------------------
import crypto from "crypto";
import type { Db } from "../utils/prisma.js";
import { computeFee } from "./fee.service.js";
import { getSecurityConfig, getLimitsConfig } from "./config.service.js";
import { transferInTx, WalletError } from "./wallet.service.js";

export class AuthorizationError extends Error {
  code: "AUTH_NOT_FOUND" | "AUTH_WRONG_USER" | "AUTH_EXPIRED" | "AUTH_USED" | "AUTH_INVALIDATED" =
    "AUTH_NOT_FOUND";
  constructor(code: AuthorizationError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

function authId(): string {
  return "auth_" + crypto.randomBytes(12).toString("hex");
}

export async function createTransferAuthorization(
  db: Db,
  input: { senderId: string; recipientPhone: string; amount: number; now?: Date }
) {
  const client: any = db;
  return client.$transaction(async (tx: any) => {
    const amount = input.amount;
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new WalletError("INVALID_AMOUNT", "Amount must be a positive integer.");
    }
    const limits = await getLimitsConfig(tx);
    if (amount < limits.minTransfer || amount > limits.maxTransfer) {
      throw new WalletError("LIMIT_EXCEEDED", `Amount must be between ${limits.minTransfer} and ${limits.maxTransfer} EGP.`);
    }

    const sender = await tx.user.findUnique({ where: { id: input.senderId } });
    if (!sender) throw new WalletError("USER_NOT_FOUND", "Sender not found.");
    if (sender.status !== "ACTIVE") throw new WalletError("ACCOUNT_FROZEN", "Your account is frozen.");
    if (sender.verificationStatus !== "VERIFIED") throw new WalletError("ACCOUNT_UNVERIFIED", "Account not verified.");
    if (sender.transfersEnabled === false) throw new WalletError("TRANSFERS_DISABLED", "Your transfers are disabled.");

    const phone = input.recipientPhone.replace(/[\s\-()]/g, "");
    const recipient = await tx.user.findUnique({ where: { phone } });
    if (!recipient) throw new WalletError("USER_NOT_FOUND", "No WTS user with that phone number.");
    if (recipient.id === sender.id) throw new WalletError("SELF_TRANSFER", "You cannot send to yourself.");
    if (recipient.status !== "ACTIVE") throw new WalletError("ACCOUNT_FROZEN", "Recipient account is frozen.");
    if (recipient.verificationStatus !== "VERIFIED") throw new WalletError("ACCOUNT_UNVERIFIED", "Recipient not verified.");
    if (recipient.transfersEnabled === false) throw new WalletError("TRANSFERS_DISABLED", "Recipient transfers are disabled.");

    const { fee, totalDebit } = await computeFee(tx, amount);
    const cfg = await getSecurityConfig(tx);
    const now = input.now ?? new Date();

    // Any earlier pending authorization for this sender is invalidated:
    // details changed, so it must not remain executable.
    await tx.transactionAuthorization?.updateMany?.({
      where: { senderId: sender.id, status: "PENDING" },
      data: { status: "INVALIDATED" },
    });

    const authorization = await tx.transactionAuthorization.create({
      data: {
        authorizationId: authId(),
        senderId: sender.id,
        recipientId: recipient.id,
        recipientPhone: recipient.phone,
        recipientWtsId: recipient.wtsId,
        amount,
        fee,
        total: totalDebit,
        transferIdempotencyKey: crypto.randomUUID(),
        status: "PENDING",
        expiresAt: new Date(now.getTime() + cfg.authorizationTtlMinutes * 60000),
      },
    });
    return authorization;
  });
}

// Executes ONLY after successful PIN verification. Atomic: authorization
// status flip + the wallet transfer happen in one DB transaction; the transfer
// re-checks balance with guarded updates.
export async function executeAuthorizedTransfer(
  db: Db,
  input: { authorizationId: string; senderId: string; now?: Date }
): Promise<{ authorization: any; transaction: any; duplicate: boolean }> {
  const client: any = db;
  return client.$transaction(async (tx: any) => {
    const auth = await tx.transactionAuthorization.findUnique({
      where: { authorizationId: input.authorizationId },
    });
    if (!auth) throw new AuthorizationError("AUTH_NOT_FOUND", "Authorization not found.");
    if (auth.senderId !== input.senderId) throw new AuthorizationError("AUTH_WRONG_USER", "Authorization belongs to another user.");
    if (auth.status === "USED") throw new AuthorizationError("AUTH_USED", "Authorization already used.");
    if (auth.status !== "PENDING") throw new AuthorizationError("AUTH_INVALIDATED", "Authorization is no longer valid.");
    const now = input.now ?? new Date();
    if (auth.expiresAt < now) {
      await tx.transactionAuthorization.update({ where: { id: auth.id }, data: { status: "EXPIRED" } });
      throw new AuthorizationError("AUTH_EXPIRED", "Authorization expired. Start the transfer again.");
    }

    const { transaction, duplicate } = await transferInTx(tx, {
      senderId: auth.senderId,
      recipientPhone: auth.recipientPhone,
      amount: auth.amount,
      idempotencyKey: auth.transferIdempotencyKey, // exact binding - one execution only
      description: "PIN-authorized transfer",
    });

    const authorization = await tx.transactionAuthorization.update({
      where: { id: auth.id },
      data: { status: "USED", usedAt: new Date() },
    });
    return { authorization, transaction, duplicate };
  });
}

export async function cancelAuthorization(db: Db, input: { authorizationId: string; senderId: string }) {
  const client: any = db;
  const auth = await client.transactionAuthorization.findUnique({ where: { authorizationId: input.authorizationId } });
  if (!auth || auth.senderId !== input.senderId || auth.status !== "PENDING") return null;
  return client.transactionAuthorization.update({
    where: { id: auth.id },
    data: { status: "INVALIDATED" },
  });
}
