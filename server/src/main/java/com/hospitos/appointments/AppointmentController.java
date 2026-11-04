package com.hospitos.appointments;

import com.hospitos.appointments.Dtos.AppointmentView;
import com.hospitos.appointments.Dtos.BookRequest;
import com.hospitos.appointments.Dtos.BookResult;
import com.hospitos.appointments.Dtos.CheckResult;
import com.hospitos.appointments.Dtos.RescheduleRequest;
import com.hospitos.appointments.Dtos.SlotDay;
import com.hospitos.appointments.Dtos.StatusRequest;
import com.hospitos.appointments.Dtos.WalkInRequest;
import com.hospitos.appointments.Dtos.WalkInResult;
import jakarta.validation.Valid;
import java.time.LocalDate;
import java.util.List;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

/** Booking, calendar and doctor slots. */
@RestController
@RequestMapping("/api/appointments")
public class AppointmentController {
    static final String READ = "hasAnyRole('super-admin','admin','doctor','nurse','receptionist','billing')";
    static final String WRITE = "hasAnyRole('super-admin','admin','doctor','nurse','receptionist')";

    private final AppointmentService svc;

    public AppointmentController(AppointmentService svc) {
        this.svc = svc;
    }

    @GetMapping
    @PreAuthorize(READ)
    public List<AppointmentView> list(@RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                      @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
                                      @RequestParam(required = false) String branch, @RequestParam(required = false) String doctorId,
                                      @RequestParam(required = false) String patientId, @RequestParam(required = false) String status) {
        return svc.list(branch, from, to, doctorId, patientId, status);
    }

    @GetMapping("/{id}")
    @PreAuthorize(READ)
    public AppointmentView get(@PathVariable String id) {
        return svc.get(id);
    }

    /** The doctor's slot grid for a day, each slot marked free or not with the reason. */
    @GetMapping("/slots")
    @PreAuthorize(READ)
    public SlotDay slots(@RequestParam String doctorId, @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
                         @RequestParam(required = false) Integer duration) {
        return svc.slots(doctorId, date, duration);
    }

    /** Checks one time without booking it. */
    @GetMapping("/check")
    @PreAuthorize(READ)
    public CheckResult check(@RequestParam String doctorId, @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
                             @RequestParam String time, @RequestParam int duration, @RequestParam(required = false) String ignoreId) {
        return svc.check(doctorId, date, time, duration, ignoreId);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize(WRITE)
    public BookResult book(@Valid @RequestBody BookRequest r) {
        return svc.book(r);
    }

    @PostMapping("/walk-in")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize(WRITE)
    public WalkInResult walkIn(@Valid @RequestBody WalkInRequest r) {
        return svc.walkIn(r);
    }

    @PostMapping("/{id}/status")
    @PreAuthorize(WRITE)
    public AppointmentView status(@PathVariable String id, @Valid @RequestBody StatusRequest r) {
        return svc.setStatus(id, r.status());
    }

    @PostMapping("/{id}/reschedule")
    @PreAuthorize(WRITE)
    public AppointmentView reschedule(@PathVariable String id, @Valid @RequestBody RescheduleRequest r) {
        return svc.reschedule(id, r.date(), r.time());
    }

    /** Records that a reminder went out. Sending WhatsApp or SMS is not wired up yet. */
    @PostMapping("/{id}/reminder")
    @PreAuthorize(WRITE)
    public AppointmentView reminder(@PathVariable String id) {
        return svc.markReminderSent(id);
    }

    @GetMapping("/leave")
    @PreAuthorize(READ)
    public List<Dtos.LeaveView> leaves(@RequestParam String doctorId,
                                       @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                       @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return svc.leaves(doctorId, from, to);
    }

    /** Adds a day off and returns the bookings on it that now need moving. */
    @PostMapping("/leave")
    @PreAuthorize("hasAnyRole('super-admin','admin','receptionist')")
    public List<AppointmentView> addLeave(@Valid @RequestBody Dtos.LeaveRequest r) {
        return svc.addLeave(r);
    }

    @DeleteMapping("/leave/{doctorId}/{date}")
    @PreAuthorize("hasAnyRole('super-admin','admin','receptionist')")
    public ResponseEntity<Void> removeLeave(@PathVariable String doctorId,
                                            @PathVariable @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        svc.removeLeave(doctorId, date);
        return ResponseEntity.noContent().build();
    }
}
