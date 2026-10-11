export interface Instance {
  url: string;
  token: string;
  pid?: number;
  label?: string;
  local: boolean;
}
export interface Session {
  key: string;
  mode: string;
  profile?: string;
  title: string;
  status: string;
  busy: boolean;
  workspacePath?: string;
  hostWorkspacePath?: string;
  conversationId?: string;
  model?: string;
}
export interface Message {
  role: string;
  content: string;
  reasoning?: string;
  attachments?: { name?: string; path?: string; type?: string }[];
  tool_calls?: { id: string; function: { name: string; arguments: string } }[];
}
export interface View {
  session: Session;
  messages: Message[];
  stats?: Record<string, unknown>;
  pendingInteraction?: {
    kind: string;
    payload: Record<string, unknown>;
  } | null;
}
export interface Snapshot {
  sessions: Session[];
  views: Record<string, unknown>;
  sequence: number;
  pid: number;
  boot?: { ready: boolean; phase?: string; message?: string };
}
export interface BackendEvent {
  sequence?: number;
  channel?: string;
  payload?: any;
  type?: string;
  connected?: boolean;
}
export function visibleSession(s: Session): boolean {
  return !["subagent", "settings-assistant"].includes(s.profile || "");
}
export function address(value: string, local = false): string {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["", "/"].includes(url.pathname)
  )
    throw new Error(
      "Use an HTTP(S) instance origin without credentials, path or query.",
    );
  if (
    local &&
    (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port)
  )
    throw new Error("Local discovery must point to an IPv4 loopback port.");
  if (
    !local &&
    url.protocol !== "https:" &&
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  )
    throw new Error(
      "Remote connections require HTTPS. Use a local SSH tunnel for HTTP servers.",
    );
  return url.origin;
}
export function publicView(raw: any): View {
  return {
    session: raw.session,
    messages: (raw.displayMessages || raw.messages || []).map((m: any) => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : "",
      reasoning: m.reasoningSummary || m.reasoning || "",
      attachments: m.attachments || [],
      tool_calls: m.tool_calls,
    })),
    stats: raw.stats,
    pendingInteraction: raw.pendingInteraction,
  };
}
export function checked<T>(value: T): T {
  if (value && typeof value === "object" && (value as any).ok === false)
    throw new Error((value as any).error || "CIBYP rejected this action.");
  return value;
}
