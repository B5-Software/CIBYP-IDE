package org.b5software.cibyp;

import static org.b5software.cibyp.Text.t;

import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.DialogWrapper;
import com.intellij.openapi.ui.ValidationInfo;
import com.intellij.ui.components.*;
import com.intellij.util.ui.*;
import java.awt.*;
import java.util.ArrayList;
import java.util.List;
import javax.swing.*;

final class QuestionDialog extends DialogWrapper {
  private final List<JBCheckBox> choices = new ArrayList<>();
  private final JBTextField custom = new JBTextField();
  private final String question;

  QuestionDialog(Project project, String question, List<String> options) {
    super(project);
    this.question = question;
    options.forEach(option -> choices.add(new JBCheckBox(option)));
    setTitle(t("answer"));
    init();
  }

  @Override
  protected JComponent createCenterPanel() {
    JPanel options = new JPanel();
    options.setLayout(new BoxLayout(options, BoxLayout.Y_AXIS));
    choices.forEach(
        choice -> {
          choice.setBorder(JBUI.Borders.empty(4, 0));
          options.add(choice);
        });
    JBScrollPane scroll = new JBScrollPane(options);
    scroll.setBorder(JBUI.Borders.empty());
    scroll.setPreferredSize(
        new Dimension(JBUI.scale(420), JBUI.scale(Math.min(280, choices.size() * 32 + 8))));
    return FormBuilder.createFormBuilder()
        .addComponent(new JBLabel(question))
        .addComponent(scroll)
        .addLabeledComponent(t("custom.answer"), custom)
        .getPanel();
  }

  List<String> answers() {
    List<String> values = new ArrayList<>();
    choices.stream().filter(JBCheckBox::isSelected).forEach(choice -> values.add(choice.getText()));
    if (!custom.getText().isBlank()) values.add(custom.getText().trim());
    return values;
  }

  @Override
  protected ValidationInfo doValidate() {
    return answers().isEmpty() ? new ValidationInfo(t("answer.required"), custom) : null;
  }
}
