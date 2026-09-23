// ---------------------------------------------------------------------------
// Meta WhatsApp Cloud API webhook endpoints.
// GET  /api/whatsapp/webhook  - verification handshake
// POST /api/whatsapp/webhook  - incoming events (deduplicated by message id)
// We read contacts[].wa_id (stable identity) and never trust profile names
// as identifiers. Media (ID photos, face videos) is NOT fetched or stored -
// only message metadata is recorded.
// ---------------------------------------------------------------------------
import type { Request, Response } from "express";
import { prisma } from "../utils/prisma.js";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { handleIncomingMessage, type IncomingMessage } from "./whatsapp.handler.js";

export function verifyWebhook(req: Request, res: Response) {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === config.whatsapp.verifyToken) {
    logger.info("WhatsApp webhook verified");
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
}

interface WaWebhookBody {
  entry?: {
    changes?: {
      field?: string;
      value?: {
        contacts?: { profile?: { name?: string }; wa_id?: string }[];
        messages?: {
          from: string;
          id: string;
          type: string;
          text?: { body: string };
          image?: { id: string; caption?: string };
          video?: { id: string; caption?: string };
          interactive?: {
            type: "button_reply" | "list_reply" | "nfm_reply";
            button_reply?: { id: string; title: string };
            list_reply?: { id: string; title: string };
            nfm_reply?: { response_json: string };
          };
        }[];
        statuses?: { id: string; status: string; recipient_id: string }[];
      };
    }[];
  }[];
}

export async function receiveWebhook(req: Request, res: Response) {
  res.sendStatus(200); // always ack quickly; Meta retries otherwise

  const body = req.body as WaWebhookBody;
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      for (const status of value.statuses ?? []) {
        logger.info("WA status", status);
      }

      for (const m of value.messages ?? []) {
        // --- Idempotency: never process the same wamid twice (Meta retries) ---
        try {
          await prisma.processedMessage.create({ data: { id: m.id } });
        } catch {
          logger.warn("Duplicate WhatsApp message ignored", m.id);
          continue;
        }

        // Authoritative identity: wa_id from contacts; fallback to sender digits.
        const contact = value.contacts?.find((c) => c.wa_id);
        const waId = contact?.wa_id ?? m.from;

        const incoming: IncomingMessage = {
          from: m.from,
          waId,
          profileName: contact?.profile?.name,
          id: m.id,
          type: (m.type as IncomingMessage["type"]) ?? "text",
          text: m.text?.body,
          caption: m.image?.caption ?? m.video?.caption,
          buttonId: m.interactive?.button_reply?.id,
          listId: m.interactive?.list_reply?.id,
        };

        // Flow responses arrive as nfm_reply JSON.
        if (m.interactive?.type === "nfm_reply" && m.interactive.nfm_reply?.response_json) {
          try {
            const flowResp = JSON.parse(m.interactive.nfm_reply.response_json);
            if (flowResp?.pin) incoming.text = String(flowResp.pin);
          } catch {
            /* ignore malformed flow response */
          }
        }

        try {
          await handleIncomingMessage(incoming);
        } catch (err) {
          logger.error("WhatsApp handler error", err);
        }
      }
    }
  }
}
