import { Router } from "express";
import { requireAuth, idempotency } from "../middleware/auth.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { transferLimiter } from "../middleware/rateLimit.middleware.js";
import {
  getWalletController, transferController, transactionsController, quoteController,
  transferSchema, quoteSchema,
} from "../controllers/wallet.controller.js";

const router = Router();
router.use(requireAuth);
router.get("/", getWalletController);
router.post("/quote", validate(quoteSchema), quoteController);
router.post("/transfer", transferLimiter, idempotency, validate(transferSchema), transferController);
router.get("/transactions", transactionsController);
export default router;
