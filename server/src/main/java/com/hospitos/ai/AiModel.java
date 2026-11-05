package com.hospitos.ai;

import java.util.Optional;

/** A language model the assistant can ask. Empty means it is not configured or did not answer, and the rule-based answers are used. */
public interface AiModel {
  boolean enabled();
  String name();
  Optional<String> answer(String system, String user);
}
