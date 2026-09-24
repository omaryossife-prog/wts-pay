import { createApp } from "./app.js";
import { initDatabase } from "./utils/prisma.js";
import { httpServerHandler } from "cloudflare:node";

// مهم جداً في Workers: أي خطأ مش متلتقط (زي أخطاء sockets بتاعة pg
// أو unhandled promise rejection) بيقع العزل (isolate) كله →
// Cloudflare بيرجع 500 فاضي من غير CORS headers.
// التسجيل هنا بيمنع الـ crash ويسجل الخطأ بدل ما يموت الـ request.
process.on("uncaughtException", (err) => {
  console.error("uncaughtException:", err?.message ?? err);
});
process.on("unhandledRejection", (reason) => {
  console.error("unhandledRejection:", reason);
});

const app = createApp();
app.listen(4000);

const handler = httpServerHandler({ port: 4000 });

const ALLOWED_ORIGIN = "https://wts-pay-1.pages.dev";
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Methods": "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type,Authorization,X-Requested-With,Idempotency-Key",
  "Access-Control-Max-Age": "86400",
};

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    headers.set(k, v);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

let dbInitialized = false;

export default {
  async fetch(
    request: Request,
    env: Record<string, string>,
    ctx: ExecutionContext
  ) {
    try {
      // ── 1) الرد على preflight فوراً من غير ما ندخل Express ──
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }

      // ── 2) أدوات التشخيص المؤقتة ──
      const url = new URL(request.url);
      if (url.pathname === "/__dbdebug") {
        const dbUrl = env.DATABASE_URL ?? "";
        const afterProtocol = dbUrl.includes("://")
          ? dbUrl.split("://")[1]
          : "";
        const [userPass] = afterProtocol.split("@");
        const [user, ...passParts] = userPass.split(":");
        return Response.json(
          {
            present: dbUrl.length > 0,
            length: dbUrl.length,
            user: user || "MISSING",
            passwordLength: passParts.join(":").length,
            host: dbUrl.includes("@")
              ? dbUrl.split("@")[1].split("/")[0]
              : "MISSING",
          },
          { headers: CORS_HEADERS }
        );
      }
      if (url.pathname === "/__dbtest") {
        try {
          const pg = await import("pg");
          const client = new pg.default.Client({
            connectionString: env.DATABASE_URL,
          });
          await client.connect();
          const r = await client.query("SELECT 1 AS ok");
          await client.end();
          return Response.json(
            { ok: true, result: r.rows },
            { headers: CORS_HEADERS }
          );
        } catch (e: any) {
          return Response.json(
            { ok: false, error: String(e?.message ?? e) },
            { status: 500, headers: CORS_HEADERS }
          );
        }
      }
      // ── نهاية أدوات التشخيص ──

      // ── 3) تهيئة قاعدة البيانات مرة واحدة، وأي خطأ هنا يرجع JSON واضح ──
      if (!dbInitialized) {
        initDatabase(env.DATABASE_URL);
        dbInitialized = true;
      }

      // ── 4) ناخد رد Express ونختمه بـ CORS headers مهما كان نوعه ──
      const response = await handler.fetch(request, env, ctx);
      return withCors(response);
    } catch (err: any) {
      // أي crash في الـ Worker يرجع 500 بـ CORS headers بدل 500 فارغ من Cloudflare
      console.error("Worker error:", err?.message ?? err);
      return jsonError(500, `Worker error: ${String(err?.message ?? err)}`);
    }
  },
};
