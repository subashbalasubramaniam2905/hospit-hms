package com.hospitos.admin;

import java.util.List;

/** An integration that really talks to an outside system. The admin connection test calls it once the settings are complete. */
public interface LiveConnector {
  /** The integration id it serves, such as "wa". */
  String id();

  /** Checks the connection with the saved settings. Must not send anything to patients. */
  Outcome test(IntegrationSettings.Row settings);

  /** {@code summary} is stored as the last result; when ok it should start with "Connected". */
  record Outcome(boolean ok, List<String> log, String summary) {}
}
