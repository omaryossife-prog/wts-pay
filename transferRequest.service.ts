// ---------------------------------------------------------------------------
// "طلب تحويل": مستخدم (requester) بيطلب من مستخدم تاني (payer) إنه
// يحوّله مبلغ معيّن. لو الـ payer وافق، لازم يأكد بالـ PIN بتاعه، وبعدين
// بيتنفذ تحويل حقيقي من الـ payer للـ requester — نفس آلية أي تحويل عادي.
// ---------------------------------------------------------------------------
import crypto from "crypto";
import type { Db } from "../utils/prisma.js";
import { getLimitsConfig } from "./config.service.js";
import { verifyPin } from "./pin.service.js";
import { transferInTx, WalletError } from "./wallet.service.js";

export class TransferRequestError extends Error {
  code:
    | "USER_NOT_FOUND"
    | "SELF_REQUEST"
    | "INVALID_AMOUNT"
    | "LIMIT_EXCEEDED"
    | "NOT_FOUND"
    | "WRONG_USER"
    | "ALREADY_RESOLVED"
    | "EXPIRED" = "NOT_FOUND";
  constructor(code: TransferRequestError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

const REQUEST_TTL_HOURS = 72;

export async function createTransferRequest(
  db: Db,
  input: { requesterId: string; payerPhone: string; amount: number; description?: string }
) {
  const client: any = db;

  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new TransferRequestError("INVALID_AMOUNT", "Amount must be a positive integer.");
  }
  const limits = await getLimitsConfig(client);
  if (input.amount < limits.minTransfer || input.amount > limits.maxTransfer) {
    throw new TransferRequestError("LIMIT_EXCEEDED", `Amount must be between ${limits.minTransfer} and ${limits.maxTransfer} EGP.`);
  }

  const phone = input.payerPhone.replace(/[\s\-()]/g, "");
  const payer = await client.user.findUnique({ where: { phone } });
  if (!payer) throw new TransferRequestError("USER_NOT_FOUND", "No WTS user with that phone number.");
  if (payer.id === input.requesterId) throw new TransferRequestError("SELF_REQUEST", "You cannot request money from yourself.");

  const request = await client.transferRequest.create({
    data: {
      requesterId: input.requesterId,
      payerId: payer.id,
      amount: input.amount,
      description: input.description,
      idempotencyKey: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + REQUEST_TTL_HOURS * 3600 * 1000),
    },
  });

  return { request, payer };
}

export async function listIncomingRequests(db: Db, userId: string) {
  const client: any = db;
  return client.transferRequest.findMany({
    where: { payerId: userId, status: "PENDING" },
    orderBy: { createdAt: "desc" },
    include: { requester: { select: { phone: true, username: true, wtsId: true } } },
  });
}

export async function listOutgoingRequests(db: Db, userId: string) {
  const client: any = db;
  return client.transferRequest.findMany({
    where: { requesterId: userId },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { payer: { select: { phone: true, username: true, wtsId: true } } },
  });
}

async function loadPendingRequestForPayer(client: any, requestId: string, payerId: string) {
  const request = await client.transferRequest.findUnique({ where: { id: requestId } });
  if (!request) throw new TransferRequestError("NOT_FOUND", "Request not found.");
  if (request.payerId !== payerId) throw new TransferRequestError("WRONG_USER", "This request was not sent to you.");
  if (request.status !== "PENDING") throw new TransferRequestError("ALREADY_RESOLVED", "This request was already resolved.");
  if (request.expiresAt < new Date()) {
    await client.transferRequest.update({ where: { id: request.id }, data: { status: "EXPIRED" } });
    throw new TransferRequestError("EXPIRED", "This request has expired.");
  }
  return request;
}

export async function rejectTransferRequest(db: Db, input: { requestId: string; payerId: string }) {
  const client: any = db;
  const request = await loadPendingRequestForPayer(client, input.requestId, input.payerId);
  return client.transferRequest.update({
    where: { id: request.id },
    data: { status: "REJECTED", respondedAt: new Date() },
  });
}

export async function cancelTransferRequest(db: Db, input: { requestId: string; requesterId: string }) {
  const client: any = db;
  const request = await client.transferRequest.findUnique({ where: { id: input.requestId } });
  if (!request) throw new TransferRequestError("NOT_FOUND", "Request not found.");
  if (request.requesterId !== input.requesterId) throw new TransferRequestError("WRONG_USER", "Not your request.");
  if (request.status !== "PENDING") throw new TransferRequestError("ALREADY_RESOLVED", "This request was already resolved.");
  return client.transferRequest.update({
    where: { id: request.id },
    data: { status: "CANCELED", respondedAt: new Date() },
  });
}

// موافقة الـ payer + تأكيد الـ PIN + تنفيذ التحويل الحقيقي — كل ده خطوة واحدة.
export async function acceptTransferRequest(
  db: Db,
  input: { requestId: string; payerId: string; pin: string; ip?: string }
) {
  const client: any = db;

  // PIN بيتفحص برّه الترانزاكشن الأساسية عشان محاولات الـ lockout تتسجل
  // حتى لو الطلب نفسه بقى مش صالح (مثلاً انتهى في نفس اللحظة).
  await verifyPin(client, { userId: input.payerId, pin: input.pin, ip: input.ip });

  return client.$transaction(async (tx: any) => {
    const request = await loadPendingRequestForPayer(tx, input.requestId, input.payerId);
    const requester = await tx.user.findUnique({ where: { id: request.requesterId } });
    if (!requester) throw new WalletError("USER_NOT_FOUND", "Requester not found.");

    const { transaction } = await transferInTx(tx, {
      senderId: input.payerId,
      recipientPhone: requester.phone,
      amount: request.amount,
      idempotencyKey: request.idempotencyKey,
      description: request.description ?? "Transfer request",
    });

    const updated = await tx.transferRequest.update({
      where: { id: request.id },
      data: { status: "ACCEPTED", respondedAt: new Date(), transactionId: transaction.id },
    });

    return { request: updated, transaction, requester };
  });
}
