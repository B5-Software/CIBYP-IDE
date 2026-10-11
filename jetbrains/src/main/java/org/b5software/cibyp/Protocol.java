package org.b5software.cibyp;

import com.google.gson.*;
import java.net.URI;
import java.nio.file.*;
import java.util.*;
import java.util.stream.Stream;

public final class Protocol {
  public record Instance(String url, String token, long pid, boolean local) {}

  public static final Gson JSON = new Gson();

  public static String string(JsonObject object, String key) {
    JsonElement value = object.get(key);
    return value == null || value.isJsonNull() ? "" : value.getAsString();
  }

  public static JsonArray array(JsonObject object, String key) {
    return object.has(key) && object.get(key).isJsonArray()
        ? object.getAsJsonArray(key)
        : new JsonArray();
  }

  public static boolean visible(JsonObject session) {
    return !Set.of("subagent", "settings-assistant").contains(string(session, "profile"));
  }

  public static URI address(String value, boolean local) {
    URI uri = URI.create(value);
    if (!Set.of("http", "https").contains(uri.getScheme())
        || uri.getHost() == null
        || uri.getUserInfo() != null
        || uri.getQuery() != null
        || uri.getFragment() != null
        || !(uri.getPath().isEmpty() || uri.getPath().equals("/")))
      throw new IllegalArgumentException(
          "Use an HTTP(S) origin without credentials, path or query.");
    if (local
        && !(uri.getScheme().equals("http")
            && uri.getHost().equals("127.0.0.1")
            && uri.getPort() > 0))
      throw new IllegalArgumentException("Local discovery must use an IPv4 loopback port.");
    if (!local
        && !uri.getScheme().equals("https")
        && !Set.of("127.0.0.1", "localhost", "[::1]").contains(uri.getHost()))
      throw new IllegalArgumentException("Use HTTPS for remote instances, or a local SSH tunnel.");
    return URI.create(uri.getScheme() + "://" + uri.getRawAuthority());
  }

  public static List<Instance> discover(Path directory) {
    List<Instance> result = new ArrayList<>();
    try (Stream<Path> paths = Files.list(directory)) {
      for (Path file :
          paths
              .filter(p -> p.getFileName().toString().matches("cibyp-backend-[a-f0-9]{24}\\.json"))
              .limit(128)
              .toList()) {
        try {
          if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS) || Files.size(file) > 8192)
            continue;
          if (Files.getFileStore(file).supportsFileAttributeView("posix")) {
            var permissions = Files.getPosixFilePermissions(file);
            if (permissions.stream()
                .anyMatch(p -> p.name().startsWith("GROUP_") || p.name().startsWith("OTHERS_")))
              continue;
            // /tmp itself is usually owned by root, not the IDE user.
            var currentUser =
                file.getFileSystem()
                    .getUserPrincipalLookupService()
                    .lookupPrincipalByName(System.getProperty("user.name"));
            if (!Files.getOwner(file).equals(currentUser)) continue;
          }
          JsonObject row = JsonParser.parseString(Files.readString(file)).getAsJsonObject();
          long pid = row.get("pid").getAsLong();
          String token = string(row, "token");
          if (row.get("protocol").getAsInt() != 1
              || !token.matches("[a-f0-9]{64}")
              || pid <= 0
              || !ProcessHandle.of(pid).map(ProcessHandle::isAlive).orElse(false)) continue;
          result.add(new Instance(address(string(row, "url"), true).toString(), token, pid, true));
        } catch (Exception ignored) {
          /* Stale or foreign instance. */
        }
      }
    } catch (Exception ignored) {
      /* No local instances. */
    }
    return result;
  }

  public static JsonElement checked(JsonElement value) {
    if (value != null && value.isJsonObject()) {
      JsonObject object = value.getAsJsonObject();
      if (object.has("ok") && !object.get("ok").getAsBoolean())
        throw new IllegalStateException(string(object, "error"));
    }
    return value;
  }

  private Protocol() {}
}
