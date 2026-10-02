import { Router } from "express";
import type { Request, Response } from "express";
import { verifyWebhook, receiveWebhook } from "../whatsapp/whatsapp.webhook.js";
import {
  handleFlowDataExchange,
  handleSendMoneyFlowDataExchange,
  handleConfirmPinFlowDataExchange,
  handleWalletFlowDataExchange,
  handleRegDetailsFlowDataExchange,
} from "../whatsapp/whatsapp.flows.js";

const router = Router();
router.get("/webhook", verifyWebhook);
router.post("/webhook", receiveWebhook);

// WhatsApp Flow data exchange (encrypted by Meta).
// "wallet" هو الفلو الموحّد الحالي (المحفظة كلها). "pin" لتفعيل الحساب أول
// مرة. send-money/confirm-pin أقدم فلوهين منفصلين، سايبينهم متاحين كـ fallback
// موثّق فقط، الاستخدام الأساسي دلوقتي على "wallet".
router.post("/flows/:name", async (req: Request, res: Response) => {
  const name = req.params.name;
  if (name === "wallet") {
    const result = await handleWalletFlowDataExchange(req.body);
    return res.json(result);
  }
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
  if (name === "registration-details") {
    const result = await handleRegDetailsFlowDataExchange(req.body);
    return res.json(result);
  }
  return res.status(404).json({ error: "Unknown flow" });
});
export default router;
