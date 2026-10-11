package org.b5software.cibyp;

import com.intellij.openapi.actionSystem.*;
import com.intellij.openapi.project.DumbAwareAction;
import com.intellij.openapi.wm.ToolWindowManager;
import org.jetbrains.annotations.NotNull;

public final class ExplainAction extends DumbAwareAction {
  @Override
  public void actionPerformed(@NotNull AnActionEvent event) {
    var project = event.getProject();
    if (project == null) return;
    var window = ToolWindowManager.getInstance(project).getToolWindow("CIBYP");
    if (window != null)
      window.activate(
          () -> {
            var panel = project.getService(CibypPanel.class);
            panel.attachSelection();
            panel.input().setText(Text.t("explain"));
          });
  }
}
