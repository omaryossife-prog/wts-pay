import { Router } from "express";
import type { Request, Response } from "express";
import { verifyWebhook, receiveWebhook } from "../whatsapp/whatsapp.webhook.js";
import { handleFlowDataExchange, handleWtsActionsFlowDataExchange } from "../whatsapp/whatsapp.flows.js";

const router = Router();
router.get("/webhook", verifyWebhook);
router.post("/webhook", receiveWebhook);

// WhatsApp Flow data exchange (encrypted by Meta) - e.g. secure PIN entry.
router.post("/flows/:name", async (req: Request, res: Response) => {
  const name = req.params.name;
  if (name === "pin") {
    const result = await handleFlowDataExchange(req.body);
    return res.json(result);
  }
  if (name === "actions" || name === "wts") {
    const result = await handleWtsActionsFlowDataExchange(req.body);
    return res.json(result);
  }
  return res.status(404).json({ error: "Unknown flow" });
});
export default router;
