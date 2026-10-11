package org.b5software.cibyp;

import com.intellij.openapi.project.*;
import com.intellij.openapi.wm.*;
import com.intellij.ui.content.ContentFactory;
import org.jetbrains.annotations.NotNull;

public final class CibypToolWindow implements ToolWindowFactory, DumbAware {
  @Override
  public void createToolWindowContent(@NotNull Project project, @NotNull ToolWindow toolWindow) {
    CibypPanel panel = project.getService(CibypPanel.class);
    var content = ContentFactory.getInstance().createContent(panel.component(), "", false);
    content.setPreferredFocusableComponent(panel.input());
    toolWindow.getContentManager().addContent(content);
  }
}
