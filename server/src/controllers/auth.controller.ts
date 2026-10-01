import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../utils/prisma.js";
import { register, login } from "../services/user.service.js";
import { signToken } from "../utils/jwt.js";
import { sendPhoneCode, verifyPhoneCode, assertPhoneToken } from "../services/phoneVerification.service.js";

export const registerSchema = z.object({
  phone: z.string().min(8).max(20),
  username: z.string().min(2).max(50),
  password: z.string().min(8).max(100),
  referralCode: z.string().optional(),
  // لغة الواجهة اللي المستخدم مستخدمها وقت التسجيل (اختارها من مُبدِّل اللغة في الموقع).
  language: z.enum(["ar", "en"]).optional(),
  // إثبات ملكية الرقم (صادر من /auth/phone/verify) — التسجيل مستحيل من غيره
  phoneToken: z.string({ required_error: "لازم تتحقق من رقم الموبايل برسالة SMS قبل التسجيل." }).min(10),
});

export const sendPhoneCodeSchema = z.object({
  phone: z.string().min(8).max(20),
});

export const verifyPhoneCodeSchema = z.object({
  phone: z.string().min(8).max(20),
  code: z.string().regex(/^[0-9]{6}$/, "الكود لازم يكون 6 أرقام."),
});

export const loginSchema = z.object({
  phone: z.string().min(8).max(20),
  password: z.string().min(1),
});

export async function sendPhoneCodeController(req: Request, res: Response) {
  // cf-connecting-ip بيحطه Cloudflare ومينفعش العميل يزوّره
  const ip = (req.headers["cf-connecting-ip"] as string | undefined) ?? req.ip;
  const result = await sendPhoneCode(prisma, { phone: req.body.phone, ip });
  res.json(result);
}

export async function verifyPhoneCodeController(req: Request, res: Response) {
  const result = await verifyPhoneCode(prisma, { phone: req.body.phone, code: req.body.code });
  res.json(result);
}

export async function registerController(req: Request, res: Response) {
  // أول خطوة: رفض أي تسجيل من غير phoneToken مطابق للرقم
  assertPhoneToken(req.body.phoneToken, req.body.phone);
  const { phoneToken: _ignored, ...input } = req.body;
  const user = await register(prisma, input);
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
