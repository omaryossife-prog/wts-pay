import { Router } from "express";
import { validate } from "../middleware/validate.middleware.js";
import { authLimiter } from "../middleware/rateLimit.middleware.js";
import {
  registerSchema, loginSchema, sendPhoneCodeSchema, verifyPhoneCodeSchema,
  sendResetCodeSchema, verifyResetCodeSchema, completeResetSchema,
  registerController, loginController, logoutController,
  sendPhoneCodeController, verifyPhoneCodeController,
  sendResetCodeController, verifyResetCodeController, completeResetController,
} from "../controllers/auth.controller.js";

const router = Router();
router.post("/phone/send", authLimiter, validate(sendPhoneCodeSchema), sendPhoneCodeController);
router.post("/phone/verify", authLimiter, validate(verifyPhoneCodeSchema), verifyPhoneCodeController);
router.post("/register", authLimiter, validate(registerSchema), registerController);
router.post("/login", authLimiter, validate(loginSchema), loginController);
router.post("/logout", logoutController);

// نسيان كلمة السر: رقم الموبايل + آخر 6 أرقام من الرقم القومي → كود SMS → كلمة سر جديدة
router.post("/reset/send", authLimiter, validate(sendResetCodeSchema), sendResetCodeController);
router.post("/reset/verify", authLimiter, validate(verifyResetCodeSchema), verifyResetCodeController);
router.post("/reset/complete", authLimiter, validate(completeResetSchema), completeResetController);
export default router;
