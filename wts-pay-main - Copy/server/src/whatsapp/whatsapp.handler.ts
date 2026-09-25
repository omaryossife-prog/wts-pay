// ---------------------------------------------------------------------------
// Routes incoming WhatsApp messages to actions.
// Flow: WhatsApp -> Webhook -> Handler -> Existing WTS services -> Supabase.
// Identity: stable wa_id from the official API (never the profile name).
// Authorization: WTS 6-digit PIN via native Flow (preferred) or documented
// chat fallback. A plain incoming message NEVER authorizes a transfer.
// ---------------------------------------------------------------------------
import { prisma } from "../utils/prisma.js";
import { logger } from "../utils/logger.js";
import { sendTextMessage, sendButtonMessage, sendListMessage, markAsRead } from "./whatsapp.client.js";
import { ACTIONS, MAIN_MENU_ROWS, GREETING_TEXT, START_BUTTON, NUMBER_NO_TEXT } from "./whatsapp.templates.js";
import { sendPinFlow, sendWtsActionsFlow } from "./whatsapp.flows.js";
import {
  SessionState, getUserByWaIdentity, getSession, setSession,
  maintenanceActive,
  startRegistration, handleNameInput, confirmNumberYes,
  handleIdFront, handleIdBack, handleFaceVideo,
  handlePinCreateInput, handlePinConfirmInput,
  getBalanceText, getTransactionsText, getReferralText, getAccountText, HELP_TEXT,
  beginSendMoney, handlePhoneInput, handleAmountInput,
  confirmTransfer, cancelTransfer, handleAuthorizationPin,
} from "./whatsapp.service.js";

export interface IncomingMessage {
  from: string;            // phone digits, e.g. "2010xxxxxxx"
  waId: string;            // stable identity from contacts[].wa_id
  profileName?: string;    // display hint ONLY - never used as identity
  id: string;              // wamid - deduped upstream
  type: "text" | "interactive" | "button" | "image" | "video" | "audio" | "document";
  text?: string;
  caption?: string;
  buttonId?: string;
  listId?: string;
}

async function sendMainMenu(to: string, firstName?: string) {
  await sendListMessage(
    to,
    firstName ? `Welcome back, ${firstName} 👋` : "WTS Pay main menu",
    "Open menu",
    [{ title: "WTS Pay", rows: MAIN_MENU_ROWS }]
  );
}

async function routeMenuAction(userId: string, action: string): Promise<string | null> {
  switch (action) {
    case ACTIONS.BALANCE: return getBalanceText(userId);
    case ACTIONS.TRANSACTIONS: return getTransactionsText(userId);
    case ACTIONS.REFERRALS: return getReferralText(userId);
    case ACTIONS.ACCOUNT: return getAccountText(userId);
    case ACTIONS.HELP: return HELP_TEXT;
    case ACTIONS.SEND_MONEY: return beginSendMoney(userId);
    default: return null;
  }
}

