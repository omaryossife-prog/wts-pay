import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { referralOverviewController } from "../controllers/referral.controller.js";

const router = Router();
router.use(requireAuth);
router.get("/", referralOverviewController);
export default router;
