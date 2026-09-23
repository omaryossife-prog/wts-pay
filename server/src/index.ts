import { createApp } from "./app.js";
import { initDatabase } from "./utils/prisma.js";
import { httpServerHandler } from "cloudflare:node";

const app = createApp();
app.listen(4000);

const handler = httpServerHandler({ port: 4000 });

export default {
  async fetch(request: Request, env: Record<string, string>, ctx: ExecutionContext) {
    const url = new URL(request.url);

    // ── أداة تشخيص مؤقتة ──
    if (url.pathname === "/__dbdebug") {
      const dbUrl = env.DATABASE_URL ?? "";
      const afterProtocol = dbUrl.includes("://") ? dbUrl.split("://")[1] : "";
      const [userPass] = afterProtocol.split("@");
      const [user, ...passParts] = userPass.split(":");
      return Response.json({
        present: dbUrl.length > 0,
        length: dbUrl.length,
        startsWithQuote: dbUrl.startsWith('"') || dbUrl.startsWith("'"),
        hasWhitespace: /\s/.test(dbUrl),
        user: user || "MISSING",
        passwordLength: passParts.join(":").length,
        host: dbUrl.includes("@") ? dbUrl.split("@")[1].split("/")[0] : "MISSING",
      });
    }

    if (url.pathname === "/__dbtest") {
      try {
        const pg = await import("pg");
        const client = new pg.default.Client({ connectionString: env.DATABASE_URL });
        await client.connect();
        const r = await client.query("SELECT 1 AS ok");
        await client.end();
        return Response.json({ ok: true, result: r.rows });
      } catch (e: any) {
        return Response.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
      }
    }
    // ── نهاية أداة التشخيص ──

    initDatabase(env.DATABASE_URL);
    return handler.fetch(request, env, ctx);
  },
};
