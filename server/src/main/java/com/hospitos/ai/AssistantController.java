package com.hospitos.ai;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/ai")
public class AssistantController {
  private static final String WHO = "hasAnyRole('super-admin','admin','doctor','billing')";
  private final AssistantService assistant;
  public AssistantController(AssistantService assistant) { this.assistant = assistant; }

  public record Ask(@NotBlank @Size(max = 1000) String question, @Size(max = 20) List<AssistantService.Turn> history, String branch) {}

  @GetMapping("/status")
  @PreAuthorize(WHO)
  public AssistantService.Status status() { return assistant.status(); }

  @PostMapping("/ask")
  @PreAuthorize(WHO)
  public AssistantService.Answer ask(@Valid @RequestBody Ask in) { return assistant.ask(in.question(), in.history(), in.branch()); }
}
