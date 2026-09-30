import { describe, it, expect, beforeEach } from "vitest";
import { FakeDb, makeUser, seedConfig } from "./helpers/fakeDb.js";
import {
  createTransferAuthorization, executeAuthorizedTransfer, AuthorizationError,
} from "../src/services/txauth.service.js";

let db: FakeDb;
let alice: any, bob: any;

beforeEach(async () => {
  db = new FakeDb();
  seedConfig(db);
  alice = await makeUser(db, "+201000000002", 2000);
  bob = await makeUser(db, "+201000000003", 100);
});

describe("transaction authorization", () => {
  it("creates a PENDING authorization with fee, total and expiry - no transfer yet", async () => {
    const auth = await createTransferAuthorization(db, { senderId: alice.id, recipientPhone: bob.phone, amount: 1500 });
    expect(auth.status).toBe("PENDING");
    expect(auth.fee).toBe(2);
    expect(auth.total).toBe(1502);
    expect(auth.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(db.users.get(alice.id).demoBalance).toBe(2000); // nothing moved
    expect(db.transactions.size).toBe(0);
  });

  it("executes only after authorization: atomic debit/credit + ledger + USED", async () => {
    const auth = await createTransferAuthorization(db, { senderId: alice.id, recipientPhone: bob.phone, amount: 1500 });
    const r = await executeAuthorizedTransfer(db, { authorizationId: auth.authorizationId, senderId: alice.id });
    expect(r.authorization.status).toBe("USED");
    expect(r.duplicate).toBe(false);
    expect(db.users.get(alice.id).demoBalance).toBe(2000 - 1502);
    expect(db.users.get(bob.id).demoBalance).toBe(100 + 1500);
    const ledger = [...db.transactions.values()].find((t) => t.idempotencyKey === auth.transferIdempotencyKey);
    expect(ledger.type).toBe("TRANSFER");
    expect(ledger.fee).toBe(2);
  });

  it("cannot be executed twice", async () => {
    const auth = await createTransferAuthorization(db, { senderId: alice.id, recipientPhone: bob.phone, amount: 100 });
    await executeAuthorizedTransfer(db, { authorizationId: auth.authorizationId, senderId: alice.id });
    await expect(
      executeAuthorizedTransfer(db, { authorizationId: auth.authorizationId, senderId: alice.id })
    ).rejects.toMatchObject({ code: "AUTH_USED" });
    expect(db.users.get(alice.id).demoBalance).toBe(2000 - 101); // single debit only
  });

  it("expires and refuses execution after expiry", async () => {
    const auth = await createTransferAuthorization(db, { senderId: alice.id, recipientPhone: bob.phone, amount: 100, now: new Date("2026-01-01T00:00:00Z") });
    const past = new Date("2026-01-01T00:10:00Z"); // > 5 min TTL
    await expect(
      executeAuthorizedTransfer(db, { authorizationId: auth.authorizationId, senderId: alice.id, now: past })
    ).rejects.toMatchObject({ code: "AUTH_EXPIRED" });
    expect(db.users.get(alice.id).demoBalance).toBe(2000); // untouched
  });

  it("cannot be executed by a different user", async () => {
    const auth = await createTransferAuthorization(db, { senderId: alice.id, recipientPhone: bob.phone, amount: 100 });
    const carol = await makeUser(db, "+201000000004", 500);
    await expect(
      executeAuthorizedTransfer(db, { authorizationId: auth.authorizationId, senderId: carol.id })
    ).rejects.toMatchObject({ code: "AUTH_WRONG_USER" });
  });

  it("invalidates the previous pending authorization when details change", async () => {
    const a1 = await createTransferAuthorization(db, { senderId: alice.id, recipientPhone: bob.phone, amount: 100 });
    const a2 = await createTransferAuthorization(db, { senderId: alice.id, recipientPhone: bob.phone, amount: 200 });
    expect(db.authorizations.get(a1.id).status).toBe("INVALIDATED");
    expect(db.authorizations.get(a2.id).status).toBe("PENDING");
    await expect(
      executeAuthorizedTransfer(db, { authorizationId: a1.authorizationId, senderId: alice.id })
    ).rejects.toMatchObject({ code: "AUTH_INVALIDATED" });
  });

  it("checks balance at execution time (not at authorization time)", async () => {
    const auth = await createTransferAuthorization(db, { senderId: alice.id, recipientPhone: bob.phone, amount: 1500 });
    db.users.get(alice.id).demoBalance = 10; // drained after authorization
    await expect(
      executeAuthorizedTransfer(db, { authorizationId: auth.authorizationId, senderId: alice.id })
    ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
  });

  it("enforces min/max limits and blocks unverified or transfers-disabled users", async () => {
    await expect(
      createTransferAuthorization(db, { senderId: alice.id, recipientPhone: bob.phone, amount: 0 })
    ).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    db.users.get(alice.id).verificationStatus = "PENDING_REVIEW";
    await expect(
      createTransferAuthorization(db, { senderId: alice.id, recipientPhone: bob.phone, amount: 100 })
    ).rejects.toMatchObject({ code: "ACCOUNT_UNVERIFIED" });
    db.users.get(alice.id).verificationStatus = "VERIFIED";
    db.users.get(bob.id).transfersEnabled = false;
    await expect(
      createTransferAuthorization(db, { senderId: alice.id, recipientPhone: bob.phone, amount: 100 })
    ).rejects.toMatchObject({ code: "TRANSFERS_DISABLED" });
  });
});
