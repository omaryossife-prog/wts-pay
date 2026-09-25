import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../utils/prisma.js";
import { register, login } from "../services/user.service.js";
import { signToken } from "../utils/jwt.js";

export const registerSchema = z.object({
  phone: z.string().min(8).max(20),
  username: z.string().min(2).max(50),
  password: z.string().min(8).max(100),
  referralCode: z.string().optional(),
});

export const loginSchema = z.object({
  phone: z.string().min(8).max(20),
  password: z.string().min(1),
});

export async function registerController(req: Request, res: Response) {
  const user = await register(prisma, req.body);
  // لا نسجّل دخول المستخدم تلقائيًا بعد التسجيل — الحساب لازم يتراجع
  // ويتوافق عليه من الأدمن أول (verificationStatus: PENDING_REVIEW).
  res.status(201).json({
    user,
    pendingReview: true,
    message: "Registration received. Your account is awaiting admin review.",
  });
}

export async function loginController(req: Request, res: Response) {
  const user = await login(prisma, req.body);
  const token = signToken({ userId: user.id, role: user.role });
  res.cookie("wts_token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 3600 * 1000,
  });
  res.json({ user, token });
}

export function logoutController(_req: Request, res: Response) {
  res.clearCookie("wts_token");
  res.json({ ok: true });
}
