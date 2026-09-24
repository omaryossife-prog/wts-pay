import { PrismaClient } from "../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

let _prisma: PrismaClient | null = null;
let _databaseUrl: string | null = null;

// يُستدعى مرة واحدة من الـ Worker fetch handler
export function initDatabase(databaseUrl: string | undefined) {
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL binding is missing on the Worker. " +
        "Set it with: npx wrangler secret put DATABASE_URL (or vars in wrangler.jsonc)"
    );
  }
  _databaseUrl = databaseUrl;
}

// ملحوظة: من غير ما نحدد ssl يدوي — مكتبة pg بتقرأ sslmode
// من الرابط نفسه (?sslmode=require) وتظبط SSL صح لوحدها.
// تحديد ssl يدوي هنا كان هو سبب "Connection terminated unexpectedly"
// جوا بيئة Cloudflare Workers.
function getClient(): PrismaClient {
  if (!_prisma) {
    if (!_databaseUrl) {
      throw new Error("initDatabase() was never called — check Worker entrypoint");
    }
    const adapter = new PrismaPg({ connectionString: _databaseUrl });
    _prisma = new PrismaClient({ adapter });
  }
  return _prisma;
}

// يحافظ على: import { prisma } from "../utils/prisma.js"
// بدون تعديل أي ملف آخر — يُنشئ الـ client كسولاً عند أول استخدام
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getClient() as any;
    const value = client[prop];
    return typeof value === "function" ? value.bind(client) : value;
  },
});

export type Db = PrismaClient | Prisma.TransactionClient;
