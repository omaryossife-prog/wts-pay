import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../utils/prisma.js";
import { requestOtp, verifyOtp } from "../services/otp.service.js";
import { smsConfigured } from "../services/sms.service.js";

export const requestOtpSchema = z.object({
  phone: z.string().min(8).max(20),
});

export const verifyOtpSchema = z.object({
  phone: z.string().min(8).max(20),
  code: z.string().trim().regex(/^[0-9]{6}$/, "Code must be 6 digits"),
});

export async function requestOtpController(req: Request, res: Response) {
  if (!smsConfigured()) {
    return res.status(503).json({
      error: "Phone verification is temporarily unavailable.",
    });
  }
  const result = await requestOtp(prisma, req.body.phone);
  res.json({ ok: true, ...result });
}

export async function verifyOtpController(req: Request, res: Response) {
  const result = await verifyOtp(prisma, req.body.phone, req.body.code);
  res.json(result);
}
