import { describe, it, expect, beforeEach, vi } from "vitest";
import { FakeDb, seedConfig } from "./helpers/fakeDb.js";

let sentTexts: string[] = [];

// نمنع الإرسال الحقيقي — نسجّل نص الرسالة بس عشان نستخرج الكود منه
vi.mock("../src/services/sms.service.js", () => ({
  sendSms: vi.fn(async (_phone: string, text: string) => {
    sentTexts.push(text);
  }),
  SmsError: class SmsError extends Error {
    code = "GATEWAY_ERROR";
  },
}));

import {
  requestOtp,
  verifyOtp,
  assertPhoneVerified,
  normalizePhone,
} from "../src/services/otp.service.js";
import { register } from "../src/services/user.service.js";

let db: FakeDb;
beforeEach(() => {
  db = new FakeDb();
  seedConfig(db);
  sentTexts = [];
});

const PHONE = "+201000000090";
const extractCode = () => sentTexts[0].match(/code is (\d{6})/)?.[1]!;

describe("phone OTP (SMS verification before registration)", () => {
  it("normalizes phone formats consistently", () => {
    expect(normalizePhone("+20 100-000-0090")).toBe(PHONE);
    expect(normalizePhone("00201000000090")).toBe(PHONE);
  });

  it("sends a 6-digit code by SMS and never stores it in plaintext", async () => {
    await requestOtp(db, PHONE);
    expect(sentTexts).toHaveLength(1);
    const record = db.configs.get(`phoneOtp:${PHONE}`);
    expect(record).toBeTruthy();
    expect(record.value.codeHash).not.toContain(extractCode());
  });

  it("verifies the code and issues a phone token usable for registration", async () => {
    await requestOtp(db, PHONE);
    const { phoneToken } = await verifyOtp(db, PHONE, extractCode());
    expect(phoneToken.split(".")).toHaveLength(3); // JWT
    expect(assertPhoneVerified(phoneToken, PHONE)).toBe(PHONE);
  });

  it("rejects a token used for a different phone number", async () => {
    await requestOtp(db, PHONE);
    const { phoneToken } = await verifyOtp(db, PHONE, extractCode());
    expect(() => assertPhoneVerified(phoneToken, "+201111111111"))
      .toThrowError(/does not match/i);
  });

  it("rejects wrong codes and locks after 5 attempts", async () => {
    await requestOtp(db, PHONE);
    for (let i = 0; i < 5; i++) {
      await expect(verifyOtp(db, PHONE, "000001")).rejects.toThrow();
    }
    await expect(verifyOtp(db, PHONE, extractCode()))
      .rejects.toMatchObject({ code: "TOO_MANY_ATTEMPTS" });
  });

  it("enforces a resend cooldown", async () => {
    await requestOtp(db, PHONE);
    await expect(requestOtp(db, PHONE))
      .rejects.toMatchObject({ code: "TOO_SOON" });
    expect(sentTexts).toHaveLength(1);
  });

  it("rejects numbers without international format", async () => {
    await expect(requestOtp(db, "01000000090"))
      .rejects.toMatchObject({ code: "INVALID_PHONE" });
  });

  it("refuses to send OTP to an already-registered phone", async () => {
    await register(db, { phone: PHONE, username: "Taken User", password: "Str0ngPass!" });
    await expect(requestOtp(db, PHONE))
      .rejects.toMatchObject({ code: "PHONE_TAKEN" });
    expect(sentTexts).toHaveLength(0);
  });

  it("rejects registration without a phone token", () => {
    expect(() => assertPhoneVerified(undefined, PHONE)).toThrowError(/required/i);
  });
});
