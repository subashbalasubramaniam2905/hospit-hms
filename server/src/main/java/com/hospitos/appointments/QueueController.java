package com.hospitos.appointments;

import com.hospitos.appointments.Dtos.CallNextRequest;
import com.hospitos.appointments.Dtos.MoveRequest;
import com.hospitos.appointments.Dtos.QueuePatch;
import com.hospitos.appointments.Dtos.QueueView;
import java.time.LocalDate;
import java.util.List;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

/** The live OPD queue and patient journey. */
@RestController
@RequestMapping("/api/queue")
public class QueueController {
    static final String READ = "hasAnyRole('super-admin','admin','doctor','nurse','receptionist','billing','pharmacist','lab-tech','radiologist')";
    static final String WRITE = READ;

    private final QueueService svc;

    public QueueController(QueueService svc) {
        this.svc = svc;
    }

    @GetMapping
    @PreAuthorize(READ)
    public List<QueueView> list(@RequestParam(required = false) String branch,
                                @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        return svc.list(branch, date);
    }

    @GetMapping("/{id}")
    @PreAuthorize(READ)
    public QueueView get(@PathVariable long id) {
        return svc.get(id);
    }

    /** Moves to the next step, or to {@code step} when given. */
    @PostMapping("/{id}/move")
    @PreAuthorize(WRITE)
    public QueueView move(@PathVariable long id, @RequestBody(required = false) MoveRequest r) {
        return svc.move(id, r == null ? null : r.step());
    }

    /** Priority, emergency flag and doctor. */
    @PatchMapping("/{id}")
    @PreAuthorize("hasAnyRole('super-admin','admin','doctor','nurse','receptionist')")
    public QueueView patch(@PathVariable long id, @RequestBody QueuePatch p) {
        return svc.patch(id, p);
    }

    @PostMapping("/{id}/left")
    @PreAuthorize("hasAnyRole('super-admin','admin','doctor','nurse','receptionist')")
    public ResponseEntity<Void> left(@PathVariable long id) {
        svc.left(id);
        return ResponseEntity.noContent().build();
    }

    /** Calls the next patient waiting at triage into consultation. 204 when nobody is waiting. */
    @PostMapping("/call-next")
    @PreAuthorize("hasAnyRole('super-admin','admin','doctor','nurse','receptionist')")
    public ResponseEntity<QueueView> callNext(@RequestParam(required = false) String branch, @RequestBody(required = false) CallNextRequest r) {
        return svc.callNext(branch, r == null ? null : r.deptId(), r == null ? null : r.doctorId())
                .map(ResponseEntity::ok).orElse(ResponseEntity.noContent().build());
    }
}
