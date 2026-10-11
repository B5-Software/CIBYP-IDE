package org.b5software.cibyp;

import java.util.ResourceBundle;

final class Text {
  private static final ResourceBundle BUNDLE = ResourceBundle.getBundle("messages.CibypBundle");

  static String t(String key) {
    return BUNDLE.getString(key);
  }

  private Text() {}
}
