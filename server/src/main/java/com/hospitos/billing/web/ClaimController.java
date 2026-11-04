package com.hospitos.billing.web;

import com.hospitos.billing.model.Claim;
import com.hospitos.billing.model.InsuranceProvider;
import com.hospitos.billing.service.ClaimService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

/** Insurance pre-authorisations and claims, worked by the billing / insurance desk. */
@RestController
@RequestMapping("/api/billing")
@PreAuthorize("hasAnyRole('super-admin','admin','billing')")
public class ClaimController {
  private final ClaimService claims;
  public ClaimController(ClaimService claims) { this.claims = claims; }

  @GetMapping("/insurance-providers")
  @PreAuthorize("hasAnyRole('super-admin','admin','billing','receptionist','doctor','nurse')")
  public List<InsuranceProvider> providers() { return claims.providers(); }

  @GetMapping("/claim-documents")
  public List<String> documents() { return ClaimService.DOCUMENTS; }

  @GetMapping("/claims")
  public List<Claim> list(@RequestParam(required = false) String status, @RequestParam(required = false) String patientId) {
    return claims.search(status == null || status.isBlank() ? null : status.toUpperCase(), patientId);
  }

  @GetMapping("/claims/{id}")
  public Claim get(@PathVariable UUID id) { return claims.get(id); }

  public record ClaimInput(UUID invoiceId, @Size(max = 20) String patientId, @NotBlank String providerId,
      @NotBlank @Size(max = 60) String policyNo, @Pattern(regexp = "PRE_AUTHORISATION|FINAL_CLAIM|REIMBURSEMENT") String type,
      @DecimalMin("0") BigDecimal claimed, @DecimalMin("0") @DecimalMax("100") BigDecimal copayPct,
      List<@Size(max = 60) String> documents) {}

  @PostMapping("/claims")
  @ResponseStatus(HttpStatus.CREATED)
  public Claim create(@Valid @RequestBody ClaimInput in) {
    return claims.create(new ClaimService.NewClaim(in.invoiceId(), in.patientId(), in.providerId(), in.policyNo(), in.type(),
        in.claimed(), in.copayPct(), in.documents()));
  }

  public record DocsInput(@NotNull List<@Size(max = 60) String> documents, @NotNull Integer version) {}

  @PutMapping("/claims/{id}/documents")
  public Claim documents(@PathVariable UUID id, @Valid @RequestBody DocsInput in) {
    return claims.setDocuments(id, in.documents(), in.version());
  }

  public record TransitionInput(@NotNull @Pattern(regexp = "SUBMITTED|UNDER_REVIEW|APPROVED|REJECTED|SETTLED") String status,
      @Size(max = 300) String note, @DecimalMin("0") BigDecimal approved, @Size(max = 300) String rejectionReason,
      @Size(max = 60) String settlementRef, @DecimalMin("0") BigDecimal settledAmount, @NotNull Integer version) {}

  @PostMapping("/claims/{id}/status")
  public Claim transition(@PathVariable UUID id, @Valid @RequestBody TransitionInput in) {
    return claims.transition(id, new ClaimService.Transition(in.status(), in.note(), in.approved(), in.rejectionReason(),
        in.settlementRef(), in.settledAmount(), in.version()));
  }
}
