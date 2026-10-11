package org.b5software.cibyp;

import static org.b5software.cibyp.Protocol.*;

import com.google.gson.*;
import java.net.*;
import java.net.http.*;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Consumer;

public final class BackendClient implements AutoCloseable {
  public final Instance instance;
  private final URI origin;
  private final HttpClient http =
      HttpClient.newBuilder()
          .connectTimeout(Duration.ofSeconds(10))
          .followRedirects(HttpClient.Redirect.NEVER)
          .build();
  private final ScheduledExecutorService scheduler =
      Executors.newSingleThreadScheduledExecutor(
          r -> {
            Thread t = new Thread(r, "CIBYP events");
            t.setDaemon(true);
            return t;
          });
  private volatile String token;
  private volatile boolean closed;
  private volatile WebSocket socket;
  private volatile long sequence;
  private int attempt;
  private final AtomicLong socketGeneration = new AtomicLong();
  private final AtomicBoolean retryScheduled = new AtomicBoolean();
  public Consumer<JsonObject> events = ignored -> {};

  public BackendClient(Instance instance) {
    this.instance = instance;
    this.origin = address(instance.url(), instance.local());
    token = instance.token();
  }

  public JsonObject http(String path, JsonObject body) throws Exception {
    HttpRequest.Builder request =
        HttpRequest.newBuilder(origin.resolve(path))
            .timeout(Duration.ofSeconds(120))
            .header("Authorization", "Bearer " + token)
            .header("X-CIBYP-Client", "1")
            .header("Content-Type", "application/json");
    request =
        body == null
            ? request.GET()
            : request.POST(HttpRequest.BodyPublishers.ofString(body.toString()));
    HttpResponse<String> response =
        http.send(request.build(), HttpResponse.BodyHandlers.ofString());
    JsonObject value;
    try {
      value = JsonParser.parseString(response.body()).getAsJsonObject();
    } catch (Exception e) {
      throw new IllegalStateException(
          "Instance returned an invalid response (" + response.statusCode() + ").");
    }
    if (response.statusCode() == 401)
      throw new SecurityException("Authentication expired; connect again to sign in.");
    if (response.statusCode() != 200)
      throw new IllegalStateException(
          string(value, "error").isEmpty()
              ? "HTTP " + response.statusCode()
              : string(value, "error"));
    return value;
  }

  public String login(String password, String code) throws Exception {
    JsonObject body = new JsonObject();
    body.addProperty("password", password);
    body.addProperty("code", code);
    JsonObject result = http("/api/login", body);
    token = string(result, "token");
    if (token.isEmpty()) throw new SecurityException("Login returned no session token.");
    return token;
  }

  public JsonElement request(String method, Object... args) throws Exception {
    JsonObject body = new JsonObject();
    body.addProperty("id", UUID.randomUUID().toString());
    body.addProperty("method", method);
    body.add("args", JSON.toJsonTree(args));
    JsonObject response;
    // Reuse the request ID after an uncertain network acknowledgement.
    try {
      response = http("/api/rpc", body);
    } catch (java.io.IOException first) {
      response = http("/api/rpc", body);
    }
    if (response.has("error")) throw new IllegalStateException(string(response, "error"));
    return checked(response.get("result"));
  }

  public JsonObject connect() throws Exception {
    JsonObject health = http("/api/health", null);
    if (!string(health, "service").equals("cibyp-backend")
        || health.get("protocol").getAsInt() != 1)
      throw new IllegalStateException("Unsupported CIBYP backend protocol.");
    JsonObject snapshot = request("snapshot").getAsJsonObject();
    if (instance.pid() > 0 && snapshot.get("pid").getAsLong() != instance.pid())
      throw new IllegalStateException("Local instance changed. Discover it again.");
    sequence = snapshot.has("sequence") ? snapshot.get("sequence").getAsLong() : 0;
    openSocket();
    return snapshot;
  }

