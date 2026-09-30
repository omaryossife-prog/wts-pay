import { Router } from "express";
import { validate } from "../middleware/validate.middleware.js";
import { authLimiter } from "../middleware/rateLimit.middleware.js";
import {
  registerSchema, loginSchema,
  registerController, loginController, logoutController,
} from "../controllers/auth.controller.js";
import {
  requestOtpSchema, verifyOtpSchema,
  requestOtpController, verifyOtpController,
} from "../controllers/otp.controller.js";

const router = Router();
// التحقق من رقم الهاتف برسالة SMS قبل إنشاء أي محفظة جديدة
router.post("/otp/request", authLimiter, validate(requestOtpSchema), requestOtpController);
router.post("/otp/verify", authLimiter, validate(verifyOtpSchema), verifyOtpController);
router.post("/register", authLimiter, validate(registerSchema), registerController);
router.post("/login", authLimiter, validate(loginSchema), loginController);
router.post("/logout", logoutController);
export default router;
