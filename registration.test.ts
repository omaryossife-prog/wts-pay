import { describe, it, expect, beforeEach } from "vitest";
import { FakeDb, seedConfig } from "./helpers/fakeDb.js";
import {
  validateFourPartName, createRegistration, recordFullName,
  recordIdSubmitted, recordFaceVideoSubmitted,
  approveRegistration, rejectRegistration, pendingVerifications,
} from "../src/services/registration.service.js";

let db: FakeDb;
beforeEach(() => { db = new FakeDb(); seedConfig(db); });

describe("four-part legal name validation", () => {
  it("accepts exactly four alphabetic parts", () => {
    const r = validateFourPartName("  Ahmed   Mohamed Ali Hassan ");
    expect(r.ok).toBe(true);
    expect(r.fullName).toBe("Ahmed Mohamed Ali Hassan");
  });
  it("rejects three or five parts", () => {
    expect(validateFourPartName("Ahmed Mohamed Hassan").ok).toBe(false);
    expect(validateFourPartName("Ahmed Mohamed Ali Hassan Sr").ok).toBe(false);
  });
  it("rejects digits and symbols in name parts", () => {
    expect(validateFourPartName("Ahmed M0hamed Ali Hassan").ok).toBe(false);
  });
});

describe("WhatsApp-first registration lifecycle", () => {
  it("creates a registration bound to the official WhatsApp identity (wa_id)", async () => {
    const u = await createRegistration(db, { waId: "201012345678", phoneDigits: "201012345678", profileName: "Ahmed M." });
    expect(u.waId).toBe("201012345678");
    expect(u.phone).toBe("+201012345678");
    expect(u.verificationStatus).toBe("UNVERIFIED");
    // profile name is only a display hint, not identity
    expect(u.username).toBe("Ahmed M.");
  });

  it("stores verification metadata only - no media anywhere in the DB", async () => {
    const u = await createRegistration(db, { waId: "201012345678", phoneDigits: "201012345678" });
    await recordFullName(db, u.id, "Ahmed Mohamed Ali Hassan");
    await recordIdSubmitted(db, u.id);
    await recordFaceVideoSubmitted(db, u.id);
    const stored = db.users.get(u.id);
    expect(stored.idSubmitted).toBe(true);
    expect(stored.faceVideoSubmitted).toBe(true);
    expect(stored.verificationStatus).toBe("PENDING_REVIEW");
    // No media tables/columns: transactions, referrals, authorizations untouched,
    // and no user field contains binary/media data
    expect(db.transactions.size).toBe(0);
    for (const v of Object.values(stored)) {
      expect(typeof v).not.toBe("object"); // no blobs/JSON media records
    }
  });

  it("approval atomically issues WTS ID + wallet + verification + audit", async () => {
    const admin = await db.user.create({ data: { phone: "+201000000001", username: "Admin", passwordHash: "x", referralCode: "WTS-ADMIN1" } });
    const u = await createRegistration(db, { waId: "201012345678", phoneDigits: "201012345678" });
    await recordFullName(db, u.id, "Ahmed Mohamed Ali Hassan");
    const approved = await approveRegistration(db, { adminId: admin.id, userId: u.id, ip: "10.0.0.2" });
    expect(approved.verificationStatus).toBe("VERIFIED");
    expect(approved.wtsId).toBe("WTS-000004"); // counters start at 3
    expect(approved.walletId).toBe("WALLET-000004");
    expect(approved.demoBalance).toBe(0);
    const audit = db.auditLogs.find((a) => a.action === "USER_APPROVED");
    expect(audit).toBeTruthy();
    expect(audit.ip).toBe("10.0.0.2");
    // sequence advanced
    expect((db.configs.get("counters").value as any).wtsSeq).toBe(4);
  });

  it("approval is idempotent and grants the configured initial balance once", async () => {
    (db.configs.get("approval").value as any).initialBalance = 50;
    const admin = await db.user.create({ data: { phone: "+201000000001", username: "Admin", passwordHash: "x", referralCode: "WTS-ADMIN1" } });
    const u = await createRegistration(db, { waId: "201012345678", phoneDigits: "201012345678" });
    const a1 = await approveRegistration(db, { adminId: admin.id, userId: u.id });
    const a2 = await approveRegistration(db, { adminId: admin.id, userId: u.id });
    expect(a2.wtsId).toBe(a1.wtsId);
    expect(db.users.get(u.id).demoBalance).toBe(50);
    expect([...db.transactions.values()].filter((t) => t.idempotencyKey === `approval:${u.id}`).length).toBe(1);
  });

  it("rejection records reason and is audited", async () => {
    const admin = await db.user.create({ data: { phone: "+201000000001", username: "Admin", passwordHash: "x", referralCode: "WTS-ADMIN1" } });
    const u = await createRegistration(db, { waId: "201012345678", phoneDigits: "201012345678" });
    await rejectRegistration(db, { adminId: admin.id, userId: u.id, reason: "ID photo unclear", ip: "10.0.0.3" });
    const stored = db.users.get(u.id);
    expect(stored.verificationStatus).toBe("REJECTED");
    expect(stored.rejectionReason).toBe("ID photo unclear");
    expect(db.auditLogs.some((a) => a.action === "USER_REJECTED")).toBe(true);
  });

  it("lists pending verifications with metadata (no media)", async () => {
    const u = await createRegistration(db, { waId: "201012345678", phoneDigits: "201012345678" });
    await recordFullName(db, u.id, "Ahmed Mohamed Ali Hassan");
    await recordIdSubmitted(db, u.id);
    await recordFaceVideoSubmitted(db, u.id);
    const list = await pendingVerifications(db);
    expect(list.length).toBe(1);
    expect(list[0].idSubmitted).toBe(true);
    expect(list[0].faceVideoSubmitted).toBe(true);
    expect(list[0].whatsappPhone).toBe("+201012345678");
  });
});
