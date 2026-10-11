import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { address, BackendEvent, checked, Instance, Snapshot } from "./protocol";
export class BackendClient {
  readonly url: string;
  private token: string;
  private socket?: WebSocket;
  private timer?: NodeJS.Timeout;
  private generation = 0;
  private closed = true;
  private sequence = 0;
  private retry = 0;
  private listeners = new Set<(event: BackendEvent) => void>();
  constructor(readonly instance: Instance) {
    this.url = address(instance.url, instance.local);
    this.token = instance.token;
  }
  onEvent(fn: (event: BackendEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(event: BackendEvent) {
    for (const fn of this.listeners) {
      try {
        fn(event);
      } catch {
        /* A view cannot interrupt delivery. */
      }
    }
  }
  async http(route: string, body?: unknown, timeout = 120000): Promise<any> {
    const response = await fetch(this.url + route, {
      method: body === undefined ? "GET" : "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        "X-CIBYP-Client": "1",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
    const text = await response.text();
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error(
        `Instance returned an invalid response (${response.status}).`,
      );
    }
    if (!response.ok) {
      if (response.status === 401) {
        this.close();
        this.emit({ type: "authentication-required" });
      }
      const error = new Error(
        value.error || `HTTP ${response.status}`,
      ) as Error & { status: number };
      error.status = response.status;
      throw error;
    }
    return value;
  }
  async login(password: string, code = "") {
    const result = checked(
      await this.http("/api/login", { password, code }, 15000),
    );
    if (!result.token) throw new Error("Login returned no session token.");
    this.token = result.token;
    return this.token;
  }
  async request<T = any>(method: string, ...args: unknown[]): Promise<T> {
    const body = { id: randomUUID(), method, args };
    // The same ID is essential: a lost acknowledgement must not send a turn twice.
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await this.http("/api/rpc", body);
        if (result.error) throw new Error(result.error);
        return checked(result.result);
      } catch (error) {
        if (!(error instanceof TypeError) || attempt >= 1) throw error;
      }
    }
  }
  async connect(): Promise<Snapshot> {
    const health = await this.http("/api/health", undefined, 5000);
    if (health.service !== "cibyp-backend" || health.protocol !== 1)
      throw new Error("Unsupported CIBYP backend protocol.");
    const snapshot = await this.request<Snapshot>("snapshot");
    if (this.instance.pid && snapshot.pid !== this.instance.pid)
      throw new Error("Local instance changed. Discover it again.");
    this.closed = false;
    this.sequence = snapshot.sequence || 0;
    this.openSocket(++this.generation);
    return snapshot;
  }
  private openSocket(generation: number) {
    if (this.closed || generation !== this.generation) return;
    const socket = new WebSocket(
      this.url.replace(/^http/, "ws") + `/api/events?after=${this.sequence}`,
      {
        headers: { Authorization: `Bearer ${this.token}` },
        followRedirects: false,
        handshakeTimeout: 10000,
        maxPayload: 16 * 1024 * 1024,
      },
    );
    this.socket = socket;
    socket.on("error", () => {});
    socket.on("message", async (data) => {
      if (generation !== this.generation || this.closed) return;
      try {
        const event = JSON.parse(String(data));
        if (event.type === "connected") {
          this.retry = 0;
          this.emit({ type: "connection", connected: true });
        } else if (event.type === "reset") {
          const snapshot = await this.request<Snapshot>("snapshot");
          if (generation !== this.generation || this.closed) return;
          this.sequence = snapshot.sequence || 0;
          this.emit({ type: "snapshot", payload: snapshot });
          socket.close();
        } else if (
          Number.isInteger(event.sequence) &&
          event.sequence > this.sequence
        ) {
          this.sequence = event.sequence;
          this.emit(event);
        }
      } catch {
        this.emit({
          type: "error",
          payload: { message: "Could not refresh instance events." },
        });
      }
    });
    socket.on("close", (code) => {
      if (this.closed || generation !== this.generation) return;
      this.emit({ type: "connection", connected: false });
      if (code === 1008) {
        this.closed = true;
        this.emit({ type: "authentication-required" });
        return;
      }
      this.timer = setTimeout(
        () => this.openSocket(generation),
        Math.min(10000, 400 * 2 ** this.retry++),
      );
      this.timer.unref();
    });
  }
  close() {
    this.closed = true;
    this.generation++;
    clearTimeout(this.timer);
    this.socket?.close();
  }
}
