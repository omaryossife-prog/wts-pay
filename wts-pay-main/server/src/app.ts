import express from "express";
import cors from "cors";
import routes from "./routes/index.js";
import { apiLimiter } from "./middleware/rateLimit.middleware.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);

  const allowedOrigin = "https://wts-pay-1.pages.dev";

  // CORS
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin || origin === allowedOrigin) {
          return cb(null, true);
        }

        return cb(new Error("Not allowed by CORS"));
      },
      credentials: true,
      methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "X-Requested-With",
        "Idempotency-Key",
      ],
    })
  );

  // Cloudflare Workers compatible JSON parser.
  // Avoid express.json()/body-parser because it pulls Node stream
  // dependencies that are not fully compatible with the Workers runtime.
  app.use(async (req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      return next();
    }

    const contentType = req.headers["content-type"] ?? "";

    if (!contentType.includes("application/json")) {
      return next();
    }

    try {
      const raw = await new Promise<string>((resolve, reject) => {
        let data = "";

        req.setEncoding("utf8");

        req.on("data", (chunk) => {
          data += chunk;

          if (data.length > 256 * 1024) {
            reject(new Error("Request body too large"));
          }
        });

        req.on("end", () => resolve(data));
        req.on("error", reject);
      });

      req.body = raw ? JSON.parse(raw) : {};
      next();
    } catch {
      res.status(400).json({ error: "Invalid JSON body" });
    }
  });

  // CSRF protection
  app.use((req, res, next) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      !req.path.startsWith("/api/whatsapp/webhook") &&
      !req.path.startsWith("/api/whatsapp/flows")
    ) {
      const hdr = req.headers["x-requested-with"];

      if (hdr !== "XMLHttpRequest") {
        return res.status(403).json({
          error: "Missing CSRF header",
        });
      }
    }

    next();
  });

  app.use("/api", apiLimiter, routes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
