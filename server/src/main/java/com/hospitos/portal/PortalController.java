package com.hospitos.portal;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

/** Patient portal API. Sign-in is open; everything else needs a patient token (see SecurityConfig). */
@RestController
@RequestMapping("/api/portal")
public class PortalController {
  private final PortalSignIn signIn;
  private final PortalService portal;
  public PortalController(PortalSignIn signIn, PortalService portal) { this.signIn = signIn; this.portal = portal; }

  public record OtpRequest(@NotBlank String mobile) {}
  public record VerifyRequest(@NotBlank String mobile, @NotBlank String code) {}

  @PostMapping("/otp")
  public PortalSignIn.Sent otp(@Valid @RequestBody OtpRequest in) { return signIn.request(in.mobile()); }

  @PostMapping("/verify")
  public PortalSignIn.SignedIn verify(@Valid @RequestBody VerifyRequest in) { return signIn.verify(in.mobile(), in.code()); }

  @GetMapping("/me")
  public List<PortalService.Profile> me() { return portal.profiles(); }

  @GetMapping("/doctors")
  public List<PortalService.Doctor> doctors() { return portal.doctors(); }

  @GetMapping("/slots")
  public List<String> slots(@RequestParam(required = false) String patientId, @RequestParam String doctorId,
                            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
    return portal.slots(patientId, doctorId, date);
  }

  @GetMapping("/appointments")
  public List<PortalService.Appointment> appointments(@RequestParam(required = false) String patientId) { return portal.appointments(patientId); }

  public record Book(String patientId, @NotBlank String doctorId, @NotNull LocalDate date,
                     @NotBlank @Pattern(regexp = "^([01]\\d|2[0-3]):[0-5]\\d$") String time, boolean teleconsult) {}

  @PostMapping("/appointments")
  @ResponseStatus(HttpStatus.CREATED)
  public PortalService.Appointment book(@Valid @RequestBody Book in) {
    return portal.book(in.patientId(), in.doctorId(), in.date(), in.time(), in.teleconsult());
  }

  @PostMapping("/appointments/{id}/cancel")
  public Map<String, Boolean> cancel(@PathVariable String id, @RequestParam(required = false) String patientId) {
    portal.cancel(patientId, id);
    return Map.of("cancelled", true);
  }

  @GetMapping("/records")
  public PortalService.Records records(@RequestParam(required = false) String patientId) { return portal.records(patientId); }

  @GetMapping("/bills")
  public List<PortalService.Bill> bills(@RequestParam(required = false) String patientId) { return portal.bills(patientId); }

  public record Feedback(String patientId, int rating, String dept, String comment) {}

  @PostMapping("/feedback")
  @ResponseStatus(HttpStatus.CREATED)
  public void feedback(@RequestBody Feedback in) { portal.feedback(in.patientId(), in.rating(), in.dept(), in.comment()); }
}
