import { describe, it, expect, beforeEach } from "vitest";
import { FakeDb, makeUser, seedConfig } from "./helpers/fakeDb.js";
import { adjustBalance, reverseReward, setFrozen, setTransfersEnabled } from "../src/services/wallet.service.js";

let db: FakeDb;
beforeEach(() => { db = new FakeDb(); seedConfig(db); });

describe("admin - audited manual adjustments and reward reversal", () => {
  it("every adjustment creates an audit record and a MANUAL_ADJUSTMENT ledger entry with before/after", async () => {
    const admin = await makeUser(db, "+201000000090");
    const user = await makeUser(db, "+201000000091", 100);
    await adjustBalance(db, { adminId: admin.id, userId: user.id, amount: -40, reason: "correcting duplicate reward", idempotencyKey: "adm1", ip: "10.0.0.9" });
    expect(db.users.get(user.id).demoBalance).toBe(60);
    const audit = db.auditLogs.find((a) => a.action === "MANUAL_BALANCE_ADJUSTMENT");
    expect(audit).toBeTruthy();
    expect(audit.adminId).toBe(admin.id);
    expect(audit.ip).toBe("10.0.0.9");
    const ledger = [...db.transactions.values()].find((t) => t.idempotencyKey === "adm1");
    expect(ledger.type).toBe("MANUAL_ADJUSTMENT");
    expect(ledger.balanceBefore).toBe(100);
    expect(ledger.balanceAfter).toBe(60);
    expect(ledger.description).toBe("correcting duplicate reward");
  });

  it("reverses demo rewards and marks original REVERSED", async () => {
    const admin = await makeUser(db, "+201000000092");
    const user = await makeUser(db, "+201000000093", 100);
    const credit = await adjustBalance(db, { adminId: admin.id, userId: user.id, amount: 50, reason: "goodwill", idempotencyKey: "rev-base" });
    credit.type = "REFERRAL_REWARD";
    await reverseReward(db, { adminId: admin.id, transactionId: credit.id, reason: "abuse detected", idempotencyKey: "rev1" });
    expect(db.users.get(user.id).demoBalance).toBe(100);
    expect(db.transactions.get(credit.id).status).toBe("REVERSED");
    expect(db.auditLogs.some((a) => a.action === "ADMIN_REVERSE_REWARD")).toBe(true);
  });

  it("admin adjustment is idempotent", async () => {
    const admin = await makeUser(db, "+201000000094");
    const user = await makeUser(db, "+201000000095", 10);
    const a = await adjustBalance(db, { adminId: admin.id, userId: user.id, amount: 5, reason: "top up", idempotencyKey: "idem1" });
    const b = await adjustBalance(db, { adminId: admin.id, userId: user.id, amount: 5, reason: "top up", idempotencyKey: "idem1" });
    expect(b.id).toBe(a.id);
    expect(db.users.get(user.id).demoBalance).toBe(15);
  });
});

describe("admin - account controls", () => {
  it("freeze keeps balance intact and logs ACCOUNT_FROZEN with notification hook", async () => {
    const admin = await makeUser(db, "+201000000096");
    const user = await makeUser(db, "+201000000097", 250);
    let notified: any = null;
    await setFrozen(db, {
      adminId: admin.id, userId: user.id, frozen: true, ip: "10.0.0.10",
      notify: async (u, frozen) => { notified = { phone: u.phone, frozen }; },
    });
    expect(db.users.get(user.id).status).toBe("FROZEN");
    expect(db.users.get(user.id).demoBalance).toBe(250);
    expect(db.auditLogs.some((a) => a.action === "ACCOUNT_FROZEN" && a.ip === "10.0.0.10")).toBe(true);
    expect(notified).toEqual({ phone: user.phone, frozen: true });
    await setFrozen(db, { adminId: admin.id, userId: user.id, frozen: false });
    expect(db.users.get(user.id).status).toBe("ACTIVE");
    expect(db.auditLogs.some((a) => a.action === "ACCOUNT_UNFROZEN")).toBe(true);
  });

  it("disable/enable transfers is logged as USER_STATUS_CHANGED", async () => {
    const admin = await makeUser(db, "+201000000098");
    const user = await makeUser(db, "+201000000099", 250);
    await setTransfersEnabled(db, { adminId: admin.id, userId: user.id, enabled: false, ip: "10.0.0.11" });
    expect(db.users.get(user.id).transfersEnabled).toBe(false);
    const audit = db.auditLogs.find((a) => a.action === "USER_STATUS_CHANGED");
    expect(audit.detail).toMatchObject({ field: "transfersEnabled", value: false });
    await setTransfersEnabled(db, { adminId: admin.id, userId: user.id, enabled: true });
    expect(db.users.get(user.id).transfersEnabled).toBe(true);
  });
});
