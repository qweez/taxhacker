import { describe, it, expect, vi, beforeEach } from "vitest"
import { encryptPin, decryptPin } from "@/lib/fints/encryption"

describe("encryption", () => {
  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = "test-secret-key-for-unit-tests-only"
  })

  describe("encrypt/decrypt roundtrip", () => {
    it("decrypts back to the original plaintext", () => {
      const pin = "12345"
      const encrypted = encryptPin(pin)
      const decrypted = decryptPin(encrypted)
      expect(decrypted).toBe(pin)
    })

    it("handles unicode characters", () => {
      const pin = "p\u00e4ssw\u00f6rd-\u00fc\u00df"
      const encrypted = encryptPin(pin)
      expect(decryptPin(encrypted)).toBe(pin)
    })

    it("handles long PINs", () => {
      const pin = "a".repeat(1000)
      const encrypted = encryptPin(pin)
      expect(decryptPin(encrypted)).toBe(pin)
    })
  })

  describe("output format", () => {
    it("produces iv:authTag:ciphertext format", () => {
      const encrypted = encryptPin("mypin")
      const parts = encrypted.split(":")
      expect(parts).toHaveLength(3)
    })

    it("all parts are hex-encoded", () => {
      const encrypted = encryptPin("mypin")
      const parts = encrypted.split(":")
      for (const part of parts) {
        expect(part).toMatch(/^[0-9a-f]+$/)
      }
    })

    it("IV is 16 bytes (32 hex chars)", () => {
      const encrypted = encryptPin("mypin")
      const iv = encrypted.split(":")[0]
      expect(iv).toHaveLength(32)
    })

    it("auth tag is 16 bytes (32 hex chars)", () => {
      const encrypted = encryptPin("mypin")
      const authTag = encrypted.split(":")[1]
      expect(authTag).toHaveLength(32)
    })
  })

  describe("different secrets produce different ciphertexts", () => {
    it("encrypting with different BETTER_AUTH_SECRET produces different results", () => {
      process.env.BETTER_AUTH_SECRET = "secret-one"
      const encrypted1 = encryptPin("samepin")

      process.env.BETTER_AUTH_SECRET = "secret-two"
      const encrypted2 = encryptPin("samepin")

      expect(encrypted1).not.toBe(encrypted2)
    })
  })

  describe("different PINs produce different ciphertexts", () => {
    it("different plaintexts produce different ciphertext portions", () => {
      const encrypted1 = encryptPin("pin-aaa")
      const encrypted2 = encryptPin("pin-bbb")

      const ciphertext1 = encrypted1.split(":")[2]
      const ciphertext2 = encrypted2.split(":")[2]
      expect(ciphertext1).not.toBe(ciphertext2)
    })
  })

  describe("tampered ciphertext", () => {
    it("throws error when ciphertext is modified", () => {
      const encrypted = encryptPin("mypin")
      const parts = encrypted.split(":")
      // Flip a character in the ciphertext
      const tampered = parts[2].startsWith("a")
        ? "b" + parts[2].slice(1)
        : "a" + parts[2].slice(1)
      const tamperedStr = `${parts[0]}:${parts[1]}:${tampered}`

      expect(() => decryptPin(tamperedStr)).toThrow()
    })

    it("throws error when auth tag is modified", () => {
      const encrypted = encryptPin("mypin")
      const parts = encrypted.split(":")
      const tampered = parts[1].startsWith("a")
        ? "b" + parts[1].slice(1)
        : "a" + parts[1].slice(1)
      const tamperedStr = `${parts[0]}:${tampered}:${parts[2]}`

      expect(() => decryptPin(tamperedStr)).toThrow()
    })
  })

  describe("empty PIN", () => {
    it("throws error when encrypting empty string", () => {
      expect(() => encryptPin("")).toThrow("Cannot encrypt an empty PIN")
    })

    it("throws error when decrypting empty string", () => {
      expect(() => decryptPin("")).toThrow("Cannot decrypt an empty value")
    })
  })

  describe("invalid format", () => {
    it("throws error when format has too few parts", () => {
      expect(() => decryptPin("onlytwoparts:here")).toThrow("Invalid encrypted PIN format")
    })

    it("throws error when format has too many parts", () => {
      expect(() => decryptPin("a:b:c:d")).toThrow("Invalid encrypted PIN format")
    })

    it("throws error when IV length is wrong", () => {
      expect(() => decryptPin("abcd:00112233445566778899aabbccddeeff:aabb")).toThrow("Invalid IV length")
    })
  })

  describe("missing BETTER_AUTH_SECRET", () => {
    it("throws error when env var is not set", () => {
      delete process.env.BETTER_AUTH_SECRET
      expect(() => encryptPin("mypin")).toThrow("BETTER_AUTH_SECRET")
    })
  })
})
