// ---------------------------------------------------------------------------
// WTS transaction PIN - the authorization mechanism for sensitive operations.
// Separate from any password. 6 digits, bcrypt-hashed, never stored or
// displayed in plaintext. Failed attempts are counted, rate-limited, and
// temporarily locked. Admins can reset a PIN through an audited process.
//
// NOTE on WhatsApp Flows: the preferred UX is a WhatsApp-native Flow for PIN
// entry (no external browser). If WHATSAPP_PIN_FLOW_ID is configured the bot
// launches that Flow; otherwise a documented chat fallback is used (see
// README "PIN entry - documented limitation").
// ---------------------------------------------------------------------------
import bcrypt from "bcryptjs";
import type { Db } from "../utils/prisma.js";
import { getSecurityConfig } from "./config.service.js";
import { logAudit } from "./audit.service.js";
import { logger } from "../utils/logger.js";

export class PinError extends Error {
  code: "PIN_INVALID" | "PIN_LOCKED" | "PIN_NOT_SET" | "PIN_WEAK" = "PIN_INVALID";
  constructor(code: PinError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

export function validatePinFormat(pin: string): void {
  if (!/^\d{6}$/.test(pin)) {
    throw new PinError("PIN_WEAK", "PIN must be exactly 6 digits.");
  }
}

export async function setPin(db: Db, input: { userId: string; pin: string; ip?: string }) {
  validatePinFormat(input.pin);
  const client: any = db;
  const hash = await bcrypt.hash(input.pin, 10);
  await client.user.update({
    where: { id: input.userId },
    data: { pinHash: hash, pinFailedAttempts: 0, pinLockedUntil: null },
  });
  await logAudit(client, { userId: input.userId, action: "PIN_CREATED", ip: input.ip, detail: {} });
}

// Verify a PIN with attempt limiting + temporary lockout.
export async function verifyPin(db: Db, input: { userId: string; pin: string; ip?: string }): Promise<void> {
  const client: any = db;
  const cfg = await getSecurityConfig(client);
  const user = await client.user.findUnique({ where: { id: input.userId } });
  if (!user) throw new PinError("PIN_NOT_SET", "Account not found.");
  if (!user.pinHash) throw new PinError("PIN_NOT_SET", "No PIN set. Create your PIN first.");

  if (user.pinLockedUntil && new Date(user.pinLockedUntil) > new Date()) {
    const mins = Math.ceil((new Date(user.pinLockedUntil).getTime() - Date.now()) / 60000);
    throw new PinError("PIN_LOCKED", `Too many failed attempts. Try again in ${mins} minute(s).`);
  }

  const ok = await bcrypt.compare(input.pin, user.pinHash);
  if (!ok) {
    const attempts = (user.pinFailedAttempts ?? 0) + 1;
    if (attempts >= cfg.pinMaxAttempts) {
      const lockedUntil = new Date(Date.now() + cfg.pinLockMinutes * 60000);
      await client.user.update({
        where: { id: user.id },
        data: { pinFailedAttempts: 0, pinLockedUntil: lockedUntil },
      });
      await logAudit(client, {
        userId: user.id, action: "PIN_LOCKED", ip: input.ip,
        detail: { attempts, lockMinutes: cfg.pinLockMinutes },
      });
      logger.warn("PIN locked due to failed attempts", { userId: user.id, ip: input.ip });
      throw new PinError("PIN_LOCKED", `Too many failed attempts. PIN locked for ${cfg.pinLockMinutes} minutes.`);
    }
    await client.user.update({ where: { id: user.id }, data: { pinFailedAttempts: attempts } });
    await logAudit(client, {
      userId: user.id, action: "PIN_VERIFY_FAILED", ip: input.ip,
      detail: { attempts, maxAttempts: cfg.pinMaxAttempts },
    });
    throw new PinError("PIN_INVALID", `Incorrect PIN. ${cfg.pinMaxAttempts - attempts} attempt(s) remaining.`);
  }

  // Success: reset the counter (keep any existing lock until it passes)
  await client.user.update({
    where: { id: user.id },
    data: { pinFailedAttempts: 0, pinLockedUntil: null },
  });
}

// Admin-initiated PIN reset: clears the PIN; user must create a new one.
export async function adminResetPin(db: Db, input: { adminId: string; userId: string; ip?: string }) {
  const client: any = db;
  await client.user.update({
    where: { id: input.userId },
    data: { pinHash: null, pinFailedAttempts: 0, pinLockedUntil: null },
  });
  await logAudit(client, {
    adminId: input.adminId, userId: input.userId, action: "PIN_RESET", ip: input.ip, detail: {},
  });
}
