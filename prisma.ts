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

// قواعد بيانات سحابية زي Neon/Supabase بتتطلب SSL.
// pg مش بيفعّل SSL تلقائياً — لو الـ server ماشي بـ SSL إجباري
// الاتصال بيفشل بصمت وكل query بترجع 500.
function detectSsl(url: string): boolean | { rejectUnauthorized: boolean } {
  try {
    const u = new URL(url);
    const mode = u.searchParams.get("sslmode") ?? "";
    if (["require", "allow", "prefer"].includes(mode)) {
      return { rejectUnauthorized: false };
    }
    if (["verify-ca", "verify-full"].includes(mode)) {
      return true;
    }
    const host = u.hostname;
    // استضافات سحابية معروفة بتتطلب SSL حتى لو sslmode مش مكتوب
    if (/\.(neon|supabase|amazonaws|render)\.com$/.test(host) || host.endsWith(".neon.tech")) {
      return { rejectUnauthorized: false };
    }
  } catch {
    // URL غلط — سيب الخطأ يطلع من pg بوضوح
  }
  return false;
}

function getClient(): PrismaClient {
  if (!_prisma) {
    if (!_databaseUrl) {
      throw new Error("initDatabase() was never called — check Worker entrypoint");
    }
    const adapter = new PrismaPg({
      connectionString: _databaseUrl,
      ssl: detectSsl(_databaseUrl),
    });
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