  private void emit(String type, boolean connected) {
    JsonObject event = new JsonObject();
    event.addProperty("type", type);
    event.addProperty("connected", connected);
    events.accept(event);
  }

  private void retry(long expected) {
    if (closed || expected != socketGeneration.get() || !retryScheduled.compareAndSet(false, true))
      return;
    emit("connection", false);
    try {
      scheduler.schedule(
          () -> {
            retryScheduled.set(false);
            if (!closed && expected == socketGeneration.get()) openSocket();
          },
          Math.min(10000, 400L << Math.min(attempt++, 5)),
          TimeUnit.MILLISECONDS);
    } catch (RejectedExecutionException ignored) {
      /* The project closed during reconnect. */
    }
  }

  private void openSocket() {
    if (closed) return;
    long expected = socketGeneration.incrementAndGet();
    URI url =
        URI.create(origin.toString().replaceFirst("^http", "ws") + "/api/events?after=" + sequence);
    http.newWebSocketBuilder()
        .connectTimeout(Duration.ofSeconds(10))
        .header("Authorization", "Bearer " + token)
        .buildAsync(
            url,
            new WebSocket.Listener() {
              final StringBuilder parts = new StringBuilder();

              @Override
              public void onOpen(WebSocket ws) {
                if (closed || expected != socketGeneration.get()) {
                  ws.abort();
                  return;
                }
                socket = ws;
                ws.request(1);
              }

              @Override
              public CompletionStage<?> onText(WebSocket ws, CharSequence data, boolean last) {
                if (closed || expected != socketGeneration.get()) return null;
                parts.append(data);
                if (parts.length() > 16 * 1024 * 1024) {
                  ws.abort();
                  retry(expected);
                  return null;
                }
                if (last) {
                  try {
                    JsonObject value = JsonParser.parseString(parts.toString()).getAsJsonObject();
                    String type = string(value, "type");
                    if (type.equals("connected")) {
                      attempt = 0;
                      emit("connection", true);
                    } else if (type.equals("reset")) {
                      long reset = socketGeneration.incrementAndGet();
                      ws.abort();
                      scheduler.execute(
                          () -> {
                            try {
                              JsonObject snapshot = request("snapshot").getAsJsonObject();
                              if (closed || reset != socketGeneration.get()) return;
                              sequence = snapshot.get("sequence").getAsLong();
                              JsonObject event = new JsonObject();
                              event.addProperty("type", "snapshot");
                              event.add("payload", snapshot);
                              events.accept(event);
                              openSocket();
                            } catch (Exception e) {
                              retry(reset);
                            }
                          });
                    } else if (value.has("sequence")
                        && value.get("sequence").getAsLong() > sequence) {
                      sequence = value.get("sequence").getAsLong();
                      events.accept(value);
                    }
                  } catch (Exception ignored) {
                    /* Malformed frames cannot mutate the view. */
                  }
                  parts.setLength(0);
                }
                ws.request(1);
                return null;
              }

              @Override
              public CompletionStage<?> onClose(WebSocket ws, int code, String reason) {
                if (closed || expected != socketGeneration.get()) return null;
                if (code == 1008) {
                  closed = true;
                  emit("authentication-required", false);
                } else retry(expected);
                return null;
              }

              @Override
              public void onError(WebSocket ws, Throwable error) {
                retry(expected);
              }
            })
        .exceptionally(
            error -> {
              if (closed || expected != socketGeneration.get()) return null;
              Throwable cause = error instanceof CompletionException ? error.getCause() : error;
              if (cause instanceof WebSocketHandshakeException handshake
                  && handshake.getResponse().statusCode() == 401) {
                closed = true;
                emit("authentication-required", false);
              } else retry(expected);
              return null;
            });
  }

  @Override
  public void close() {
    closed = true;
    socketGeneration.incrementAndGet();
    if (socket != null) socket.abort();
    scheduler.shutdownNow();
  }
}
