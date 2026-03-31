import { prisma } from "@/lib/db"
import type { AuditLog } from "@/prisma/client"

export async function logAuditEvent(
  userId: string,
  action: string,
  target?: string,
  details?: object,
  ipAddress?: string,
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      userId,
      action,
      target,
      details: details ?? undefined,
      ipAddress,
    },
  })
}

export async function getAuditLogs(
  userId: string,
  limit: number = 50,
): Promise<AuditLog[]> {
  return await prisma.auditLog.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  })
}
