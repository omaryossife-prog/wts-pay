import { Router } from "express";
import { requireAuth, idempotency } from "../middleware/auth.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { transferLimiter } from "../middleware/rateLimit.middleware.js";
import {
  getWalletController, transferController, transactionsController, quoteController,
  setPinController, transferSchema, quoteSchema, setPinSchema,
} from "../controllers/wallet.controller.js";
import { fileReportController } from "../controllers/fraudReport.controller.js";

const router = Router();
router.use(requireAuth);
router.get("/", getWalletController);
router.post("/quote", validate(quoteSchema), quoteController);
router.post("/transfer", transferLimiter, idempotency, validate(transferSchema), transferController);
router.get("/transactions", transactionsController);
router.post("/pin", transferLimiter, validate(setPinSchema), setPinController);
router.post("/transactions/:id/report", transferLimiter, fileReportController);
export default router;
