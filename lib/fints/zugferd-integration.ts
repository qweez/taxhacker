/**
 * Integration helper for extracting ZUGFeRD / XRechnung e-invoice data
 * from uploaded files.
 */

import { readFile } from "fs/promises"
import path from "path"
import { parseEInvoice, type ZUGFeRDInvoice } from "./zugferd"

/** MIME types and extensions that could contain e-invoice data */
const SUPPORTED_MIMETYPES = [
  "application/pdf",
  "application/xml",
  "text/xml",
  "application/zugferd+xml",
]

const SUPPORTED_EXTENSIONS = [".pdf", ".xml"]

/**
 * Try to extract ZUGFeRD / XRechnung data from an uploaded file.
 * Returns structured invoice data if found, null otherwise.
 */
export async function tryExtractEInvoice(filePath: string): Promise<ZUGFeRDInvoice | null> {
  const ext = path.extname(filePath).toLowerCase()

  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    return null
  }

  try {
    const buffer = await readFile(filePath)

    if (buffer.length === 0) {
      return null
    }

    // For XML files, pass as string for better encoding handling
    if (ext === ".xml") {
      const xmlString = buffer.toString("utf-8")
      return await parseEInvoice(xmlString)
    }

    // For PDFs, pass as buffer
    return await parseEInvoice(buffer)
  } catch (error) {
    console.error("Error extracting e-invoice from file:", filePath, error)
    return null
  }
}
