import type { NextFunction, Request, Response } from "express";
import { WalletError } from "../services/wallet.service.js";
import { AuthError } from "../services/user.service.js";
import { PinError } from "../services/pin.service.js";
import { AuthorizationError } from "../services/txauth.service.js";
import { TransferRequestError } from "../services/transferRequest.service.js";
import { logger } from "../utils/logger.js";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function notFound(_req: Request, res: Response) {
  res.status(404).json({ error: "Not found" });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  if (err instanceof WalletError) {
    const status =
      err.code === "INSUFFICIENT_BALANCE"
        ? 422
        : err.code === "ACCOUNT_FROZEN" ||
          err.code === "ACCOUNT_UNVERIFIED" ||
          err.code === "TRANSFERS_DISABLED"
        ? 403
        : err.code === "SELF_TRANSFER" ||
          err.code === "INVALID_AMOUNT" ||
          err.code === "LIMIT_EXCEEDED"
        ? 400
        : 404;

    return res.status(status).json({ error: err.message, code: err.code });
  }

  if (err instanceof PinError) {
    const status =
      err.code === "PIN_LOCKED" ? 423 : err.code === "PIN_NOT_SET" ? 400 : 401;

    return res.status(status).json({ error: err.message, code: err.code });
  }

  if (err instanceof AuthorizationError) {
    const status =
      err.code === "AUTH_NOT_FOUND"
        ? 404
        : err.code === "AUTH_WRONG_USER"
        ? 403
        : 410;

    return res.status(status).json({ error: err.message, code: err.code });
  }

  if (err instanceof AuthError) {
    const status =
      err.code === "PHONE_TAKEN" ? 409 : err.code === "VALIDATION" ? 400 : 401;

    return res.status(status).json({ error: err.message, code: err.code });
  }

  if (err instanceof TransferRequestError) {
    const status =
      err.code === "NOT_FOUND" || err.code === "USER_NOT_FOUND"
        ? 404
        : err.code === "WRONG_USER"
        ? 403
        : err.code === "INVALID_AMOUNT" || err.code === "LIMIT_EXCEEDED" || err.code === "SELF_REQUEST"
        ? 400
        : 410; // ALREADY_RESOLVED / EXPIRED

    return res.status(status).json({ error: err.message, code: err.code });
  }

  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }

  logger.error("Unhandled error", err);

  const message = err instanceof Error ? err.message : String(err);

  res.status(500).json({
    error: message,
  });
}
