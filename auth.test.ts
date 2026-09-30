import { describe, it, expect, beforeEach } from "vitest";
import bcrypt from "bcryptjs";
import { FakeDb, seedConfig, makeUser } from "./helpers/fakeDb.js";
import { register, login, AuthError } from "../src/services/user.service.js";

let db: FakeDb;
beforeEach(() => { db = new FakeDb(); seedConfig(db); });

describe("auth - password security", () => {
  it("stores only bcrypt hashes, never plaintext", async () => {
    const u = await register(db, { phone: "+201000000070", username: "Sec User", password: "Str0ngPass!" });
    const stored = db.users.get(u.id);
    expect(stored.passwordHash).not.toContain("Str0ngPass!");
    expect(stored.passwordHash.startsWith("$2")).toBe(true);
    expect(await bcrypt.compare("Str0ngPass!", stored.passwordHash)).toBe(true);
  });

  it("rejects weak passwords", async () => {
    await expect(register(db, { phone: "+201000000071", username: "A", password: "short" }))
      .rejects.toBeInstanceOf(AuthError);
  });
});

describe("auth - register/login", () => {
  it("registers with unique referral code and signup reward", async () => {
    const u = await register(db, { phone: "+201000000080", username: "New User", password: "Str0ngPass!" });
    expect(u.referralCode).toMatch(/^WTS-/);
    expect(db.users.get(u.id).demoBalance).toBe(50);
  });

  it("enforces one account per phone number", async () => {
    await register(db, { phone: "+201000000081", username: "One", password: "Str0ngPass!" });
    await expect(register(db, { phone: "+201000000081", username: "Two", password: "Str0ngPass!" }))
      .rejects.toMatchObject({ code: "PHONE_TAKEN" });
  });

  it("logs in with correct credentials and rejects wrong ones", async () => {
    await register(db, { phone: "+201000000082", username: "Login", password: "Str0ngPass!" });
    const ok = await login(db, { phone: "+201000000082", password: "Str0ngPass!" });
    expect(ok.phone).toBe("+201000000082");
    await expect(login(db, { phone: "+201000000082", password: "WrongPass1" }))
      .rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });

  it("blocks login for frozen accounts", async () => {
    await register(db, { phone: "+201000000083", username: "Frozen", password: "Str0ngPass!" });
    const u = [...db.users.values()][0];
    db.users.get(u.id).status = "FROZEN";
    await expect(login(db, { phone: "+201000000083", password: "Str0ngPass!" })).rejects.toThrow();
  });
});
