import { Router } from "express";
import type { Request, Response } from "express";
import { verifyWebhook, receiveWebhook } from "../whatsapp/whatsapp.webhook.js";
import {
  handleFlowDataExchange,
  handleSendMoneyFlowDataExchange,
  handleConfirmPinFlowDataExchange,
} from "../whatsapp/whatsapp.flows.js";

const router = Router();
router.get("/webhook", verifyWebhook);
router.post("/webhook", receiveWebhook);

// WhatsApp Flow data exchange (encrypted by Meta). Every operation has its
// OWN standalone Flow — PIN confirmation is always the separate
// "confirm-pin" Flow, never a screen bundled inside another one.
router.post("/flows/:name", async (req: Request, res: Response) => {
  const name = req.params.name;
  if (name === "pin") {
    const result = await handleFlowDataExchange(req.body);
    return res.json(result);
  }
  if (name === "send-money") {
    const result = await handleSendMoneyFlowDataExchange(req.body);
    return res.json(result);
  }
  if (name === "confirm-pin") {
    const result = await handleConfirmPinFlowDataExchange(req.body);
    return res.json(result);
  }
  return res.status(404).json({ error: "Unknown flow" });
});
export default router;
