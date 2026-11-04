package com.hospitos.users;

import com.hospitos.common.ApiException;

public final class PasswordPolicy {
  private PasswordPolicy() {}
  /** At least 10 characters with a letter and a digit. */
  public static void check(String pw) {
    if (pw == null || pw.length() < 10 || !pw.matches(".*[A-Za-z].*") || !pw.matches(".*\\d.*"))
      throw new ApiException(400, "Password needs at least 10 characters, including a letter and a number");
  }
}
