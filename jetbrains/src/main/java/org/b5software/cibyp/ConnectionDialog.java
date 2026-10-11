package org.b5software.cibyp;

import static org.b5software.cibyp.Text.t;

import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.DialogWrapper;
import com.intellij.ui.components.*;
import com.intellij.util.ui.*;
import java.awt.*;
import java.util.List;
import javax.swing.*;

final class ConnectionDialog extends DialogWrapper {
  private final List<Protocol.Instance> local;
  private final JComboBox<String> choice = new JComboBox<>();
  private final JBTextField url = new JBTextField("https://", 26);
  private final JPasswordField password = new JPasswordField();
  private final JBTextField code = new JBTextField();

  ConnectionDialog(Project project, List<Protocol.Instance> local, String previous) {
    super(project);
    this.local = local;
    local.forEach(i -> choice.addItem(t("local") + " · " + i.url() + " · PID " + i.pid()));
    choice.addItem(t("remote"));
    if (previous != null && !previous.isEmpty()) url.setText(previous);
    choice.addActionListener(e -> update());
    setTitle(t("connect"));
    init();
    update();
  }

  private void update() {
    boolean remote = choice.getSelectedIndex() >= local.size();
    url.setEnabled(remote);
    password.setEnabled(remote);
    code.setEnabled(remote);
  }

  @Override
  protected JComponent createCenterPanel() {
    JPanel panel =
        FormBuilder.createFormBuilder()
            .addLabeledComponent(t("connect"), choice)
            .addLabeledComponent(t("url"), url)
            .addLabeledComponent(t("password"), password)
            .addLabeledComponent(t("code"), code)
            .getPanel();
    panel.setPreferredSize(new Dimension(JBUI.scale(440), JBUI.scale(180)));
    return panel;
  }

  Protocol.Instance instance() {
    return choice.getSelectedIndex() < local.size()
        ? local.get(choice.getSelectedIndex())
        : new Protocol.Instance(
            Protocol.address(url.getText().trim(), false).toString(), "", 0, false);
  }

  String password() {
    return new String(password.getPassword());
  }

  String code() {
    return code.getText().trim();
  }
}
