package org.b5software.cibyp;

import com.google.gson.JsonParser;
import com.intellij.openapi.util.Disposer;
import com.intellij.testFramework.fixtures.BasePlatformTestCase;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.nio.file.*;
import javax.imageio.ImageIO;
import javax.swing.*;

public class NativePanelTest extends BasePlatformTestCase {
  public void testNativeToolWindowRendersMarkdownAttachmentsAndComposer() throws Exception {
    CibypPanel panel = new CibypPanel(getProject());
    try {
      var details =
          JsonParser.parseString(
                  """
                  {"session":{"key":"ide-preview","title":"Workspace review","model":"CIBYP model","status":"idle","busy":false,"workspacePath":"/workspace/project"},"messages":[{"role":"user","content":"Review this selection and explain the issue.","attachments":[{"name":"workspace.java-selection.txt"}]},{"role":"assistant","content":"The function needs to handle an empty result before reading its properties.\\n\\n| Case | Result |\\n| --- | --- |\\n| Match found | Return the entry |\\n| Empty list | Return empty |\\n\\n```java\\nif (entry == null) return Optional.empty();\\nreturn Optional.of(entry.value());\\n```\\n\\nReview the suggestion in the editor before making a change."}],"pendingInteraction":null}
                  """)
              .getAsJsonObject();
      var stats =
          JsonParser.parseString("{\"context\":{\"used\":2400,\"max\":32000}}").getAsJsonObject();
      panel.render(details, stats);
      JComponent root = panel.component();
      root.setSize(480, 900);
      layout(root);
      assertTrue(findText(root, "workspace.java-selection.txt"));
      assertTrue(findText(root, "CIBYP model"));
      assertTrue(panel.input().getToolTipText().contains("Enter"));
      BufferedImage image = new BufferedImage(480, 900, BufferedImage.TYPE_INT_RGB);
      Graphics2D graphics = image.createGraphics();
      root.printAll(graphics);
      graphics.dispose();
      Path file = Path.of("../docs/screenshots/jetbrains-native.png");
      Files.createDirectories(file.getParent());
      ImageIO.write(image, "png", file.toFile());
    } finally {
      Disposer.dispose(panel);
    }
  }

  private static void layout(Container root) {
    root.doLayout();
    for (Component child : root.getComponents())
      if (child instanceof Container container) layout(container);
  }

  private static boolean findText(Container root, String needle) {
    for (Component child : root.getComponents()) {
      if (child instanceof JLabel label && label.getText().contains(needle)) return true;
      if (child instanceof Container container && findText(container, needle)) return true;
    }
    return false;
  }
}
