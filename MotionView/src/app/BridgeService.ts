import { invokeCommand } from "../tauri/commands";

interface BridgeWindow extends Window {
  __BRIDGE_ORIGIN__?: string;
  __BRIDGE_TOKEN__?: string;
}

export interface BridgeResponse<T> {
  readonly ok: boolean;
  readonly status: number;
  readonly json: T | null;
}

export interface BridgeRequestOptions {
  readonly timeoutMs?: number;
  readonly waitForReady?: boolean;
}

/** Owns bridge discovery, readiness caching, and typed HTTP requests. */
export class BridgeService {
  #origin: string | null = null;
  #token: string | null = null;
  #ready = false;
  #readyAt = 0;
  #lastReadyCheckAt = 0;
  #readyProbe: Promise<boolean> | null = null;

  get origin(): string | null {
    return this.refreshInjectedOrigin();
  }

  get websocketOrigin(): string | null {
    return this.origin?.replace(/^http/, "ws") ?? null;
  }

  get websocketUrl(): string | null {
    const origin = this.websocketOrigin;
    const token = this.refreshInjectedToken();
    return origin && token ? `${origin}/ws?token=${encodeURIComponent(token)}` : null;
  }

  get available(): boolean {
    return this.origin != null;
  }

  async resolveOrigin(): Promise<string | null> {
    const injected = this.refreshInjectedOrigin();
    const injectedToken = this.refreshInjectedToken();
    if (injected && injectedToken) return injected;
    try {
      const [origin, token] = await Promise.all([
        invokeCommand<string | null>("get_bridge_origin"),
        invokeCommand<string | null>("get_bridge_token"),
      ]);
      if (origin) this.#origin = origin;
      if (token) this.#token = token;
    } catch {
      // The web build has no native bridge. Startup must remain functional.
    }
    return this.refreshInjectedOrigin();
  }

  async isReady(): Promise<boolean> {
    const origin = await this.resolveOrigin();
    if (!origin) return false;

    const now = Date.now();
    if (this.#ready && now - this.#readyAt < 2_000) return true;
    if (this.#readyProbe) return this.#readyProbe;
    if (now - this.#lastReadyCheckAt < 1_000) return false;
    this.#lastReadyCheckAt = now;

    this.#readyProbe = (async () => {
      const response = await this.request<Record<string, unknown>>("GET", "/api/status", undefined, {
        timeoutMs: 1_000,
        waitForReady: false,
      });
      this.#ready = response.ok && response.json != null;
      if (this.#ready) this.#readyAt = Date.now();
      return this.#ready;
    })().finally(() => {
      this.#readyProbe = null;
    });
    return this.#readyProbe;
  }

  async waitUntilReady(maxWaitMs = 8_000, pollMs = 200): Promise<boolean> {
    const deadline = Date.now() + Math.max(0, maxWaitMs);
    while (Date.now() < deadline) {
      if (await this.isReady()) return true;
      await new Promise<void>((resolve) => setTimeout(resolve, pollMs));
    }
    return false;
  }

  get<T>(path: string, options?: BridgeRequestOptions): Promise<BridgeResponse<T>> {
    return this.request<T>("GET", path, undefined, options);
  }

  post<T>(path: string, body?: unknown, options?: BridgeRequestOptions): Promise<BridgeResponse<T>> {
    return this.request<T>("POST", path, body, options);
  }

  async log(level: string, message: string, tag?: string): Promise<void> {
    if (!this.#ready) return;
    await this.post("/api/log", { level, message, tag }, { timeoutMs: 800, waitForReady: false });
  }

  private refreshInjectedOrigin(): string | null {
    if (typeof window !== "object") return this.#origin;
    const injected = (window as BridgeWindow).__BRIDGE_ORIGIN__;
    if (injected) this.#origin = injected;
    return this.#origin;
  }

  private refreshInjectedToken(): string | null {
    if (typeof window !== "object") return this.#token;
    const injected = (window as BridgeWindow).__BRIDGE_TOKEN__;
    if (injected) this.#token = injected;
    return this.#token;
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    options: BridgeRequestOptions = {},
  ): Promise<BridgeResponse<T>> {
    if (!path || path === "/no HTTP/1.1" || path === "/ HTTP/1.1") {
      return { ok: false, status: 0, json: null };
    }
    const origin = await this.resolveOrigin();
    const token = this.refreshInjectedToken();
    if (!origin || !token) return { ok: false, status: 0, json: null };
    if (options.waitForReady !== false && !(await this.waitUntilReady(4_000, 200))) {
      return { ok: false, status: 0, json: null };
    }

    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 5_000);
    try {
      const response = await fetch(`${origin}${normalizedPath}`, {
        method,
        headers: {
          "X-MotionView-Token": token,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      let json: T | null = null;
      try {
        json = await response.json() as T;
      } catch {
        // Some bridge failure responses do not contain JSON.
      }
      return { ok: response.ok, status: response.status, json };
    } catch {
      return { ok: false, status: 0, json: null };
    } finally {
      clearTimeout(timeout);
    }
  }
}
