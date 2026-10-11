# Shared backend protocol 1

The extensions are clients of the same authenticated CIBYP BackendServer used by GUI, TUI, WebUI and the native mobile app. No second Agent loop, copied settings, model credentials or provider code lives here.

- `GET /api/health`: require `service=cibyp-backend`, `protocol=1`.
- `POST /api/login`: `{password,code}` → expiring session token; store token in the host IDE secret store.
- `POST /api/rpc`: `Authorization: Bearer …`, `X-CIBYP-Client: 1`, JSON `{id,method,args}`. Reuse **the same ID** after a lost acknowledgement; never submit a new ID for a transparent retry. Check both transport `error` and result `ok:false`.
- `WS /api/events?after=N`: authenticate with the **HTTP Authorization header**, never a token in the query string. `sequence` deduplicates replay. `reset` requests an authoritative snapshot; reconnect from that watermark. Authentication failures stop reconnecting and require sign-in.

Discovery matches `cibyp-backend-[a-f0-9]{24}.json` in the current OS user's temporary directory. Bound file size/count, reject symbolic links and foreign/public POSIX files, require a live PID, a 64-character hex token and HTTP IPv4 loopback origin, then compare the authenticated snapshot PID. The discovery credential stays in the extension host; it never reaches the webview, logs or settings.

Core methods:

| Action                      | RPC                                                                               |
| --------------------------- | --------------------------------------------------------------------------------- |
| Instance state              | `snapshot`, `boot:state`                                                          |
| Existing sessions           | `listSessions`, `getSessionDetails`, `getStats`                                   |
| New project chat            | `createSession({key,mode:'code'})`, `setWorkspace(key,path)`, `initialize({key})` |
| Shared history              | `listHistory(mode,workspacePath)`, `openHistory(key,id)`                          |
| Attachment                  | `uploadAttachment(key,{name,type,data:base64})`                                   |
| Nonblocking turn / steering | `submitMessage(key,text,attachments)`                                             |
| Stop                        | `stop(key)`                                                                       |
| Permission                  | `respond(key,true/false)` or `allow-once/deny`                                    |
| Questionnaire               | `answerQuestions(key,[{question,answer}])`                                        |
| Subscription usage          | `getSubscriptionUsage(key,true)`                                                  |

Observe `agent:session-event` for status, messages, streaming, tool progress, usage and pending interaction changes. UI projection excludes `llmOverride`, model API keys, system prompts and encrypted reasoning. Subagents and the ephemeral settings assistant are excluded from the normal conversation chooser.

Code context is always explicit: selection or bounded unsaved buffer → plain text snapshot attachment; VS Code additionally includes active-file diagnostics. File access and VM synchronization belong to the backend, not the plugin. Remote mode asks for a server workspace; it never silently uses a local pathname.
