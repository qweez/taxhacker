import { describe, it, expect, vi, beforeEach } from "vitest"
import { checkRateLimit } from "@/lib/rate-limit"

describe("rate-limit", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("allows the first request", () => {
    const key = `test-first-${Date.now()}-${Math.random()}`
    const result = checkRateLimit(key, 5, 60_000)
    expect(result.allowed).toBe(true)
  })

  it("allows requests within the limit", () => {
    const key = `test-within-${Date.now()}-${Math.random()}`
    for (let i = 0; i < 5; i++) {
      const result = checkRateLimit(key, 5, 60_000)
      expect(result.allowed).toBe(true)
    }
  })

  it("denies requests exceeding the limit", () => {
    const key = `test-exceed-${Date.now()}-${Math.random()}`
    // Use up all 3 allowed requests
    for (let i = 0; i < 3; i++) {
      checkRateLimit(key, 3, 60_000)
    }
    // The 4th should be denied
    const result = checkRateLimit(key, 3, 60_000)
    expect(result.allowed).toBe(false)
  })

  it("returns positive retryAfterMs when denied", () => {
    const key = `test-retry-${Date.now()}-${Math.random()}`
    for (let i = 0; i < 2; i++) {
      checkRateLimit(key, 2, 60_000)
    }
    const result = checkRateLimit(key, 2, 60_000)
    expect(result.allowed).toBe(false)
    expect(result.retryAfterMs).toBeDefined()
    expect(result.retryAfterMs).toBeGreaterThan(0)
    expect(result.retryAfterMs).toBeLessThanOrEqual(60_000)
  })

  it("treats different keys independently", () => {
    const keyA = `test-indep-a-${Date.now()}-${Math.random()}`
    const keyB = `test-indep-b-${Date.now()}-${Math.random()}`

    // Exhaust keyA
    for (let i = 0; i < 2; i++) {
      checkRateLimit(keyA, 2, 60_000)
    }

    // keyA should be denied
    expect(checkRateLimit(keyA, 2, 60_000).allowed).toBe(false)
    // keyB should still be allowed
    expect(checkRateLimit(keyB, 2, 60_000).allowed).toBe(true)
  })

  it("resets the count after the window expires", () => {
    const key = `test-expiry-${Date.now()}-${Math.random()}`
    const windowMs = 1000

    // Mock Date.now to control time
    let currentTime = 1000000
    vi.spyOn(Date, "now").mockImplementation(() => currentTime)

    // Use up all requests
    for (let i = 0; i < 3; i++) {
      checkRateLimit(key, 3, windowMs)
    }
    expect(checkRateLimit(key, 3, windowMs).allowed).toBe(false)

    // Advance time past the window
    currentTime += windowMs + 1

    // Should be allowed again
    const result = checkRateLimit(key, 3, windowMs)
    expect(result.allowed).toBe(true)
  })
})
