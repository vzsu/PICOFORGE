// app/src/ws/client.ts — WebSocket client
// SYS_DESIGN §3.3: reconnect with ?resume=<seq>, typed events
// Ponytail: AbortController for teardown, Map for pending, no framework

// Frames are validated with the generated server schema (app/src/protocol, PROTO-GEN-01):
// the client trusts exactly what the server is allowed to send (CLAUDE.md #2, both directions).
import { type ServerEvent, ServerEventSchema } from "../protocol/events.ts";

export type WsEvent = ServerEvent;
export type ServerEventType = ServerEvent["type"];

export type WsEventHandler = (event: WsEvent) => void;
export type WsStatusHandler = (connected: boolean) => void;

const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000];
const PING_INTERVAL_MS = 25_000;

export class WsClient {
  private _ws: WebSocket | null = null;
  private _lastSeq = 0;
  private _reconnectAttempt = 0;
  private _pingTimer: ReturnType<typeof setInterval> | null = null;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _destroyed = false;

  private readonly _handlers: WsEventHandler[] = [];
  private readonly _statusHandlers: WsStatusHandler[] = [];

  constructor(
    private readonly conversationId: string,
    private readonly baseUrl = `ws://${location.host}`,
  ) {}

  /** Start connection */
  connect(): void {
    if (this._destroyed) return;
    this._openSocket();
  }

  /** Send a typed client event */
  send(event: Record<string, unknown>): void {
    if (this._ws?.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(event));
    }
  }

  on(handler: WsEventHandler): () => void {
    this._handlers.push(handler);
    return () => {
      const i = this._handlers.indexOf(handler);
      if (i !== -1) this._handlers.splice(i, 1);
    };
  }

  onStatus(handler: WsStatusHandler): () => void {
    this._statusHandlers.push(handler);
    return () => {
      const i = this._statusHandlers.indexOf(handler);
      if (i !== -1) this._statusHandlers.splice(i, 1);
    };
  }

  destroy(): void {
    this._destroyed = true;
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    if (this._pingTimer) clearInterval(this._pingTimer);
    this._ws?.close();
    this._ws = null;
  }

  private _openSocket(): void {
    // Include security token from page URL query string (SYS_DESIGN §10)
    const pageToken = new URLSearchParams(location.search).get("t") ?? "";
    const url = `${this.baseUrl}/ws?conversationId=${this.conversationId}&resume=${this._lastSeq}&t=${pageToken}`;
    const ws = new WebSocket(url);
    this._ws = ws;

    ws.onopen = () => {
      this._reconnectAttempt = 0;
      this._emit(true);
      this._startPing();
    };

    ws.onmessage = (ev: MessageEvent) => {
      try {
        if (typeof ev.data !== "string") return; // PTS1 binary frames get their own decoder (P3)
        const parsed = ServerEventSchema.safeParse(JSON.parse(ev.data));
        if (!parsed.success) {
          console.warn("[ws] dropped a frame that fails ServerEventSchema", parsed.error.issues[0]);
          return;
        }
        const event = parsed.data;
        this._lastSeq = event.seq;
        for (const h of this._handlers) h(event);
      } catch {
        /* skip malformed */
      }
    };

    ws.onclose = () => {
      this._stopPing();
      this._emit(false);
      if (!this._destroyed) this._scheduleReconnect();
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  private _startPing(): void {
    this._stopPing();
    this._pingTimer = setInterval(() => {
      this.send({ type: "ping" });
    }, PING_INTERVAL_MS);
  }

  private _stopPing(): void {
    if (this._pingTimer) {
      clearInterval(this._pingTimer);
      this._pingTimer = null;
    }
  }

  private _scheduleReconnect(): void {
    const delay = RECONNECT_DELAYS_MS[Math.min(this._reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
    this._reconnectAttempt++;
    this._reconnectTimer = setTimeout(() => {
      if (!this._destroyed) this._openSocket();
    }, delay);
  }

  private _emit(connected: boolean): void {
    for (const h of this._statusHandlers) h(connected);
  }
}
