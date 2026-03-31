import { z } from "zod"

// German BLZ: exactly 8 digits
export const bankCodeSchema = z.string().regex(/^\d{8}$/, "BLZ muss genau 8 Ziffern haben")

// IBAN validation (DE format: DE + 2 check digits + 18 digits = 22 chars)
export const ibanSchema = z.string()
  .regex(/^[A-Z]{2}\d{2}[A-Z0-9]{4}\d{7}([A-Z0-9]?){0,16}$/, "Ungültiges IBAN-Format")
  .optional()
  .or(z.literal(""))

// FinTS URL must be HTTPS
export const fintsUrlSchema = z.string().url("Ungültige URL").startsWith("https://", "FinTS URL muss HTTPS sein")

export const addBankAccountSchema = z.object({
  bankCode: bankCodeSchema,
  bankName: z.string().max(128).optional(),
  fintsUrl: fintsUrlSchema,
  fintsUser: z.string().min(1, "Benutzername erforderlich").max(64),
  fintsPin: z.string().min(4, "PIN muss mindestens 4 Zeichen haben").max(64),
  iban: ibanSchema,
  accountNumber: z.string().max(32).optional(),
})

export const syncBankAccountSchema = z.object({
  bankAccountId: z.string().uuid("Ungültige Konto-ID"),
  daysBack: z.number().int().min(1).max(365).default(30),
})

export const submitTanSchema = z.object({
  bankAccountId: z.string().uuid("Ungültige Konto-ID"),
  tanReference: z.string().min(1, "TAN-Referenz erforderlich"),
  tan: z.string().min(3, "TAN zu kurz").max(20, "TAN zu lang"),
})

export const datevExportSchema = z.object({
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
})
