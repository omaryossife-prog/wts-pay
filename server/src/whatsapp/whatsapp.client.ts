// ---------------------------------------------------------------------------
// Thin client for the official Meta WhatsApp Cloud API (Graph API).
// Official API only - no whatsapp-web.js, no Baileys, no browser automation.
// Credentials live server-side in environment variables only.
// ---------------------------------------------------------------------------
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import type { WaButton, WaListSectionRow } from "./whatsapp.templates.js";
import {
  textMessagePayload,
  buttonMessagePayload,
  listMessagePayload,
} from "./whatsapp.templates.js";

const BASE = () =>
  `https://graph.facebook.com/${config.whatsapp.apiVersion}/${config.whatsapp.phoneNumberId}/messages`;

export async function sendWhatsAppPayload(payload: unknown): Promise<{ ok: boolean; status: number }> {
  if (!config.whatsapp.accessToken || !config.whatsapp.phoneNumberId) {
    logger.warn("WhatsApp credentials not configured - payload skipped (demo mode)", payload);
    return { ok: false, status: 0 };
  }
  try {
    const res = await fetch(BASE(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.whatsapp.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text();
      logger.error("WhatsApp send failed", res.status, text);
      return { ok: false, status: res.status };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    logger.error("WhatsApp send error", err);
    return { ok: false, status: 0 };
  }
}

export async function sendTextMessage(to: string, body: string) {
  return sendWhatsAppPayload(textMessagePayload(to, body));
}

export async function sendButtonMessage(to: string, body: string, buttons: WaButton[]) {
  return sendWhatsAppPayload(buttonMessagePayload(to, body, buttons));
}

export async function sendListMessage(
  to: string,
  body: string,
  buttonLabel: string,
  sections: { title: string; rows: WaListSectionRow[] }[]
) {
  return sendWhatsAppPayload(listMessagePayload(to, body, buttonLabel, sections));
}

export async function sendInteractiveMessage(payload: unknown) {
  return sendWhatsAppPayload(payload);
}

// Mark message as read (best effort)
export async function markAsRead(messageId: string) {
  return sendWhatsAppPayload({
    messaging_product: "whatsapp",
    status: "read",
    message_id: messageId,
  });
}
