import { createApp } from "./app.js";
import { initDatabase } from "./utils/prisma.js";
import { httpServerHandler } from "cloudflare:node";

const app = createApp();
app.listen(4000);

const handler = httpServerHandler({ port: 4000 });

export default {
  fetch(request: Request, env: Record<string, string>, ctx: ExecutionContext) {
    initDatabase(env.DATABASE_URL); // ← هنا فقط تصل قيمة الـ secret
    return handler.fetch(request, env, ctx);
  },
};