export async function handleIncomingMessage(msg: IncomingMessage): Promise<void> {
  const to = msg.from;
  await markAsRead(msg.id);

  // ---------- Identity resolution (wa_id is authoritative) ----------
  let user = await getUserByWaIdentity(prisma, msg.waId, msg.from);
  const replyId = msg.buttonId ?? msg.listId;
  const text = msg.text?.trim() ?? msg.caption?.trim() ?? "";

  // ---------- First contact / not registered ----------
  if (!user) {
    if (replyId === ACTIONS.START) {
      await startRegistration(msg.waId, msg.from, msg.profileName);
      const u = await getUserByWaIdentity(prisma, msg.waId, msg.from);
      await sendButtonMessage(to, "Please enter your full four-part legal name exactly as it appears on your ID.\n\nExample: Ahmed Mohamed Ali Hassan", [
        { id: "noop_name_hint", title: "Type your name" },
      ]);
      if (u) await setSession(u.id, SessionState.REG_NAME, {});
      return;
    }
    await sendButtonMessage(to, GREETING_TEXT, [START_BUTTON]);
    return;
  }

  // ---------- Maintenance mode ----------
  const maint = await maintenanceActive();
  if (maint.enabled) {
    await sendTextMessage(to, maint.message);
    return;
  }

  // ---------- Rejected accounts ----------
  if (user.verificationStatus === "REJECTED") {
    await sendTextMessage(to, `Your WTS Pay registration was rejected. Reason: ${user.rejectionReason ?? "not specified"}. Contact support.`);
    return;
  }

  const session = await getSession(user.id);
  const lower = text.toLowerCase();
  if (lower === "menu") {
    if (user.verificationStatus === "VERIFIED") {
      await setSession(user.id, SessionState.IDLE, {});
      await sendMainMenu(to, user.fullName?.split(" ")[0]);
    } else if (user.verificationStatus === "PENDING_REVIEW") {
      await sendTextMessage(to, "Your registration is under review. Please wait for approval.");
    }
    return;
  }

  // ---------- Registration conversation ----------
  if (user.verificationStatus === "UNVERIFIED") {
    if (replyId === ACTIONS.CREATE_ACCOUNT || replyId === ACTIONS.START) {
      await setSession(user.id, SessionState.REG_NAME, {});
      await sendTextMessage(to, "Please enter your full four-part legal name exactly as it appears on your ID.\n\nExample: Ahmed Mohamed Ali Hassan");
      return;
    }
    switch (session.state) {
      case SessionState.REG_NAME: {
        const r = await handleNameInput(user.id, text);
        if (r.ok) {
          await sendButtonMessage(to, r.text, [
            { id: ACTIONS.YES, title: "✅ Yes" },
            { id: ACTIONS.NO, title: "❌ No" },
          ]);
        } else {
          await sendTextMessage(to, r.text);
        }
        return;
      }
      case SessionState.REG_CONFIRM_NUMBER: {
        if (replyId === ACTIONS.YES) {
          await sendTextMessage(to, await confirmNumberYes(user.id));
        } else if (replyId === ACTIONS.NO) {
          await sendTextMessage(to, NUMBER_NO_TEXT);
        } else {
          await sendButtonMessage(to, "Is this your WhatsApp number?", [
            { id: ACTIONS.YES, title: "✅ Yes" },
            { id: ACTIONS.NO, title: "❌ No" },
          ]);
        }
        return;
      }
      case SessionState.REG_ID_FRONT: {
        if (msg.type === "image") {
          // Metadata only - the photo itself stays in WhatsApp (media policy).
          await sendTextMessage(to, await handleIdFront(user.id));
        } else {
          await sendTextMessage(to, "🪪 Please send a clear photo of the front of your ID card.");
        }
        return;
      }
      case SessionState.REG_ID_BACK: {
        if (msg.type === "image") {
          await sendTextMessage(to, await handleIdBack(user.id));
        } else {
          await sendTextMessage(to, "Now send a clear photo of the back of your ID card.");
        }
        return;
      }
      case SessionState.REG_FACE_VIDEO: {
        if (msg.type === "video") {
          await sendTextMessage(to, await handleFaceVideo(user.id));
        } else {
          await sendTextMessage(to, "🎥 Please send a short video of your face, around 5–10 seconds, with good lighting.");
        }
        return;
      }
      default: {
        await sendButtonMessage(
          to,
          "Your WhatsApp account is not registered with WTS Pay.\nWould you like to create a new account?",
          [{ id: ACTIONS.CREATE_ACCOUNT, title: "🚀 Create Account" }]
        );
        return;
      }
    }
  }

  // ---------- Pending review ----------
  if (user.verificationStatus === "PENDING_REVIEW") {
    if (session.state === SessionState.REG_FACE_VIDEO && msg.type === "video") {
      await sendTextMessage(to, await handleFaceVideo(user.id));
      return;
    }
    await sendTextMessage(to, "Your registration has been submitted for review. ✅ Please wait for approval.");
    return;
  }

  // ---------- Verified users ----------
  // Force PIN creation before anything else if missing.
  if (!user.pinHash) {
    if (replyId === ACTIONS.CREATE_PIN) {
      const sent = await sendPinFlow(to, user.id);
      if (!sent) {
        await setSession(user.id, SessionState.PIN_CREATE, {});
        await sendTextMessage(
          to,
          "Create your WTS transaction PIN.\n\n" +
          "⚠️ Documented limitation: no WhatsApp Flow is configured for secure in-chat PIN entry, " +
          "so as the officially supported fallback, please type a new 6-digit PIN now. " +
          "It will be hashed immediately and never displayed again. " +
          "For the native PIN screen, configure WHATSAPP_PIN_FLOW_ID (see README)."
        );
      }
      return;
    }
    if (session.state === SessionState.PIN_CREATE) {
      const r = await handlePinCreateInput(user.id, text);
      await sendTextMessage(to, r.text);
      return;
    }
    if (session.state === SessionState.PIN_CONFIRM) {
      const r = await handlePinConfirmInput(user.id, text);
      await sendTextMessage(to, r.text);
      return;
    }
    await sendButtonMessage(
      to,
      "🎉 Your WTS Pay account is approved. Create your 6-digit WTS transaction PIN to activate transfers.",
      [{ id: ACTIONS.CREATE_PIN, title: "🔐 Create PIN" }]
    );
    return;
  }

  // Prefer the native WhatsApp Flow for Send Money when configured; keep the
  // existing chat flow as the documented fallback.
  if (replyId === ACTIONS.SEND_MONEY) {
    const sent = await sendWtsActionsFlow(to, user.id);
    if (sent) return;
  }

  // Menu shortcuts
  if (replyId) {
    const menuText = await routeMenuAction(user.id, replyId);
    if (menuText) { await sendTextMessage(to, menuText); return; }
  }

  // Send-money conversation with PIN authorization
  switch (session.state) {
    case SessionState.SEND_WAIT_PHONE: {
      const r = await handlePhoneInput(user.id, text);
      await sendTextMessage(to, r.text);
      return;
    }
    case SessionState.SEND_WAIT_AMOUNT: {
      const r = await handleAmountInput(user.id, text);
      if ("summary" in r) {
        await sendButtonMessage(to, r.summary, [
          { id: ACTIONS.CONFIRM_TRANSFER, title: "🔐 Confirm Transfer" },
          { id: ACTIONS.CANCEL, title: "❌ Cancel" },
        ]);
      } else {
        await sendTextMessage(to, r.text);
      }
      return;
    }
    case SessionState.SEND_CONFIRMATION: {
      if (replyId === ACTIONS.CONFIRM_TRANSFER) {
        const r = await confirmTransfer(user.id);
        await sendTextMessage(to, r.text);
      } else if (replyId === ACTIONS.CANCEL) {
        await sendTextMessage(to, await cancelTransfer(user.id));
      } else {
        await sendTextMessage(to, "Tap Confirm Transfer to continue, or Cancel.");
      }
      return;
    }
    case SessionState.SEND_PIN: {
      if (replyId === ACTIONS.CANCEL) {
        await sendTextMessage(to, await cancelTransfer(user.id));
        return;
      }
      const r = await handleAuthorizationPin(user.id, text);
      await sendTextMessage(to, r);
      return;
    }
    default: {
      if (text && !replyId) {
        // IDLE + free text -> show menu
        await sendMainMenu(to, user.fullName?.split(" ")[0]);
      } else {
        await sendMainMenu(to, user.fullName?.split(" ")[0]);
      }
    }
  }
}

export async function handleStatusUpdate(status: { recipientId: string; status: string }) {
  logger.info("WhatsApp status update", status);
}
