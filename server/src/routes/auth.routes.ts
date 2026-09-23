import { Router } from "express";
import { validate } from "../middleware/validate.middleware.js";
import { authLimiter } from "../middleware/rateLimit.middleware.js";
import {
  registerSchema, loginSchema,
  registerController, loginController, logoutController,
} from "../controllers/auth.controller.js";

const router = Router();
router.post("/register", authLimiter, validate(registerSchema), registerController);
router.post("/login", authLimiter, validate(loginSchema), loginController);
router.post("/logout", logoutController);
export default router;
