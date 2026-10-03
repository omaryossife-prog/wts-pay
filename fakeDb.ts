// In-memory Prisma-like fake for unit tests (no real DB needed).
export class FakeDb {
  users = new Map<string, any>();
  transactions = new Map<string, any>();
  referrals = new Map<string, any>();
  authorizations = new Map<string, any>();
  auditLogs: any[] = [];
  configs = new Map<string, any>();
  seq = 0;

  constructor() {
    this.user = this.buildUserDelegate();
    this.transaction = this.buildTransactionDelegate();
    this.referral = this.buildReferralDelegate();
    this.auditLog = {
      create: async ({ data }: any) => { this.auditLogs.push({ id: `a${++this.seq}`, ...data }); return data; },
    };
    this.config = {
      findUnique: async ({ where }: any) => this.configs.get(where.key) ?? null,
      upsert: async ({ where, create, update }: any) => {
        const cur = this.configs.get(where.key);
        const val = cur ? { ...cur, ...update } : { ...create };
        this.configs.set(where.key, val);
        return val;
      },
    };
    this.transactionAuthorization = {
      create: async ({ data }: any) => {
        const id = `au${++this.seq}`;
        const a = { id, status: "PENDING", usedAt: null, ...data };
        this.authorizations.set(id, a);
        return a;
      },
      findUnique: async ({ where }: any) => {
        if (where.authorizationId) {
          for (const a of this.authorizations.values()) if (a.authorizationId === where.authorizationId) return a;
          return null;
        }
        return this.authorizations.get(where.id) ?? null;
      },
      update: async ({ where, data }: any) => {
        let target: any = null;
        if (where.id) target = this.authorizations.get(where.id);
        else if (where.authorizationId) {
          for (const a of this.authorizations.values()) if (a.authorizationId === where.authorizationId) { target = a; break; }
        }
        if (!target) throw new Error("authorization not found");
        Object.assign(target, data);
        return target;
      },
      updateMany: async ({ where, data }: any) => {
        let n = 0;
        for (const a of this.authorizations.values()) {
          const ok = Object.entries(where ?? {}).every(([k, v]) => a[k] === v);
          if (ok) { Object.assign(a, data); n++; }
        }
        return { count: n };
      },
    };
  }

  user: any;
  transaction: any;
  referral: any;
  auditLog: any;
  config: any;
  transactionAuthorization: any;

  async $transaction(fn: any) {
    return fn(this); // in-memory: single "connection", atomicity by design
  }

  matches(obj: any, where: any): boolean {
    for (const [k, v] of Object.entries(where)) {
      if (k === "OR") return v.some((w: any) => this.matches(obj, w));
      if (v !== null && typeof v === "object") {
        if ("gte" in v && !(obj[k] >= (v as any).gte)) return false;
        if ("contains" in v && !String(obj[k] ?? "").includes((v as any).contains)) return false;
        if ("increment" in v || "decrement" in v) return true;
        return false;
      }
      if (obj[k] !== v) return false;
    }
    return true;
  }

  applyData(obj: any, data: any) {
    for (const [k, v] of Object.entries(data)) {
      if (v !== null && typeof v === "object" && ("increment" in v || "decrement" in v)) {
        if ("increment" in v) obj[k] = (obj[k] ?? 0) + (v as any).increment;
        else obj[k] = (obj[k] ?? 0) - (v as any).decrement;
      } else {
        obj[k] = v;
      }
    }
  }

  findUserBy(where: any): any | null {
    for (const u of this.users.values()) if (this.matches(u, where)) return u;
    return null;
  }

  buildUserDelegate() {
    const db = this;
    return {
      async findUnique({ where }: any) {
        if (where.id) return db.users.get(where.id) ?? null;
        return db.findUserBy(where);
      },
      async findFirst({ where }: any) {
        if (where.OR) {
          for (const w of where.OR) { const u = db.findUserBy(w); if (u) return u; }
          return null;
        }
        return db.findUserBy(where);
      },
      async create({ data }: any) {
        const id = data.id ?? `u${++db.seq}`;
        const user = {
          id, status: "ACTIVE", role: "USER", demoBalance: 0, referralCount: 0,
          totalEarned: 0, verificationStatus: "VERIFIED", transfersEnabled: true,
          pinFailedAttempts: 0, ...data,
        };
        db.users.set(id, user);
        return user;
      },
      async update({ where, data }: any) {
        const u = db.users.get(where.id);
        if (!u) throw new Error("user not found");
        db.applyData(u, data);
        return u;
      },
      async updateMany({ where, data }: any) {
        const u = db.findUserBy(where);
        if (!u) return { count: 0 };
        db.applyData(u, data);
        return { count: 1 };
      },
      async count({ where }: any = {}) {
        let n = 0;
        for (const u of db.users.values()) if (!where || db.matches(u, where)) n++;
        return n;
      },
    };
  }

