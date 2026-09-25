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
    // 1. طباعة الـ Payload القادم من واتساب لـ Cloudflare Logs
    console.log("--> Webhook Received Payload:", JSON.stringify(req.body));

    const body = req.body as WaWebhookBody;

    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value) continue;

        for (const m of value.messages ?? []) {
          console.log("--> Incoming Message:", m.from, "| Text:", m.text?.body);

          // منع التكرار
          try {
            await prisma.processedMessage.create({ data: { id: m.id } });
          } catch {
            console.log("--> Message already processed, skipping:", m.id);
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

          // 2. انتظار تنفيذ معالجة الرسالة والرد بـ await
          try {
            console.log("--> Executing handleIncomingMessage...");
            await handleIncomingMessage(incoming);
            console.log("--> Reply sent successfully!");
          } catch (err) {
            console.error("--> Error inside handleIncomingMessage:", err);
          }
        }
      }
    }

    // 3. إرجاع الاستجابة في النهاية لضمان عدم إغلاق الـ Worker قبل معالجة الرد
    return res.status(200).send("EVENT_RECEIVED");
  } catch (error) {
    console.error("--> Webhook global error:", error);
    return res.status(200).send("EVENT_RECEIVED");
  }
}
