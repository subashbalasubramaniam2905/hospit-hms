package com.hospitos.kiosk;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

/** Kiosk API. Device management is for administrators; the rest needs a paired kiosk's token (see SecurityConfig). */
@RestController
@RequestMapping("/api/kiosk")
public class KioskController {
  private static final String ADMINS = "hasAnyRole('super-admin','admin')";
  private final KioskService kiosk;
  public KioskController(KioskService kiosk) { this.kiosk = kiosk; }

  public record NewDevice(@NotBlank String branchId, @NotBlank String name) {}
  public record Pair(@NotBlank String code) {}
  public record Find(String mobile, String uhid) {}
  public record CheckIn(@NotBlank String patientId, @NotBlank String appointmentId) {}
  public record WalkIn(@NotBlank String patientId, @NotBlank String deptId) {}

  @GetMapping("/devices")
  @PreAuthorize(ADMINS)
  public List<KioskService.Device> devices() { return kiosk.devices(); }

  @PostMapping("/devices")
  @PreAuthorize(ADMINS)
  @ResponseStatus(HttpStatus.CREATED)
  public KioskService.PairCode create(@Valid @RequestBody NewDevice in) { return kiosk.create(in.branchId(), in.name()); }

  @PostMapping("/devices/{id}/pair-code")
  @PreAuthorize(ADMINS)
  public KioskService.PairCode code(@PathVariable UUID id) { return kiosk.newCode(id); }

  @PostMapping("/devices/{id}/revoke")
  @PreAuthorize(ADMINS)
  public void revoke(@PathVariable UUID id) { kiosk.revoke(id); }

  @PostMapping("/pair")
  public KioskService.Paired pair(@Valid @RequestBody Pair in) { return kiosk.pair(in.code()); }

  @GetMapping("/info")
  public KioskService.Info info() { return kiosk.info(); }

  @PostMapping("/find")
  public List<KioskService.Match> find(@RequestBody Find in) { return kiosk.find(in.mobile(), in.uhid()); }

  @PostMapping("/check-in")
  public KioskService.Ticket checkIn(@Valid @RequestBody CheckIn in) { return kiosk.checkIn(in.patientId(), in.appointmentId()); }

  @PostMapping("/walk-in")
  public KioskService.Ticket walkIn(@Valid @RequestBody WalkIn in) { return kiosk.walkIn(in.patientId(), in.deptId()); }

  @PostMapping("/register")
  @ResponseStatus(HttpStatus.CREATED)
  public KioskService.Match register(@RequestBody KioskService.Register in) { return kiosk.register(in); }
}
