import { Router } from "express";
import authRoutes from "./auth.routes.js";
import walletRoutes from "./wallet.routes.js";
import referralRoutes from "./referral.routes.js";
import adminRoutes from "./admin.routes.js";
import whatsappRoutes from "./whatsapp.routes.js";

const router = Router();
router.use("/auth", authRoutes);
router.use("/wallet", walletRoutes);
router.use("/referrals", referralRoutes);
router.use("/admin", adminRoutes);
router.use("/whatsapp", whatsappRoutes);

router.get("/health", (_req, res) => res.json({ ok: true, service: "wts-pay", demo: true }));
export default router;
