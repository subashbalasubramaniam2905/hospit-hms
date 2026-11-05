package com.hospitos.ot;

import com.hospitos.audit.AuditService;
import com.hospitos.ot.OtDtos.AdvanceInput;
import com.hospitos.ot.OtDtos.CancelInput;
import com.hospitos.ot.OtDtos.CheckInput;
import com.hospitos.ot.OtDtos.NewSurgery;
import com.hospitos.ot.OtDtos.NotesInput;
import com.hospitos.ot.OtDtos.Surgery;
import jakarta.validation.Valid;
import java.time.LocalDate;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

/** Operation theatre rooms, surgery bookings, safety checklist, live status and post-op notes. */
@RestController
@RequestMapping("/api/ot")
@PreAuthorize("hasAnyRole('super-admin','admin','doctor','nurse','receptionist')")
public class OtController {
  /** Booking and cancelling: scheduling staff and surgeons. */
  static final String SCHEDULERS = "hasAnyRole('super-admin','admin','doctor','receptionist')";
  /** Checklist, status changes and notes: the theatre team. */
  static final String THEATRE = "hasAnyRole('super-admin','admin','doctor','nurse')";
  private final OtService ot;
  private final OtRepository repo;
  private final AuditService audit;
  public OtController(OtService ot, OtRepository repo, AuditService audit) { this.ot = ot; this.repo = repo; this.audit = audit; }

  @GetMapping("/rooms")
  public List<String> rooms(@RequestParam(required = false) String branchId) { return repo.rooms(ot.branch(branchId)); }

  /** Bookings for a day (default today) or a date range in one branch, or one patient's surgeries. */
  @GetMapping("/surgeries")
  public List<Surgery> list(@RequestParam(required = false) String branchId, @RequestParam(required = false) LocalDate date,
                            @RequestParam(required = false) LocalDate from, @RequestParam(required = false) LocalDate to,
                            @RequestParam(required = false) String patientId) {
    if (patientId != null && !patientId.isBlank()) return ot.list(null, from, to, patientId.trim());
    return date != null ? ot.list(branchId, date, date, null) : ot.list(branchId, from, to, null);
  }

  @GetMapping("/surgeries/{id}")
  public Surgery get(@PathVariable String id) {
    var s = ot.visible(id);
    audit.logForBranch(s.branchId(), "Viewed", "Surgery", id, s.patientName());
    return s;
  }

  @PostMapping("/surgeries")
  @ResponseStatus(HttpStatus.CREATED)
  @PreAuthorize(SCHEDULERS)
  public Surgery book(@Valid @RequestBody NewSurgery in) { return ot.book(in); }

  @PostMapping("/surgeries/{id}/checklist")
  @PreAuthorize(THEATRE)
  public Surgery check(@PathVariable String id, @Valid @RequestBody CheckInput in) { return ot.check(id, in.item(), in.done()); }

  @PostMapping("/surgeries/{id}/advance")
  @PreAuthorize(THEATRE)
  public Surgery advance(@PathVariable String id, @Valid @RequestBody AdvanceInput in) { return ot.advance(id, in.from()); }

  @PostMapping("/surgeries/{id}/cancel")
  @PreAuthorize(SCHEDULERS)
  public Surgery cancel(@PathVariable String id, @Valid @RequestBody(required = false) CancelInput in) {
    return ot.cancel(id, in == null ? null : in.reason());
  }

  @PutMapping("/surgeries/{id}/notes")
  @PreAuthorize(THEATRE)
  public Surgery notes(@PathVariable String id, @Valid @RequestBody NotesInput in) { return ot.notes(id, in.postOpNotes()); }
}
