// ---------------------------------------------------------------------------
// PaymentProvider interface.
// Today only DemoPaymentProvider exists (internal demo credits, no real money,
// no banks, no InstaPay, no Fawry, no cash-out).
// A future licensed provider implements this same interface - wallet/ledger/
// business logic stays untouched.
// ---------------------------------------------------------------------------
export interface PaymentResult {
  providerRef: string;
  status: "PENDING" | "COMPLETED" | "FAILED";
  raw?: unknown;
}

export interface PaymentProvider {
  readonly name: string;
  createDeposit(amount: number, userId: string): Promise<PaymentResult>;
  verifyDeposit(providerRef: string): Promise<PaymentResult>;
  createWithdrawal(amount: number, userId: string): Promise<PaymentResult>;
  verifyWithdrawal(providerRef: string): Promise<PaymentResult>;
}
