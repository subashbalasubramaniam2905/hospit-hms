package com.hospitos.radiology;

import com.hospitos.audit.AuditService;
import com.hospitos.common.CurrentUser;
import com.hospitos.radiology.RadiologyDtos.Booking;
import com.hospitos.radiology.RadiologyDtos.CancelInput;
import com.hospitos.radiology.RadiologyDtos.ImagingOrder;
import com.hospitos.radiology.RadiologyDtos.NewOrder;
import com.hospitos.radiology.RadiologyDtos.Report;
import com.hospitos.radiology.RadiologyDtos.ReportInput;
import com.hospitos.radiology.RadiologyDtos.Room;
import com.hospitos.radiology.RadiologyDtos.ScheduleInput;
import com.hospitos.radiology.RadiologyDtos.StartInput;
import com.hospitos.radiology.RadiologyDtos.Study;
import jakarta.validation.Valid;
import java.time.LocalDate;
import java.util.Arrays;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

/** Imaging study catalogue, rooms, orders, scheduling, scanning, reporting and verification. */
@RestController
@RequestMapping("/api/radiology")
@PreAuthorize("hasAnyRole('super-admin','admin','radiologist','doctor','nurse','receptionist','billing')")
public class RadiologyController {
  static final String ORDERERS = "hasAnyRole('super-admin','admin','radiologist','doctor','nurse','receptionist')";
  static final String SCHEDULERS = "hasAnyRole('super-admin','admin','radiologist','receptionist')";
  static final String RADIOLOGY = "hasAnyRole('super-admin','admin','radiologist')";
  static final String CANCELLERS = "hasAnyRole('super-admin','admin','radiologist','doctor','receptionist')";
  private final RadiologyRepository repo;
  private final RadiologyService rad;
  private final AuditService audit;
  public RadiologyController(RadiologyRepository repo, RadiologyService rad, AuditService audit) { this.repo = repo; this.rad = rad; this.audit = audit; }

  @GetMapping("/studies")
  public List<Study> studies() { return repo.studies(); }

  /** Rooms in the user's branches, or in one branch. */
  @GetMapping("/rooms")
  public List<Room> rooms(@RequestParam(required = false) String branchId) {
    var me = CurrentUser.get();
    if (branchId != null && !branchId.isBlank()) return me.canSee(branchId) ? repo.rooms(List.of(branchId)) : List.of();
    return repo.rooms(me.superAdmin() ? null : me.branches());
  }

  /** Booked slots in a branch on a day, for choosing a free slot. */
  @GetMapping("/schedule")
  public List<Booking> schedule(@RequestParam String branchId, @RequestParam LocalDate date) { return rad.bookings(branchId, date); }

  /** Orders in the user's branches. status takes a comma-separated list, for example Scheduled,In progress. */
  @GetMapping("/orders")
  public List<ImagingOrder> orders(@RequestParam(defaultValue = "") String status, @RequestParam(required = false) String modality,
                                   @RequestParam(required = false) String patientId, @RequestParam(defaultValue = "") String q,
                                   @RequestParam(required = false) LocalDate date, @RequestParam(required = false) LocalDate from,
                                   @RequestParam(required = false) LocalDate to, @RequestParam(defaultValue = "200") int limit) {
    var me = CurrentUser.get();
    var statuses = Arrays.stream(status.split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList();
    var out = repo.search(me.superAdmin() ? null : me.branches(), statuses, modality, patientId, q, date, from, to, Math.min(Math.max(limit, 1), 1000));
    if (patientId != null && !patientId.isBlank()) audit.logForBranch(me.homeBranch(), "Viewed", "Imaging studies", patientId, out.size() + " imaging orders");
    return out;
  }

  @GetMapping("/orders/{id}")
  public ImagingOrder order(@PathVariable String id) {
    var o = rad.visible(id);
    audit.logForBranch(o.branchId(), "Viewed", "Imaging order", id, o.patientName());
    return o;
  }

  @PostMapping("/orders")
  @ResponseStatus(HttpStatus.CREATED)
  @PreAuthorize(ORDERERS)
  public ImagingOrder create(@Valid @RequestBody NewOrder in) { return rad.create(in); }

  @PutMapping("/orders/{id}/schedule")
  @PreAuthorize(SCHEDULERS)
  public ImagingOrder schedule(@PathVariable String id, @Valid @RequestBody ScheduleInput in) { return rad.schedule(id, in); }

  @PostMapping("/orders/{id}/start")
  @PreAuthorize(RADIOLOGY)
  public ImagingOrder start(@PathVariable String id, @Valid @RequestBody(required = false) StartInput in) {
    return rad.start(id, in == null ? null : in.technician());
  }

  @PostMapping("/orders/{id}/acquire")
  @PreAuthorize(RADIOLOGY)
  public ImagingOrder acquire(@PathVariable String id) { return rad.acquire(id); }

  @PutMapping("/orders/{id}/report")
  @PreAuthorize(RADIOLOGY)
  public ImagingOrder saveReport(@PathVariable String id, @Valid @RequestBody ReportInput in) { return rad.saveReport(id, in); }

  @PostMapping("/orders/{id}/reopen")
  @PreAuthorize(RADIOLOGY)
  public ImagingOrder reopen(@PathVariable String id) { return rad.reopen(id); }

  @PostMapping("/orders/{id}/verify")
  @PreAuthorize(RADIOLOGY)
  public ImagingOrder verify(@PathVariable String id) { return rad.verify(id); }

  @PostMapping("/orders/{id}/cancel")
  @PreAuthorize(CANCELLERS)
  public ImagingOrder cancel(@PathVariable String id, @Valid @RequestBody CancelInput in) { return rad.cancel(id, in.reason()); }

  @GetMapping("/orders/{id}/report")
  public Report report(@PathVariable String id) { return rad.report(id); }
}
