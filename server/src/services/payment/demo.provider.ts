import type { PaymentProvider, PaymentResult } from "./provider.js";

let seq = 0;
const demoRef = () => `DEMO-${Date.now()}-${++seq}`;

// Demo provider: credits/debits are simulated instantly and only ever touch
// the internal demo ledger. Real money NEVER flows through this provider.
export const demoPaymentProvider: PaymentProvider = {
  name: "demo",

  async createDeposit(amount: number, userId: string): Promise<PaymentResult> {
    if (!Number.isInteger(amount) || amount <= 0) throw new Error("Invalid demo amount.");
    return { providerRef: demoRef(), status: "COMPLETED", raw: { amount, userId, simulated: true } };
  },

  async verifyDeposit(providerRef: string): Promise<PaymentResult> {
    if (!providerRef.startsWith("DEMO-")) throw new Error("Unknown demo deposit ref.");
    return { providerRef, status: "COMPLETED" };
  },

  async createWithdrawal(amount: number, userId: string): Promise<PaymentResult> {
    if (!Number.isInteger(amount) || amount <= 0) throw new Error("Invalid demo amount.");
    // Intentional: demo balances cannot be withdrawn to real rails.
    throw new Error("Demo credits cannot be withdrawn or exchanged for real money.");
  },

  async verifyWithdrawal(providerRef: string): Promise<PaymentResult> {
    throw new Error("Demo credits cannot be withdrawn or exchanged for real money.");
  },
};
