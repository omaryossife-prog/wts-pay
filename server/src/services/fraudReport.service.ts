// ---------------------------------------------------------------------------
// نظام مضاد النصب: تقديم بلاغ من المرسل على عملية escrow معيّنة، ومراجعة
// الأدمن (بيقرأ الأدلة في واتساب بنفسه) وتأكيد/رفض البلاغ، مع التصعيد
// الأوتوماتيكي (تجميد 30 يوم بعد البلاغ الثاني، حظر نهائي بعد الثالث).
// ---------------------------------------------------------------------------
import type { Db } from "../utils/prisma.js";
import { logAudit } from "./audit.service.js";

export class FraudReportError extends Error {
  code:
    | "TX_NOT_FOUND"
    | "NOT_SENDER"
    | "NOT_ESCROW"
    | "ALREADY_REPORTED"
    | "NOT_FOUND"
    | "ALREADY_RESOLVED" = "NOT_FOUND";
  constructor(code: FraudReportError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

const FREEZE_DAYS = 30;

export async function fileFraudReport(
  db: Db,
  input: { reporterId: string; transactionId: string }
) {
  const client: any = db;
  const transaction = await client.transaction.findUnique({ where: { id: input.transactionId } });
  if (!transaction) throw new FraudReportError("TX_NOT_FOUND", "Transaction not found.");
  if (transaction.senderId !== input.reporterId) {
    throw new FraudReportError("NOT_SENDER", "You can only report a transaction you sent.");
  }
  if (!transaction.escrowEnabled) {
    throw new FraudReportError("NOT_ESCROW", "Only transfers sent with Anti-Fraud protection can be reported.");
  }
  // عملية واحدة = بلاغ واحد بس، للأبد — سواء اتحسم قبل كده أو لسه معلّق.
  // من غير الشرط ده، ممكن نفس العملية تتبلّغ 3 مرات وتصعّد حساب المستلم
  // غلط من حادثة واحدة بس.
  const existing = await client.fraudReport.findFirst({
    where: { transactionId: input.transactionId },
  });
  if (existing) throw new FraudReportError("ALREADY_REPORTED", "This transaction already has a pending report.");

  const reportedUser = await client.user.findUnique({ where: { id: transaction.receiverId } });
  if (!reportedUser) throw new FraudReportError("TX_NOT_FOUND", "Recipient not found.");

  const report = await client.fraudReport.create({
    data: {
      transactionId: transaction.id,
      reporterId: input.reporterId,
      reportedUserId: reportedUser.id,
      reportNumber: reportedUser.fraudReportCount + 1,
      status: "PENDING",
    },
  });
  return { report, reportedUser, transaction };
}

export async function listFraudReportsForAdmin(db: Db, status?: "PENDING" | "CONFIRMED" | "DISMISSED") {
  const client: any = db;
  return client.fraudReport.findMany({
    where: status ? { status } : {},
    orderBy: { createdAt: "desc" },
    include: {
      transaction: { select: { amount: true, createdAt: true } },
      reporter: { select: { phone: true, whatsappPhone: true, username: true } },
      reportedUser: { select: { phone: true, whatsappPhone: true, username: true, fraudReportCount: true, frozenUntil: true, banned: true } },
    },
  });
}

export async function listReportsForUser(db: Db, userId: string) {
  const client: any = db;
  return client.fraudReport.findMany({
    where: { reportedUserId: userId },
    orderBy: { createdAt: "desc" },
  });
}

export async function resolveFraudReport(
  db: Db,
  input: { adminId: string; reportId: string; decision: "CONFIRMED" | "DISMISSED"; adminNote?: string; ip?: string }
) {
  const client: any = db;
  return client.$transaction(async (tx: any) => {
    const report = await tx.fraudReport.findUnique({ where: { id: input.reportId } });
    if (!report) throw new FraudReportError("NOT_FOUND", "Report not found.");
    if (report.status !== "PENDING") throw new FraudReportError("ALREADY_RESOLVED", "This report was already resolved.");

    const updated = await tx.fraudReport.update({
      where: { id: report.id },
      data: { status: input.decision, resolvedAt: new Date(), adminNote: input.adminNote },
    });

    let reportedUser = await tx.user.findUnique({ where: { id: report.reportedUserId } });

    if (input.decision === "CONFIRMED") {
      const newCount = reportedUser.fraudReportCount + 1;
      const data: any = { fraudReportCount: newCount };
      if (newCount === 2) data.frozenUntil = new Date(Date.now() + FREEZE_DAYS * 24 * 3600 * 1000);
      if (newCount >= 3) data.banned = true;
      reportedUser = await tx.user.update({ where: { id: reportedUser.id }, data });
    }

    await logAudit(tx, {
      adminId: input.adminId,
      userId: report.reportedUserId,
      action: input.decision === "CONFIRMED" ? "FRAUD_REPORT_CONFIRMED" : "FRAUD_REPORT_DISMISSED",
      ip: input.ip,
      detail: { reportId: report.id, transactionId: report.transactionId, reportNumber: report.reportNumber },
    });

    return { report: updated, reportedUser };
  });
}

export async function setReportVisibility(
  db: Db,
  input: { adminId: string; reportId: string; visible: boolean; ip?: string }
) {
  const client: any = db;
  const report = await client.fraudReport.update({
    where: { id: input.reportId },
    data: { visible: input.visible },
  });
  await logAudit(client, {
    adminId: input.adminId,
    userId: report.reportedUserId,
    action: "FRAUD_REPORT_VISIBILITY_CHANGED",
    ip: input.ip,
    detail: { reportId: report.id, visible: input.visible },
  });
  return report;
}
