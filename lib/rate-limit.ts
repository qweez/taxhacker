const store = new Map<string, { count: number; expiresAt: number }>()

let lastCleanup = Date.now()
const CLEANUP_INTERVAL_MS = 60_000

function cleanup() {
  const now = Date.now()
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return
  lastCleanup = now
  store.forEach((entry, key) => {
    if (entry.expiresAt <= now) {
      store.delete(key)
    }
  })
}

export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): { allowed: boolean; retryAfterMs?: number } {
  cleanup()

  const now = Date.now()
  const entry = store.get(key)

  if (!entry || entry.expiresAt <= now) {
    store.set(key, { count: 1, expiresAt: now + windowMs })
    return { allowed: true }
  }

  if (entry.count < maxRequests) {
    entry.count++
    return { allowed: true }
  }

  return { allowed: false, retryAfterMs: entry.expiresAt - now }
}
