/**
 * Central configuration for the Modal API key pool.
 * All timeouts, cooldowns, and limits live here for easy tuning.
 */
export const POOL_CONFIG = {
  /** Cooldown applied to a key after a 429 / rate-limit response. */
  COOLDOWN_429_MS: 30_000,
  /** Max time a worker waits for a free key before giving up / falling back. */
  ACQUIRE_TIMEOUT_MS: 180_000,
  /** Per-request timeout on the Modal upstream call (main.js). */
  REQUEST_TIMEOUT_MS: 120_000,
  /** Polling interval for the legacy polling-based acquireOrWait (fallback). */
  POLL_INTERVAL_MS: 150,
  /** HTTPS keep-alive linger on sockets (main.js agent). */
  KEEP_ALIVE_MSECS: 30_000,
  /** Max concurrent sockets per Modal hostname. */
  MAX_SOCKETS: 20,
  /** Minimum characters we require before accepting a key as valid. */
  MIN_KEY_LENGTH: 20,
  /** Hard cap on pool size exposed in the UI. */
  MAX_POOL_SIZE: 10,
} as const
