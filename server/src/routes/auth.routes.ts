import { Router } from "express";
import { validate } from "../middleware/validate.middleware.js";
import { authLimiter } from "../middleware/rateLimit.middleware.js";
import {
  registerSchema, loginSchema, sendPhoneCodeSchema, verifyPhoneCodeSchema,
  registerController, loginController, logoutController,
  sendPhoneCodeController, verifyPhoneCodeController,
} from "../controllers/auth.controller.js";

const router = Router();
router.post("/phone/send", authLimiter, validate(sendPhoneCodeSchema), sendPhoneCodeController);
router.post("/phone/verify", authLimiter, validate(verifyPhoneCodeSchema), verifyPhoneCodeController);
router.post("/register", authLimiter, validate(registerSchema), registerController);
router.post("/login", authLimiter, validate(loginSchema), loginController);
router.post("/logout", logoutController);
export default router;
