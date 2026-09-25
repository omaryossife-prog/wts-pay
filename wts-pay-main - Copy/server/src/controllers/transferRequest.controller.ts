import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../utils/prisma.js";
import {
  createTransferRequest,
  listIncomingRequests,
  listOutgoingRequests,
  rejectTransferRequest,
  cancelTransferRequest,
  acceptTransferRequest,
} from "../services/transferRequest.service.js";
import { maskPhone } from "../utils/phone-mask.js";
import { notifyMoneyRequest, notifyRequestAccepted, notifyRequestRejected } from "../whatsapp/whatsapp.service.js";

export const createRequestSchema = z.object({
  payerPhone: z.string().min(8).max(20),
  amount: z.number().int().positive().max(1_000_000),
  description: z.string().max(200).optional(),
});

export const acceptRequestSchema = z.object({
  pin: z.string().min(4).max(10),
});

export async function createRequestController(req: Request, res: Response) {
  const { request, payer } = await createTransferRequest(prisma, {
    requesterId: req.user!.userId,
    payerPhone: req.body.payerPhone,
    amount: req.body.amount,
    description: req.body.description,
  });
  const requester = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  if (payer.whatsappPhone || payer.phone) {
    await notifyMoneyRequest(payer.whatsappPhone ?? payer.phone, requester?.username ?? "A WTS user", request.amount, request.id).catch(() => {});
  }
  res.status(201).json({ request });
}

export async function incomingRequestsController(req: Request, res: Response) {
  const items = await listIncomingRequests(prisma, req.user!.userId);
  res.json({ items });
}

export async function outgoingRequestsController(req: Request, res: Response) {
  const items = await listOutgoingRequests(prisma, req.user!.userId);
  // نخفي رقم الـ payer في طلبات المستخدم الصادرة له — نفس منطق إخفاء الرقم في سجل العمليات.
  const masked = items.map((r: any) => ({
    ...r,
    payer: r.payer ? { ...r.payer, phone: maskPhone(r.payer.phone) } : r.payer,
  }));
  res.json({ items: masked });
}

export async function rejectRequestController(req: Request, res: Response) {
  const updated = await rejectTransferRequest(prisma, {
    requestId: req.params.id,
    payerId: req.user!.userId,
  });
  const requester = await prisma.user.findUnique({ where: { id: updated.requesterId } });
  if (requester) {
    await notifyRequestRejected(requester.whatsappPhone ?? requester.phone, updated.amount).catch(() => {});
  }
  res.json({ request: updated });
}

export async function cancelRequestController(req: Request, res: Response) {
  const updated = await cancelTransferRequest(prisma, {
    requestId: req.params.id,
    requesterId: req.user!.userId,
  });
  res.json({ request: updated });
}

export async function acceptRequestController(req: Request, res: Response) {
  const { request, transaction, requester } = await acceptTransferRequest(prisma, {
    requestId: req.params.id,
    payerId: req.user!.userId,
    pin: req.body.pin,
    ip: req.ip,
  });
  await notifyRequestAccepted(requester.whatsappPhone ?? requester.phone, request.amount).catch(() => {});
  res.json({ request, transaction });
}