  buildTransactionDelegate() {
    const db = this;
    return {
      async findUnique({ where }: any) {
        if (where.idempotencyKey) {
          for (const t of db.transactions.values()) if (t.idempotencyKey === where.idempotencyKey) return t;
          return null;
        }
        return db.transactions.get(where.id) ?? null;
      },
      async create({ data }: any) {
        const id = `t${++db.seq}`;
        const tx = { id, status: "COMPLETED", fee: 0, ...data };
        db.transactions.set(id, tx);
        return tx;
      },
      async update({ where, data }: any) {
        const t = db.transactions.get(where.id);
        if (!t) throw new Error("tx not found");
        Object.assign(t, data);
        return t;
      },
      async count({ where }: any = {}) {
        let n = 0;
        for (const t of db.transactions.values()) {
          const ok = Object.entries(where ?? {}).every(([k, v]) => t[k] === v);
          if (ok) n++;
        }
        return n;
      },
      async findMany({ where, orderBy, take }: any = {}) {
        let all = [...db.transactions.values()];
        if (where?.OR) all = all.filter((t) => where.OR.some((w: any) => Object.entries(w).every(([k, v]) => t[k] === v)));
        else if (where) all = all.filter((t) => Object.entries(where).every(([k, v]) => t[k] === v));
        if (orderBy?.createdAt === "desc") all.reverse();
        return take ? all.slice(0, take) : all;
      },
    };
  }

  buildReferralDelegate() {
    const db = this;
    return {
      async findUnique({ where }: any) {
        const enrich = (r: any) => ({ ...r, referrer: db.users.get(r.referrerId), referred: db.users.get(r.referredId) });
        if (where.referredId) {
          for (const r of db.referrals.values()) if (r.referredId === where.referredId) return enrich(r);
          return null;
        }
        const r = db.referrals.get(where.id);
        return r ? enrich(r) : null;
      },
      async create({ data }: any) {
        const id = `r${++db.seq}`;
        const ref = { id, status: "PENDING", rewardedAt: null, ...data };
        db.referrals.set(id, ref);
        return ref;
      },
      async update({ where, data }: any) {
        let target: any = null;
        if (where.id) target = db.referrals.get(where.id);
        else if (where.referredId) {
          for (const r of db.referrals.values()) if (r.referredId === where.referredId) { target = r; break; }
        }
        if (!target) throw new Error("referral not found");
        Object.assign(target, data);
        return target;
      },
      async count({ where }: any = {}) {
        let n = 0;
        for (const r of db.referrals.values()) {
          const ok = Object.entries(where ?? {}).every(([k, v]) => r[k] === v);
          if (ok) n++;
        }
        return n;
      },
    };
  }
}

export function seedConfig(db: FakeDb) {
  db.configs.set("fee", { key: "fee", value: { mode: "per_thousand_ceiling", divisor: 1000 } });
  db.configs.set("signupReward", { key: "signupReward", value: { amount: 50, enabled: true } });
  db.configs.set("referralReward", { key: "referralReward", value: { amount: 25, enabled: true } });
  db.configs.set("referral", {
    key: "referral",
    value: {
      requiredReferrals: 1, minTransactions: 1, maxRewardPerUser: 500,
      campaignStart: null, campaignEnd: null, campaignEnabled: true,
    },
  });
  db.configs.set("security", { key: "security", value: { pinMaxAttempts: 5, pinLockMinutes: 15, authorizationTtlMinutes: 5 } });
  db.configs.set("limits", { key: "limits", value: { minTransfer: 1, maxTransfer: 100000 } });
  db.configs.set("approval", { key: "approval", value: { initialBalance: 0 } });
  db.configs.set("counters", { key: "counters", value: { wtsSeq: 3, walletSeq: 3 } });
}

export async function makeUser(db: FakeDb, phone: string, balance = 0) {
  return db.user.create({
    data: {
      phone,
      username: `User ${phone}`,
      passwordHash: "x",
      referralCode: `WTS-${phone.slice(-6)}`,
      demoBalance: balance,
      wtsId: `WTS-XXXX${phone.slice(-2)}`,
      walletId: `WALLET-XXXX${phone.slice(-2)}`,
    },
  });
}
