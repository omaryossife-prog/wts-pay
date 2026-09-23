// ---------------------------------------------------------------------------
// Payload builders for the official Meta WhatsApp Cloud API.
// Reusable: text, reply buttons, interactive buttons, list messages, native
// Flow launch. Official API only.
// ---------------------------------------------------------------------------

export interface WaButton {
  id: string;
  title: string; // max 20 chars
}

export interface WaListSectionRow {
  id: string;
  title: string; // max 24 chars
  description?: string; // max 72 chars
}

export function textMessagePayload(to: string, body: string) {
  return { messaging_product: "whatsapp", to, type: "text", text: { body, preview_url: false } };
}

export function buttonMessagePayload(to: string, body: string, buttons: WaButton[]) {
  return {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: body },
      action: {
        buttons: buttons.slice(0, 3).map((b) => ({
          type: "reply",
          reply: { id: b.id, title: b.title.slice(0, 20) },
        })),
      },
    },
  };
}

export function listMessagePayload(to: string, body: string, buttonLabel: string, sections: { title: string; rows: WaListSectionRow[] }[]) {
  return {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: body },
      action: {
        button: buttonLabel.slice(0, 20),
        sections: sections.map((s) => ({
          title: s.title.slice(0, 24),
          rows: s.rows.slice(0, 10).map((r) => ({
            id: r.id,
            title: r.title.slice(0, 24),
            ...(r.description ? { description: r.description.slice(0, 72) } : {}),
          })),
        })),
      },
    },
  };
}

// Launch a WhatsApp-native Flow (no external browser).
export function flowMessagePayload(to: string, flowId: string, flowToken: string, body: string, buttonLabel: string) {
  return {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "flow",
      body: { text: body },
      action: {
        name: "flow",
        parameters: { flow_id: flowId, flow_token: flowToken, flow_cta: buttonLabel.slice(0, 20) },
      },
    },
  };
}

// Action ids - button/list replies map to backend actions in whatsapp.handler
export const ACTIONS = {
  START: "start",
  CREATE_ACCOUNT: "create_account",
  YES: "yes",
  NO: "no",
  BALANCE: "menu_balance",
  SEND_MONEY: "menu_send",
  TRANSACTIONS: "menu_tx",
  REFERRALS: "menu_referrals",
  ACCOUNT: "menu_account",
  HELP: "menu_help",
  CREATE_PIN: "create_pin",
  CONFIRM_TRANSFER: "confirm_transfer",
  CANCEL: "cancel_action",
} as const;

export const GREETING_TEXT =
  "Welcome to WTS Pay \u{1F4B3}\nDemo digital wallet — demo credits have no cash value.\nChoose an option:";

export const START_BUTTON: WaButton = { id: ACTIONS.START, title: "\u{1F680} Start" };

export const MAIN_MENU_ROWS: WaListSectionRow[] = [
  { id: ACTIONS.BALANCE, title: "\u{1F4B0} Balance", description: "Check your demo balance" },
  { id: ACTIONS.SEND_MONEY, title: "\u{1F4B8} Send Money", description: "Transfer to another WTS user" },
  { id: ACTIONS.TRANSACTIONS, title: "\u{1F4DC} Transactions", description: "Your recent activity" },
  { id: ACTIONS.REFERRALS, title: "\u{1F381} Referrals", description: "Invite and earn demo credits" },
  { id: ACTIONS.ACCOUNT, title: "\u{1F464} My Account", description: "Profile, WTS ID and status" },
  { id: ACTIONS.HELP, title: "\u{2753} Help", description: "How WTS Pay demo works" },
];

export function approvalMessage(wtsId: string, walletId: string, balance: number): string {
  return (
    `\u{1F389} Your WTS Pay account has been approved.\n` +
    `Your wallet is now active.\n\n` +
    `WTS ID:\n${wtsId}\nWallet:\n${walletId}\nBalance:\n${balance} EGP\n\n` +
    `Next step: create your 6-digit WTS transaction PIN.`
  );
}
