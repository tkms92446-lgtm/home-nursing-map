/** 単純な最小間隔レートリミッタ（同一プロセス内） */
export class RateLimiter {
  private next = 0;
  constructor(private readonly intervalMs: number) {}

  async wait(): Promise<void> {
    const now = Date.now();
    const at = Math.max(now, this.next);
    this.next = at + this.intervalMs;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  }
}

/** 指数バックオフ付きリトライ */
export async function withRetry<T>(fn: () => Promise<T>, retries = 2, baseMs = 500): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < retries) await new Promise((r) => setTimeout(r, baseMs * 2 ** i));
    }
  }
  throw lastErr;
}
