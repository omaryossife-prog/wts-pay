import type { NextFunction, Request, Response } from "express";
import { verifyToken, type JwtPayload } from "../utils/jwt.js";
import { HttpError } from "./errorHandler.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
      idempotencyKey?: string;
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : (req as any).cookies?.wts_token;
  if (!token) return next(new HttpError(401, "Authentication required."));
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    next(new HttpError(401, "Invalid or expired token."));
  }
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, "Authentication required."));
  if (req.user.role !== "ADMIN") return next(new HttpError(403, "Admin access required."));
  next();
}

// Client-supplied idempotency key (header) or fallback to a deterministic
// per-request UUID supplied by the caller. Duplicate delivery = same key.
export function idempotency(req: Request, _res: Response, next: NextFunction) {
  const key = (req.headers["idempotency-key"] as string) || req.body?.idempotencyKey;
  if (!key) return next(new HttpError(400, "Idempotency-Key header is required."));
  req.idempotencyKey = String(key);
  next();
}
