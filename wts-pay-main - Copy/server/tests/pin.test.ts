import { describe, it, expect, beforeEach } from "vitest";
import bcrypt from "bcryptjs";
import { FakeDb, makeUser, seedConfig } from "./helpers/fakeDb.js";
import { setPin, verifyPin, adminResetPin, PinError } from "../src/services/pin.service.js";

let db: FakeDb;
let user: any;

beforeEach(async () => {
  db = new FakeDb();
  seedConfig(db);
  (db.configs.get("security").value as any).pinMaxAttempts = 3;
  user = await makeUser(db, "+201000000100", 0);
});

describe("WTS transaction PIN", () => {
  it("stores only a bcrypt hash, never plaintext", async () => {
    await setPin(db, { userId: user.id, pin: "123456" });
    const stored = db.users.get(user.id);
    expect(stored.pinHash).not.toBe("123456");
    expect(stored.pinHash.startsWith("$2")).toBe(true);
    expect(await bcrypt.compare("123456", stored.pinHash)).toBe(true);
    expect(db.auditLogs.some((a) => a.action === "PIN_CREATED")).toBe(true);
  });

  it("rejects non-6-digit PINs", async () => {
    await expect(setPin(db, { userId: user.id, pin: "12345" })).rejects.toBeInstanceOf(PinError);
    await expect(setPin(db, { userId: user.id, pin: "1234567" })).rejects.toBeInstanceOf(PinError);
    await expect(setPin(db, { userId: user.id, pin: "12a456" })).rejects.toBeInstanceOf(PinError);
  });

  it("verifies a correct PIN and resets failed attempts", async () => {
    await setPin(db, { userId: user.id, pin: "456789" });
    db.users.get(user.id).pinFailedAttempts = 2;
    await verifyPin(db, { userId: user.id, pin: "456789", ip: "1.2.3.4" });
    expect(db.users.get(user.id).pinFailedAttempts).toBe(0);
  });

  it("counts failures and locks after the configured limit", async () => {
    await setPin(db, { userId: user.id, pin: "111222" });
    await expect(verifyPin(db, { userId: user.id, pin: "999999" })).rejects.toMatchObject({ code: "PIN_INVALID" });
    await expect(verifyPin(db, { userId: user.id, pin: "999998" })).rejects.toMatchObject({ code: "PIN_INVALID" });
    await expect(verifyPin(db, { userId: user.id, pin: "999997" })).rejects.toMatchObject({ code: "PIN_LOCKED" });
    const locked = db.users.get(user.id);
    expect(locked.pinLockedUntil).toBeTruthy();
    expect(locked.pinLockedUntil.getTime()).toBeGreaterThan(Date.now());
    expect(db.auditLogs.some((a) => a.action === "PIN_LOCKED")).toBe(true);
    // Even the correct PIN is refused while locked
    await expect(verifyPin(db, { userId: user.id, pin: "111222" })).rejects.toMatchObject({ code: "PIN_LOCKED" });
  });

  it("admin reset clears the PIN and lock, and is audited", async () => {
    const admin = await makeUser(db, "+201000000101", 0);
    await setPin(db, { userId: user.id, pin: "333444" });
    db.users.get(user.id).pinFailedAttempts = 3;
    db.users.get(user.id).pinLockedUntil = new Date(Date.now() + 60000);
    await adminResetPin(db, { adminId: admin.id, userId: user.id, ip: "10.0.0.1" });
    const u = db.users.get(user.id);
    expect(u.pinHash).toBeNull();
    expect(u.pinFailedAttempts).toBe(0);
    expect(u.pinLockedUntil).toBeNull();
    expect(db.auditLogs.some((a) => a.action === "PIN_RESET" && a.adminId === admin.id && a.ip === "10.0.0.1")).toBe(true);
    await expect(verifyPin(db, { userId: user.id, pin: "333444" })).rejects.toMatchObject({ code: "PIN_NOT_SET" });
  });
});
