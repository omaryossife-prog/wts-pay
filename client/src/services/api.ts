// Central API client. Never exposes secrets; JWT is held in memory/localStorage
// and sent as a Bearer token. Every mutating request carries the CSRF header.
const TOKEN_KEY = "wts_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string | null) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Requested-With": "XMLHttpRequest",
    ...(options.headers as Record<string, string>),
  };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(path, { ...options, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) setToken(null);
    throw new ApiError(res.status, (body as any).error ?? `Request failed (${res.status})`);
  }
  return body as T;
}

function uuid(): string {
  return crypto.randomUUID();
}

export const api = {
  // auth
  register: (data: { phone: string; username: string; password: string; referralCode?: string }) =>
    request<{ user: any; token: string }>("/api/auth/register", { method: "POST", body: JSON.stringify(data) }),
  login: (data: { phone: string; password: string }) =>
    request<{ user: any; token: string }>("/api/auth/login", { method: "POST", body: JSON.stringify(data) }),
  logout: () => request("/api/auth/logout", { method: "POST" }),

  // wallet
  wallet: () => request<{ user: User; notice: string }>("/api/wallet/"),
  quote: (amount: number) =>
    request<{ amount: number; fee: number; totalDebit: number }>("/api/wallet/quote", {
      method: "POST",
      body: JSON.stringify({ amount }),
    }),
  transfer: (data: { recipientPhone: string; amount: number; description?: string }) =>
    request<{ transaction: Transaction; duplicate: boolean }>("/api/wallet/transfer", {
      method: "POST",
      headers: { "Idempotency-Key": uuid() },
      body: JSON.stringify(data),
    }),
  transactions: (page = 1) =>
    request<{ items: Transaction[]; total: number }>(`/api/wallet/transactions?page=${page}&limit=20`),

  // referrals
  referrals: () =>
    request<{ referralCode: string; referrals: Referral[]; rewardedCount: number; totalEarned: number; rules: any }>(
      "/api/referrals/"
    ),

  // admin
  adminStats: () => request<AdminStats>("/api/admin/stats"),
  adminUsers: (q = "") => request<{ users: any[] }>(`/api/admin/users?q=${encodeURIComponent(q)}`),
  adminUser: (id: string) =>
    request<{ user: any; transactions: Transaction[]; referrals: Referral[]; auditLogs: any[] }>(`/api/admin/users/${id}`),
  adminFreeze: (userId: string) =>
    request("/api/admin/users/freeze", { method: "POST", body: JSON.stringify({ userId }) }),
  adminUnfreeze: (userId: string) =>
    request("/api/admin/users/unfreeze", { method: "POST", body: JSON.stringify({ userId }) }),
  adminAdjust: (data: { userId: string; amount: number; reason: string }) =>
    request("/api/admin/adjust", {
      method: "POST",
      body: JSON.stringify({ ...data, idempotencyKey: uuid() }),
    }),
  adminReverse: (data: { transactionId: string; reason: string }) =>
    request("/api/admin/reverse", {
      method: "POST",
      body: JSON.stringify({ ...data, idempotencyKey: uuid() }),
    }),
  adminConfig: () => request<ConfigBundle>("/api/admin/config"),
  adminSetConfig: (key: string, value: unknown) =>
    request("/api/admin/config", { method: "PUT", body: JSON.stringify({ key, value }) }),
  adminAudit: () => request<{ logs: any[] }>("/api/admin/audit"),
  adminVerifications: () => request<{ items: PendingVerification[] }>("/api/admin/verifications/pending"),
  adminApprove: (userId: string) =>
    request("/api/admin/verifications/approve", { method: "POST", body: JSON.stringify({ userId }) }),
  adminReject: (userId: string, reason: string) =>
    request("/api/admin/verifications/reject", { method: "POST", body: JSON.stringify({ userId, reason }) }),
  adminSetTransfers: (userId: string, enabled: boolean) =>
    request("/api/admin/users/transfers", { method: "POST", body: JSON.stringify({ userId, enabled }) }),
  adminResetPin: (userId: string) =>
    request("/api/admin/users/reset-pin", { method: "POST", body: JSON.stringify({ userId }) }),
  adminTransactions: (type = "") => request<{ items: Transaction[] }>(`/api/admin/transactions${type ? `?type=${type}` : ""}`),
};

import type { User, Transaction, Referral, AdminStats, ConfigBundle, PendingVerification } from "../types";
