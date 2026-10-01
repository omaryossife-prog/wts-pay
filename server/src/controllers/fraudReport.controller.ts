import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../utils/prisma.js";
import {
  fileFraudReport, listFraudReportsForAdmin, resolveFraudReport, setReportVisibility,
} from "../services/fraudReport.service.js";
import { notifyReportFiled, notifyReportResolved } from "../whatsapp/whatsapp.service.js";
import { normalizeLang } from "../i18n/lang.js";

export const resolveReportSchema = z.object({
  decision: z.enum(["CONFIRMED", "DISMISSED"]),
  adminNote: z.string().max(500).optional(),
});

export const visibilitySchema = z.object({
  visible: z.boolean(),
});

// المستخدم بيبلغ عن عملية (لازم تكون escrow) بعتها هو
export async function fileReportController(req: Request, res: Response) {
  const { report, reportedUser } = await fileFraudReport(prisma, {
    reporterId: req.user!.userId,
    transactionId: req.params.id,
  });
  await notifyReportFiled(reportedUser.whatsappPhone ?? reportedUser.phone, normalizeLang((reportedUser as any).language)).catch(() => {});
  res.status(201).json({ report });
}

// ── أدمن ──────────────────────────────────────────────────────────────
export async function adminListReportsController(req: Request, res: Response) {
  const status = req.query.status as "PENDING" | "CONFIRMED" | "DISMISSED" | undefined;
  const items = await listFraudReportsForAdmin(prisma, status);
  res.json({ items });
}

export async function adminResolveReportController(req: Request, res: Response) {
  const { report, reportedUser } = await resolveFraudReport(prisma, {
    adminId: req.user!.userId,
    reportId: req.params.id,
    decision: req.body.decision,
    adminNote: req.body.adminNote,
    ip: req.ip,
  });
  await notifyReportResolved(
    reportedUser.whatsappPhone ?? reportedUser.phone,
    report.status,
    reportedUser.banned,
    reportedUser.frozenUntil,
    normalizeLang((reportedUser as any).language)
  ).catch(() => {});
  res.json({ report, reportedUser });
}

export async function adminSetVisibilityController(req: Request, res: Response) {
  const report = await setReportVisibility(prisma, {
    adminId: req.user!.userId,
    reportId: req.params.id,
    visible: req.body.visible,
    ip: req.ip,
  });
  res.json({ report });
}
