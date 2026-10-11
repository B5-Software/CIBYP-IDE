package org.b5software.cibyp;

import static org.junit.jupiter.api.Assertions.*;

import com.google.gson.*;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ProtocolTest {
  @TempDir Path temporary;

  @Test
  void rejectsRemoteCredentialLeaksAndDowngrades() {
    for (String url :
        List.of(
            "http://example.com",
            "https://user:password@example.com",
            "https://example.com/prefix",
            "https://example.com?token=secret",
            "file:///tmp/foo"))
      assertThrows(IllegalArgumentException.class, () -> Protocol.address(url, false));
    assertEquals("https://example.com", Protocol.address("https://example.com/", false).toString());
  }

  @Test
  void discoversOnlyLiveLoopbackInstances() throws Exception {
    JsonObject row = new JsonObject();
    row.addProperty("url", "http://127.0.0.1:3456");
    row.addProperty("pid", ProcessHandle.current().pid());
    row.addProperty("token", "a".repeat(64));
    row.addProperty("protocol", 1);
    Path good = temporary.resolve("cibyp-backend-" + "a".repeat(24) + ".json");
    Files.writeString(good, row.toString());
    if (Files.getFileStore(good).supportsFileAttributeView("posix"))
      Files.setPosixFilePermissions(
          good, java.nio.file.attribute.PosixFilePermissions.fromString("rw-------"));
    row.addProperty("url", "https://evil.example");
    Files.writeString(
        temporary.resolve("cibyp-backend-" + "b".repeat(24) + ".json"), row.toString());
    assertEquals(1, Protocol.discover(temporary).size());
  }

  @Test
  void rpcAuthenticatesChecksErrorsAndUsesUniqueRequestIds() throws Exception {
    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    List<String> ids = new ArrayList<>();
    server.createContext(
        "/api/rpc",
        exchange -> {
          assertEquals("Bearer fixture", exchange.getRequestHeaders().getFirst("Authorization"));
          assertEquals("1", exchange.getRequestHeaders().getFirst("X-CIBYP-Client"));
          JsonObject body =
              JsonParser.parseString(
                      new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8))
                  .getAsJsonObject();
          ids.add(body.get("id").getAsString());
          byte[] response =
              (body.get("method").getAsString().equals("stop")
                      ? "{\"result\":{\"ok\":true}}"
                      : "{\"result\":{\"ok\":false,\"error\":\"Workspace failed\"}}")
                  .getBytes(StandardCharsets.UTF_8);
          exchange.sendResponseHeaders(200, response.length);
          exchange.getResponseBody().write(response);
          exchange.close();
        });
    server.start();
    try (BackendClient client =
        new BackendClient(
            new Protocol.Instance(
                "http://127.0.0.1:" + server.getAddress().getPort(), "fixture", 0, true))) {
      assertTrue(client.request("stop", "key").getAsJsonObject().get("ok").getAsBoolean());
      assertThrows(
          IllegalStateException.class, () -> client.request("setWorkspace", "key", "path"));
      assertEquals(2, new HashSet<>(ids).size());
    } finally {
      server.stop(0);
    }
  }
}
