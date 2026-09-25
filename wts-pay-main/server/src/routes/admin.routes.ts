import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireAdmin } from "../middleware/auth.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import {
  statsController, searchUsersController, userProfileController,
  freezeController, unfreezeController, setTransfersController, resetPinController,
  adjustController, reverseController,
  pendingVerificationsController, approveController, rejectController,
  getConfigController, setConfigController, auditController, allTransactionsController,
  adjustSchema, freezeSchema, transfersSchema, approveSchema, rejectSchema, configSchema,
} from "../controllers/admin.controller.js";

const router = Router();
router.use(requireAuth, requireAdmin);

const reverseSchema = z.object({
  transactionId: z.string().uuid(),
  reason: z.string().min(3).max(300),
  idempotencyKey: z.string().min(8).max(100),
});

router.get("/stats", statsController);
router.get("/users", searchUsersController);
router.get("/users/:id", userProfileController);
router.post("/users/freeze", validate(freezeSchema), freezeController);
router.post("/users/unfreeze", validate(freezeSchema), unfreezeController);
router.post("/users/transfers", validate(transfersSchema), setTransfersController);
router.post("/users/reset-pin", validate(freezeSchema), resetPinController);
router.post("/adjust", validate(adjustSchema), adjustController);
router.post("/reverse", validate(reverseSchema), reverseController);

// Verification review
router.get("/verifications/pending", pendingVerificationsController);
router.post("/verifications/approve", validate(approveSchema), approveController);
router.post("/verifications/reject", validate(rejectSchema), rejectController);

router.get("/config", getConfigController);
router.put("/config", validate(configSchema), setConfigController);
router.get("/audit", auditController);
router.get("/transactions", allTransactionsController);
export default router;
