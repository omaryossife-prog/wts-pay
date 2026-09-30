import { PrismaClient } from "../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

let _prisma: PrismaClient | null = null;
let _databaseUrl: string | null = null;

// يُستدعى مرة في أول كل request من الـ Worker fetch handler.
// مهم: بنمسح الـ client القديم (_prisma = null) في كل مرة، لأن
// Cloudflare Workers بيقفل الاتصال (socket) في آخر كل request —
// لو سبنا نفس الـ client القديم واستخدمناه في request جديد،
// الطلب بيفضل معلّق للأبد (hang) لحد ما Cloudflare يلغيه.
export function initDatabase(databaseUrl: string | undefined) {
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL binding is missing on the Worker. " +
        "Set it with: npx wrangler secret put DATABASE_URL (or vars in wrangler.jsonc)"
    );
  }
  _databaseUrl = databaseUrl;
  _prisma = null;
}

// ملحوظة: من غير ما نحدد ssl يدوي — مكتبة pg بتقرأ sslmode
// من الرابط نفسه (?sslmode=require) وتظبط SSL صح لوحدها.
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
