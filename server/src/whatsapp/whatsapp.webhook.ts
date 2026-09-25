// ---------------------------------------------------------------------------
// Meta WhatsApp Cloud API webhook endpoints.
// GET  /api/whatsapp/webhook  - verification handshake
// POST /api/whatsapp/webhook  - incoming events (deduplicated by message id)
// We read contacts[].wa_id (stable identity) and never trust profile names
// as identifiers. Media (ID photos, face videos) is NOT fetched or stored -
// only message metadata is recorded.
// ---------------------------------------------------------------------------
import { Request, Response } from "express";
import { handleIncomingMessage } from "./whatsapp.service";
import { logger } from "../utils/logger";
import { prisma } from "../lib/prisma";

interface WaWebhookBody {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      value?: {
        messaging_product?: string;
        metadata?: { display_phone_number?: string; phone_number_id?: string };
        contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
        messages?: Array<{
          id: string;
          from: string;
          type: string;
          text?: { body: string };
          image?: { caption?: string };
          video?: { caption?: string };
          interactive?: {
            type?: string;
            button_reply?: { id: string; title: string };
            list_reply?: { id: string; title: string };
            nfm_reply?: { response_json: string };
          };
        }>;
        statuses?: Array<unknown>;
      };
    }>;
  }>;
}

export async function receiveWebhook(req: Request, res: Response) {
  try {
    const body = req.body as WaWebhookBody;

    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value) continue;

        // سجل تحديثات حالة الرسائل (تسليم/قراءة)
        for (const status of value.statuses ?? []) {
          logger.info("WA status update:", status);
        }

        // معالجة الرسائل القادمة
        for (const m of value.messages ?? []) {
          // منع تكرار معالجة الرسالة نفسها (Idempotency)
          try {
            await prisma.processedMessage.create({ data: { id: m.id } });
          } catch {
            logger.warn("Duplicate WhatsApp message ignored:", m.id);
            continue;
          }

          const contact = value.contacts?.find((c) => c.wa_id);
          const waId = contact?.wa_id ?? m.from;

          const incoming = {
            from: m.from,
            waId,
            profileName: contact?.profile?.name,
            id: m.id,
            type: m.type,
            text: m.text?.body,
            caption: m.image?.caption ?? m.video?.caption,
            buttonId: m.interactive?.button_reply?.id,
            listId: m.interactive?.list_reply?.id,
          };

          if (m.interactive?.type === "nfm_reply" && m.interactive.nfm_reply?.response_json) {
            try {
              const flowResp = JSON.parse(m.interactive.nfm_reply.response_json);
              if (flowResp?.pin) incoming.text = String(flowResp.pin);
            } catch {
              /* ignore flow response error */
            }
          }

          // انتظار تنفيذ الرد وإرساله عبر API قبل إنهاء الدالة
          try {
            await handleIncomingMessage(incoming);
          } catch (err) {
            logger.error("WhatsApp handler error:", err);
          }
        }
      }
    }

    // إرجاع 200 OK بعد اكتمال المعالجة بالكامل
    return res.status(200).send("EVENT_RECEIVED");
  } catch (error) {
    logger.error("Webhook processing error:", error);
    return res.status(200).send("EVENT_RECEIVED");
  }
}
