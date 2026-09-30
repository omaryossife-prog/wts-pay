import { describe, it, expect, beforeEach } from "vitest";
import { FakeDb, makeUser, seedConfig } from "./helpers/fakeDb.js";
import { handleSignup, evaluateReferralEligibility } from "../src/services/referral.service.js";
import { transfer } from "../src/services/wallet.service.js";

let db: FakeDb;

beforeEach(() => {
  db = new FakeDb();
  seedConfig(db);
});

describe("referral.service", () => {
  it("grants the configured signup reward through the ledger", async () => {
    const user = await makeUser(db, "+201000000010", 0);
    await handleSignup(db, { userId: user.id, phone: user.phone, referralCodeUsed: null });
    expect(db.users.get(user.id).demoBalance).toBe(50);
    const reward = [...db.transactions.values()].find((t) => t.type === "SIGNUP_REWARD");
    expect(reward).toBeDefined();
    expect(reward.amount).toBe(50);
    expect(reward.receiverId).toBe(user.id);
  });

  it("pays referral reward only after the referred user completes an eligible transaction", async () => {
    const referrer = await makeUser(db, "+201000000020", 0);
    const referred = await makeUser(db, "+201000000021", 0);
    await handleSignup(db, { userId: referred.id, phone: referred.phone, referralCodeUsed: referrer.referralCode });

    // PENDING: no reward yet (anti-abuse: no reward for bare account creation)
    expect(db.users.get(referrer.id).demoBalance).toBe(0);

    // Referred user completes a transfer -> referral becomes ELIGIBLE and pays out
    const third = await makeUser(db, "+201000000022", 100);
    await db.user.update({ where: { id: referred.id }, data: { demoBalance: { increment: 100 } } });
    await transfer(db, { senderId: referred.id, recipientPhone: third.phone, amount: 50, idempotencyKey: "r-tx1" });
    await evaluateReferralEligibility(db, referred.id);

    expect(db.users.get(referrer.id).demoBalance).toBe(25);
    const ref = [...db.referrals.values()][0];
    expect(ref.status).toBe("REWARDED");
    const reward = [...db.transactions.values()].find((t) => t.type === "REFERRAL_REWARD");
    expect(reward.idempotencyKey).toBe(`referral:${referred.id}`);
  });

  it("never double-pays the same referral", async () => {
    const referrer = await makeUser(db, "+201000000030", 0);
    const referred = await makeUser(db, "+201000000031", 0);
    await handleSignup(db, { userId: referred.id, phone: referred.phone, referralCodeUsed: referrer.referralCode });
    const third = await makeUser(db, "+201000000032", 100);
    await db.user.update({ where: { id: referred.id }, data: { demoBalance: { increment: 100 } } });
    await transfer(db, { senderId: referred.id, recipientPhone: third.phone, amount: 50, idempotencyKey: "r2-tx1" });
    await evaluateReferralEligibility(db, referred.id);
    await evaluateReferralEligibility(db, referred.id); // retry
    expect(db.users.get(referrer.id).demoBalance).toBe(25);
  });

  it("does not link a referral to a nonexistent code", async () => {
    const user = await makeUser(db, "+201000000040", 0);
    await handleSignup(db, { userId: user.id, phone: user.phone, referralCodeUsed: "WTS-NOPE" });
    expect([...db.referrals.values()].length).toBe(0);
  });

  it("flags self-referral use", async () => {
    const user = await makeUser(db, "+201000000050", 0);
    await handleSignup(db, { userId: user.id, phone: user.phone, referralCodeUsed: user.referralCode });
    expect(db.auditLogs.some((a) => a.action === "REFERRAL_SELF_USE_FLAGGED")).toBe(true);
    expect([...db.referrals.values()].length).toBe(0);
  });

  it("enforces the per-user reward cap", async () => {
    db.configs.get("referral").value.maxRewardPerUser = 60; // signup 50 + one 25 would exceed
    db.configs.get("referralReward").value.amount = 25;
    const referrer = await makeUser(db, "+201000000060", 0);
    const referred = await makeUser(db, "+201000000061", 0);
    await handleSignup(db, { userId: referred.id, phone: referred.phone, referralCodeUsed: referrer.referralCode });
    const third = await makeUser(db, "+201000000062", 100);
    await db.user.update({ where: { id: referred.id }, data: { demoBalance: { increment: 100 } } });
    await transfer(db, { senderId: referred.id, recipientPhone: third.phone, amount: 50, idempotencyKey: "cap-tx1" });
    await evaluateReferralEligibility(db, referred.id);
    // Signup reward (50) went to the REFERRED user; referrer gets 25 (under cap). Set referrer earned manually:
    expect(db.users.get(referrer.id).demoBalance).toBe(25);
    // Now simulate referrer already at cap
    db.users.get(referrer.id).totalEarned = 500;
    const referred2 = await makeUser(db, "+201000000063", 0);
    await handleSignup(db, { userId: referred2.id, phone: referred2.phone, referralCodeUsed: referrer.referralCode });
    await db.user.update({ where: { id: referred2.id }, data: { demoBalance: { increment: 100 } } });
    await transfer(db, { senderId: referred2.id, recipientPhone: third.phone, amount: 50, idempotencyKey: "cap-tx2" });
    await evaluateReferralEligibility(db, referred2.id);
    expect(db.users.get(referrer.id).demoBalance).toBe(25); // capped - no extra payout
    expect(db.auditLogs.some((a) => a.action === "REFERRAL_REWARD_CAPPED")).toBe(true);
  });
});
