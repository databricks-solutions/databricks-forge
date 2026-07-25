/**
 * CRUD operations for actual value captures — backed by Lakebase (Prisma).
 */

import { withPrisma } from "@/lib/prisma";
import type { ValueCaptureEntry, ValueType } from "@/lib/domain/types";

function dbRowToCapture(row: {
  id: string;
  runId: string;
  useCaseId: string;
  captureDate: Date;
  valueType: string;
  amount: number;
  currency: string;
  evidence: string | null;
  capturedBy: string | null;
}): ValueCaptureEntry {
  return {
    id: row.id,
    runId: row.runId,
    useCaseId: row.useCaseId,
    captureDate: row.captureDate.toISOString(),
    valueType: row.valueType as ValueType,
    amount: row.amount,
    currency: row.currency,
    evidence: row.evidence,
    capturedBy: row.capturedBy,
  };
}

export async function getValueCapturesForRun(runId: string): Promise<ValueCaptureEntry[]> {
  return withPrisma(async (prisma) => {
    const rows = await prisma.forgeValueCapture.findMany({
      where: { runId },
      orderBy: { captureDate: "desc" },
    });
    return rows.map(dbRowToCapture);
  });
}

export async function getTotalDeliveredValue(): Promise<number> {
  return withPrisma(async (prisma) => {
    const result = await prisma.forgeValueCapture.aggregate({
      _sum: { amount: true },
    });
    return result._sum.amount ?? 0;
  });
}

export async function createValueCapture(data: {
  runId: string;
  useCaseId: string;
  captureDate: Date;
  valueType: ValueType;
  amount: number;
  currency?: string;
  evidence?: string;
  capturedBy?: string;
}): Promise<ValueCaptureEntry> {
  return withPrisma(async (prisma) => {
    const row = await prisma.forgeValueCapture.create({
      data: {
        runId: data.runId,
        useCaseId: data.useCaseId,
        captureDate: data.captureDate,
        valueType: data.valueType,
        amount: data.amount,
        currency: data.currency ?? "USD",
        evidence: data.evidence ?? null,
        capturedBy: data.capturedBy ?? null,
      },
    });
    return dbRowToCapture(row);
  });
}

export async function deleteValueCapture(id: string): Promise<void> {
  await withPrisma(async (prisma) => {
    await prisma.forgeValueCapture.delete({ where: { id } });
  });
}
