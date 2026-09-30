import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { transferLimiter } from "../middleware/rateLimit.middleware.js";
import {
  createRequestController, incomingRequestsController, outgoingRequestsController,
  rejectRequestController, cancelRequestController, acceptRequestController,
  createRequestSchema, acceptRequestSchema,
} from "../controllers/transferRequest.controller.js";

const router = Router();
router.use(requireAuth);
router.get("/incoming", incomingRequestsController);
router.get("/outgoing", outgoingRequestsController);
router.post("/", transferLimiter, validate(createRequestSchema), createRequestController);
router.post("/:id/reject", rejectRequestController);
router.post("/:id/cancel", cancelRequestController);
router.post("/:id/accept", transferLimiter, validate(acceptRequestSchema), acceptRequestController);
export default router;
