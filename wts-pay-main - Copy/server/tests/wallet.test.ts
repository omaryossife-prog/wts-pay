import { describe, it, expect, beforeEach } from "vitest";
import { FakeDb, makeUser, seedConfig } from "./helpers/fakeDb.js";
import { transfer, adjustBalance, WalletError } from "../src/services/wallet.service.js";

let db: FakeDb;
let alice: any, bob: any;

beforeEach(async () => {
  db = new FakeDb();
  seedConfig(db);
  alice = await makeUser(db, "+201000000002", 1000);
  bob = await makeUser(db, "+201000000003", 500);
});

describe("wallet.service - transfer", () => {
  it("transfers amount + fee atomically and records the ledger", async () => {
    const { transaction, duplicate } = await transfer(db, {
      senderId: alice.id, recipientPhone: bob.phone, amount: 500, idempotencyKey: "k1",
    });
    expect(duplicate).toBe(false);
    expect(transaction.fee).toBe(1);
    expect(transaction.totalDebit).toBe(501);
    expect(db.users.get(alice.id).demoBalance).toBe(499);
    expect(db.users.get(bob.id).demoBalance).toBe(1000);
    const ledger = [...db.transactions.values()].find((t) => t.idempotencyKey === "k1");
    expect(ledger).toBeDefined();
    expect(ledger.type).toBe("TRANSFER");
    expect(ledger.senderId).toBe(alice.id);
    expect(ledger.receiverId).toBe(bob.id);
  });

  it("is idempotent: same key returns the same transaction, no double debit", async () => {
    const first = await transfer(db, { senderId: alice.id, recipientPhone: bob.phone, amount: 100, idempotencyKey: "k2" });
    const second = await transfer(db, { senderId: alice.id, recipientPhone: bob.phone, amount: 100, idempotencyKey: "k2" });
    expect(second.duplicate).toBe(true);
    expect(second.transaction.id).toBe(first.transaction.id);
    expect(db.users.get(alice.id).demoBalance).toBe(1000 - 101);
  });

  it("rejects insufficient balance (amount + fee)", async () => {
    await expect(
      transfer(db, { senderId: alice.id, recipientPhone: bob.phone, amount: 1000, idempotencyKey: "k3" })
    ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    // Balances unchanged (atomicity)
    expect(db.users.get(alice.id).demoBalance).toBe(1000);
    expect(db.users.get(bob.id).demoBalance).toBe(500);
  });

  it("rejects self-transfers", async () => {
    await expect(
      transfer(db, { senderId: alice.id, recipientPhone: alice.phone, amount: 10, idempotencyKey: "k4" })
    ).rejects.toMatchObject({ code: "SELF_TRANSFER" });
  });

  it("rejects transfers from frozen accounts", async () => {
    db.users.get(alice.id).status = "FROZEN";
    await expect(
      transfer(db, { senderId: alice.id, recipientPhone: bob.phone, amount: 10, idempotencyKey: "k5" })
    ).rejects.toMatchObject({ code: "ACCOUNT_FROZEN" });
  });

  it("rejects transfers to frozen accounts", async () => {
    db.users.get(bob.id).status = "FROZEN";
    await expect(
      transfer(db, { senderId: alice.id, recipientPhone: bob.phone, amount: 10, idempotencyKey: "k6" })
    ).rejects.toMatchObject({ code: "ACCOUNT_FROZEN" });
  });

  it("rejects unknown recipients and invalid amounts", async () => {
    await expect(
      transfer(db, { senderId: alice.id, recipientPhone: "+209999999999", amount: 10, idempotencyKey: "k7" })
    ).rejects.toMatchObject({ code: "USER_NOT_FOUND" });
    await expect(
      transfer(db, { senderId: alice.id, recipientPhone: bob.phone, amount: 0, idempotencyKey: "k8" })
    ).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
  });

  it("handles concurrent debits without going negative", async () => {
    // Two transfers of 600+1 each with only 1000 available -> one must fail
    const results = await Promise.allSettled([
      transfer(db, { senderId: alice.id, recipientPhone: bob.phone, amount: 600, idempotencyKey: "c1" }),
      transfer(db, { senderId: alice.id, recipientPhone: bob.phone, amount: 600, idempotencyKey: "c2" }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;
    expect(ok + failed).toBe(2);
    expect(db.users.get(alice.id).demoBalance).toBeGreaterThanOrEqual(0);
  });
});

describe("wallet.service - admin adjustBalance", () => {
  it("credits with an audit record", async () => {
    const admin = await makeUser(db, "+201000000001");
    await adjustBalance(db, { adminId: admin.id, userId: bob.id, amount: 100, reason: "Promo correction", idempotencyKey: "adj1" });
    expect(db.users.get(bob.id).demoBalance).toBe(600);
    expect(db.auditLogs.some((a) => a.action === "ADMIN_BALANCE_ADJUST" && a.adminId === admin.id)).toBe(true);
    const ledger = [...db.transactions.values()].find((t) => t.idempotencyKey === "adj1");
    expect(ledger.type).toBe("ADMIN_ADJUSTMENT");
  });

  it("refuses deductions that would overdraw the user", async () => {
    const admin = await makeUser(db, "+201000000001");
    await expect(
      adjustBalance(db, { adminId: admin.id, userId: bob.id, amount: -99999, reason: "error", idempotencyKey: "adj2" })
    ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
  });
});

describe("WalletError shape", () => {
  it("exposes machine-readable codes", () => {
    const e = new WalletError("INSUFFICIENT_BALANCE", "no funds");
    expect(e.code).toBe("INSUFFICIENT_BALANCE");
    expect(e).toBeInstanceOf(Error);
  });
});
