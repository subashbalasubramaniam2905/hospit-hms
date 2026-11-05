package com.hospitos.ai;

import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.errors.AnthropicException;
import com.anthropic.models.messages.Message;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.OutputConfig;
import com.anthropic.models.messages.StopReason;
import java.time.Duration;
import java.util.Optional;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * The Claude API, used when an API key is configured (ANTHROPIC_API_KEY). The key stays on the server; browsers never see it.
 * Any failure (no key, network, rate limit, refusal) returns empty so the assistant falls back to its rule-based answers.
 */
@Component
public class ClaudeAiModel implements AiModel {
  private static final Logger log = LoggerFactory.getLogger(ClaudeAiModel.class);
  private final AnthropicClient client;
  private final String model;

  public ClaudeAiModel(@Value("${hospitos.ai.api-key:}") String apiKey, @Value("${hospitos.ai.model:claude-opus-5-5}") String model) {
    this.model = model;
    this.client = apiKey == null || apiKey.isBlank() ? null
        : AnthropicOkHttpClient.builder().apiKey(apiKey.trim()).timeout(Duration.ofSeconds(60)).maxRetries(2).build();
    log.info(client == null ? "AI assistant: no ANTHROPIC_API_KEY set, using rule-based answers" : "AI assistant: using the Claude API ({})", model);
  }

  @Override public boolean enabled() { return client != null; }
  @Override public String name() { return model; }

  @Override
  public Optional<String> answer(String system, String user) {
    if (client == null) return Optional.empty();
    try {
      Message m = client.messages().create(MessageCreateParams.builder()
          .model(model)
          .maxTokens(4000L)
          .system(system)
          .outputConfig(OutputConfig.builder().effort(OutputConfig.Effort.LOW).build())
          .addUserMessage(user)
          .build());
      if (m.stopReason().map(r -> r.equals(StopReason.REFUSAL)).orElse(false)) return Optional.empty();
      String text = m.content().stream().flatMap(b -> b.text().stream()).map(t -> t.text()).collect(Collectors.joining("\n")).trim();
      return text.isEmpty() ? Optional.empty() : Optional.of(text);
    } catch (AnthropicException | IllegalStateException e) {
      log.warn("Claude API call failed, falling back to rule-based answer: {}", e.getMessage());
      return Optional.empty();
    }
  }
}
