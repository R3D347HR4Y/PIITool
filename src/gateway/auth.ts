import { randomUUID } from "node:crypto";

interface Session {
  token: string;
  expires: number;
}

export class AuthManager {
  private sessions = new Map<string, Session>();
  private password: string;
  private ttlMs: number;

  constructor(password: string, ttlMs = 3_600_000) {
    this.password = password;
    this.ttlMs = ttlMs;
  }

  login(password: string): string | null {
    if (password !== this.password) return null;
    const token = randomUUID();
    this.sessions.set(token, { token, expires: Date.now() + this.ttlMs });
    return token;
  }

  logout(token: string): void {
    this.sessions.delete(token);
  }

  validate(request: Request): boolean {
    const cookie = request.headers.get("cookie");
    if (cookie) {
      const match = cookie.match(/piitool_session=([^;\s]+)/);
      if (match) {
        const session = this.sessions.get(match[1]!);
        if (session && session.expires > Date.now()) return true;
        if (session) this.sessions.delete(match[1]!);
      }
    }

    const auth = request.headers.get("authorization");
    if (auth?.startsWith("Bearer ")) {
      return auth.slice(7) === this.password;
    }

    return false;
  }

  tokenFromRequest(request: Request): string | null {
    const cookie = request.headers.get("cookie");
    if (!cookie) return null;
    const match = cookie.match(/piitool_session=([^;\s]+)/);
    return match?.[1] ?? null;
  }

  gc(): void {
    const now = Date.now();
    for (const [token, session] of this.sessions) {
      if (session.expires < now) this.sessions.delete(token);
    }
  }
}
