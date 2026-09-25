import type { NextFunction, Request, Response } from "express";
import type { ZodSchema } from "zod";
import { HttpError } from "./errorHandler.js";

export const validate =
  (schema: ZodSchema, source: "body" | "query" | "params" = "body") =>
  (req: Request, _res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req[source]);
    if (!parsed.success) {
      return next(new HttpError(400, parsed.error.issues.map((i) => i.message).join("; ")));
    }
    (req as any)[source] = parsed.data;
    next();
  };
