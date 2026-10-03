import { describe, it, expect, beforeEach } from "vitest";
import { FakeDb, seedConfig, makeUser } from "./helpers/fakeDb.js";
import {
  sendPhoneCode, verifyPhoneCode, assertPhoneToken,
  OTP_TTL_MS, OTP_RESEND_COOLDOWN_MS, OTP_MAX_SENDS_PER_DAY, OTP_MAX_ATTEMPTS,
} from "../src/services/phoneVerification.service.js";
import { SmsSendError } from "../src/services/smsgate.service.js";

const PHONE = "+201000000123";
let db: FakeDb;
let sent: { phone: string; text: string }[];
const sender = async (phone: string, text: string) => { sent.push({ phone, text }); };
const lastCode = () => sent[sent.length - 1].text.match(/\d{6}/)![0];

beforeEach(() => { db = new FakeDb(); seedConfig(db); sent = []; });

describe("phone OTP - send", () => {
  it("sends a 6-digit code and stores only a hash", async () => {
    await sendPhoneCode(db, { phone: PHONE, sender, now: 1_000 });
    expect(sent.length).toBe(1);
    expect(sent[0].phone).toBe(PHONE);
    const code = lastCode();
    expect(code.length).toBe(6);
    const stored = JSON.stringify(db.configs.get(`phoneotp:${PHONE}`));
    expect(stored.includes(code)).toBe(false);
  });

  it("rejects non-international numbers", async () => {
    await expect(sendPhoneCode(db, { phone: "01000000123", sender })).rejects.toMatchObject({ code: "INVALID_PHONE" });
    expect(sent.length).toBe(0);
  });

  it("does not send SMS to an already-registered number", async () => {
    await makeUser(db, PHONE);
    await expect(sendPhoneCode(db, { phone: PHONE, sender })).rejects.toMatchObject({ code: "PHONE_TAKEN" });
    expect(sent.length).toBe(0);
  });

  it("enforces 45s cooldown between sends", async () => {
    await sendPhoneCode(db, { phone: PHONE, sender, now: 1_000 });
    await expect(sendPhoneCode(db, { phone: PHONE, sender, now: 1_000 + 10_000 })).rejects.toMatchObject({ code: "COOLDOWN" });
    await sendPhoneCode(db, { phone: PHONE, sender, now: 1_000 + OTP_RESEND_COOLDOWN_MS + 1 });
    expect(sent.length).toBe(2);
  });

  it("enforces the daily cap per phone", async () => {
    let t = Date.UTC(2026, 0, 1, 10);
    for (let i = 0; i < OTP_MAX_SENDS_PER_DAY; i++) {
      await sendPhoneCode(db, { phone: PHONE, sender, now: t });
      t += OTP_RESEND_COOLDOWN_MS + 1;
    }
    await expect(sendPhoneCode(db, { phone: PHONE, sender, now: t })).rejects.toMatchObject({ code: "DAILY_LIMIT" });
    // next day is allowed again
    await sendPhoneCode(db, { phone: PHONE, sender, now: t + 24 * 3600 * 1000 });
    expect(sent.length).toBe(OTP_MAX_SENDS_PER_DAY + 1);
  });

  it("rolls back the cooldown when the SMS gateway fails", async () => {
    const failing = async () => { throw new SmsSendError("down"); };
    const t = Date.UTC(2026, 0, 1, 10);
    await expect(sendPhoneCode(db, { phone: PHONE, sender: failing, now: t })).rejects.toMatchObject({ code: "SMS_UNAVAILABLE" });
    await sendPhoneCode(db, { phone: PHONE, sender, now: t + 2_000 }); // no cooldown penalty
    expect(sent.length).toBe(1);
  });
});

describe("phone OTP - verify", () => {
  it("issues a phoneToken that register accepts for the same phone only", async () => {
    await sendPhoneCode(db, { phone: PHONE, sender, now: 1_000 });
    const r = await verifyPhoneCode(db, { phone: PHONE, code: lastCode(), now: 2_000 });
    expect(r.phoneToken.length > 10).toBe(true);
    assertPhoneToken(r.phoneToken, PHONE); // no throw
    expect(() => assertPhoneToken(r.phoneToken, "+201000000999")).toThrow();
    expect(() => assertPhoneToken(undefined, PHONE)).toThrow();
    expect(() => assertPhoneToken("garbage.token.value", PHONE)).toThrow();
  });

  it("burns the code after success (single use)", async () => {
    await sendPhoneCode(db, { phone: PHONE, sender, now: 1_000 });
    const code = lastCode();
    await verifyPhoneCode(db, { phone: PHONE, code, now: 2_000 });
    await expect(verifyPhoneCode(db, { phone: PHONE, code, now: 3_000 })).rejects.toMatchObject({ code: "NO_CODE" });
  });

  it("rejects an expired code", async () => {
    await sendPhoneCode(db, { phone: PHONE, sender, now: 1_000 });
    await expect(verifyPhoneCode(db, { phone: PHONE, code: lastCode(), now: 1_000 + OTP_TTL_MS + 1 }))
      .rejects.toMatchObject({ code: "CODE_EXPIRED" });
  });

  it("locks the code after 5 wrong attempts, even if the right code comes next", async () => {
    await sendPhoneCode(db, { phone: PHONE, sender, now: 1_000 });
    const good = lastCode();
    const bad = good === "000000" ? "111111" : "000000";
    for (let i = 0; i < OTP_MAX_ATTEMPTS - 1; i++) {
      await expect(verifyPhoneCode(db, { phone: PHONE, code: bad, now: 2_000 })).rejects.toMatchObject({ code: "INVALID_CODE" });
    }
    await expect(verifyPhoneCode(db, { phone: PHONE, code: bad, now: 2_000 })).rejects.toMatchObject({ code: "TOO_MANY_ATTEMPTS" });
    await expect(verifyPhoneCode(db, { phone: PHONE, code: good, now: 2_000 })).rejects.toMatchObject({ code: "NO_CODE" });
  });

  it("a code for one phone does not verify another phone", async () => {
    await sendPhoneCode(db, { phone: PHONE, sender, now: 1_000 });
    await expect(verifyPhoneCode(db, { phone: "+201000000555", code: lastCode(), now: 2_000 }))
      .rejects.toMatchObject({ code: "NO_CODE" });
  });
});
