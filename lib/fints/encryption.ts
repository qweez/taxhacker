import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from "node:crypto"

const ALGORITHM = "aes-256-gcm"
const KEY_LENGTH = 32
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16
const PBKDF2_ITERATIONS = 100_000
const PBKDF2_SALT = Buffer.from("taxhacker-fints-pin-encryption", "utf8")

function deriveKey(): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET environment variable is not set — cannot encrypt/decrypt FinTS PIN")
  }
  return pbkdf2Sync(secret, PBKDF2_SALT, PBKDF2_ITERATIONS, KEY_LENGTH, "sha512")
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Returns a string in the format `iv:authTag:ciphertext` (hex-encoded).
 */
export function encryptPin(plaintext: string): string {
  if (!plaintext) {
    throw new Error("Cannot encrypt an empty PIN")
  }

  const key = deriveKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH })

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const authTag = cipher.getAuthTag()

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`
}

/**
 * Decrypts a string produced by `encryptPin`.
 * Expects the format `iv:authTag:ciphertext` (hex-encoded).
 */
export function decryptPin(encrypted: string): string {
  if (!encrypted) {
    throw new Error("Cannot decrypt an empty value")
  }

  const parts = encrypted.split(":")
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted PIN format — expected iv:authTag:ciphertext")
  }

  const [ivHex, authTagHex, ciphertextHex] = parts
  const iv = Buffer.from(ivHex, "hex")
  const authTag = Buffer.from(authTagHex, "hex")
  const ciphertext = Buffer.from(ciphertextHex, "hex")

  if (iv.length !== IV_LENGTH) {
    throw new Error(`Invalid IV length: expected ${IV_LENGTH} bytes, got ${iv.length}`)
  }
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error(`Invalid auth tag length: expected ${AUTH_TAG_LENGTH} bytes, got ${authTag.length}`)
  }

  const key = deriveKey()
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH })
  decipher.setAuthTag(authTag)

  try {
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return decrypted.toString("utf8")
  } catch {
    throw new Error("Failed to decrypt PIN — the data may be corrupted or the encryption key has changed")
  }
}
