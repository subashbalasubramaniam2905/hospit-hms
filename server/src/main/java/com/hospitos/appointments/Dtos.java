package com.hospitos.appointments;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import java.time.LocalDate;
import java.util.List;

/** Request and response shapes. Field names match the Angular models so the screens can use them directly. */
public final class Dtos {
    private Dtos() {}

    public record AppointmentView(String id, String patientId, String patientName, String doctorId, String deptId, LocalDate date, String time,
                                  int duration, String type, String status, String room, String token, String notes,
                                  String recurring, boolean reminderSent) {}

    public record HistoryItem(int step, String at) {}

    public record QueueView(long id, String token, String patientId, String patientName, String doctorId, String deptId, int step, long since,
                            String arrivedAt, boolean priority, boolean emergency, String appointmentId, List<HistoryItem> history) {}

    public record SlotView(String time, boolean ok, String reason) {}

    public record SlotDay(String doctorId, LocalDate date, int slotMinutes, String start, String end, String dayBlock,
                          List<SlotView> slots) {}

    public record CheckResult(boolean ok, String reason) {}

    public record BookRequest(
            @NotBlank String patientId,
            @NotBlank String doctorId,
            @NotNull LocalDate date,
            @NotBlank @Pattern(regexp = "^([01]\\d|2[0-3]):[0-5]\\d$", message = "Time must be HH:mm") String time,
            @Min(5) @Max(240) int duration,
            @Pattern(regexp = "New consultation|Follow-up|Procedure|Teleconsult|Review", message = "Unknown visit type") String type,
            String notes,
            @Pattern(regexp = "None|Weekly|Every 2 weeks|Monthly", message = "Unknown repeat") String recurring) {}

    public record BookResult(AppointmentView appointment, List<AppointmentView> repeats, List<String> skipped) {}

    public record StatusRequest(@NotBlank String status) {}

    public record RescheduleRequest(
            @NotNull LocalDate date,
            @NotBlank @Pattern(regexp = "^([01]\\d|2[0-3]):[0-5]\\d$", message = "Time must be HH:mm") String time) {}

    public record WalkInRequest(@NotBlank String patientId, @NotBlank String doctorId, boolean priority, boolean emergency) {}

    public record WalkInResult(AppointmentView appointment, QueueView queue) {}

    public record MoveRequest(Integer step) {}

    public record QueuePatch(Boolean priority, Boolean emergency, String doctorId) {}

    public record CallNextRequest(String deptId, String doctorId) {}

    public record LeaveView(String doctorId, LocalDate date, String reason) {}

    public record LeaveRequest(@NotBlank String doctorId, @NotNull LocalDate date, String reason) {}
}
