import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { config } from "./config.js";
import routes from "./routes/index.js";
import { apiLimiter } from "./middleware/rateLimit.middleware.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);
  app.use(express.json({ limit: "256kb" }));
  app.use(cookieParser());

  // Secure CORS: only the known frontend origin, credentials allowed for cookies
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin || origin === config.clientOrigin) return cb(null, true);
        return cb(new Error("Not allowed by CORS"));
      },
      credentials: true,
    })
  );

  // Basic CSRF posture: require a custom header on mutating requests (denies
  // simple cross-site form posts; JWT is also not auto-sent cross-origin).
  app.use((req, _res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const hdr = req.headers["x-requested-with"];
      if (hdr !== "XMLHttpRequest" && !req.path.startsWith("/api/whatsapp/webhook") && !req.path.startsWith("/api/whatsapp/flows")) {
        return _res.status(403).json({ error: "Missing CSRF header" });
      }
    }
    next();
  });

  app.use("/api", apiLimiter, routes);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
