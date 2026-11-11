package com.hospitos.notifications;

import com.hospitos.audit.AuditService;
import com.hospitos.common.ApiException;
import com.hospitos.common.BranchScope;
import com.hospitos.common.CurrentUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/notifications")
public class NotificationController {
  static final String SENDERS = "hasAnyRole('super-admin','admin','receptionist')";
  private static final Set<String> CHANNELS = Set.of("SMS", "Email", "WhatsApp");
  private static final Set<String> TYPES = Set.of("Appointment reminder", "Appointment confirmation", "Follow-up reminder", "Lab report ready",
      "Payment reminder", "Prescription", "Discharge", "System");
  private final JdbcClient db;
  private final NotificationService notes;
  private final AuditService audit;
  public NotificationController(JdbcClient db, NotificationService notes, AuditService audit) { this.db = db; this.notes = notes; this.audit = audit; }

  public record Message(long id, OffsetDateTime at, String branchId, String channel, String type, String patientId, String toText,
                        String message, String status, String error, String sentBy) {}
  public record SendInput(@NotBlank String channel, @NotBlank String type, @NotEmpty @Size(max = 500) List<@NotBlank String> patientIds,
                          @NotBlank @Size(max = 1000) String message, String branchId) {}
  public record SendResult(int queued, List<String> skipped, List<Message> messages, boolean sending) {}
  public record InboxNote(long id, OffsetDateTime at, String title, String body, String link, String icon, String tone, boolean read) {}

  // ------------------------------------------------------------------ patient messages

  @GetMapping("/messages")
  @PreAuthorize(SENDERS)
  public List<Message> messages(@RequestParam(defaultValue = "300") int limit) {
    var me = CurrentUser.get();
    return db.sql("""
        select id, at, branch_id, channel, type, patient_id, to_text, message, status, error, sent_by from notification_msg
        where :all or branch_id = any(:branches) order by id desc limit :limit""")
        .param("all", me.superAdmin()).param("branches", me.branches().toArray(String[]::new)).param("limit", Math.min(Math.max(limit, 1), 1000))
        .query(Message.class).list();
  }

  /** Records messages for patients; WhatsApp ones are sent once WhatsApp is set up. Patients without a mobile or email are skipped. */
  @PostMapping("/messages")
  @PreAuthorize(SENDERS)
  @ResponseStatus(HttpStatus.CREATED)
  @Transactional
  public SendResult send(@Valid @RequestBody SendInput in) {
    if (!CHANNELS.contains(in.channel())) throw new ApiException(400, "Channel must be SMS, Email or WhatsApp");
    if (!TYPES.contains(in.type())) throw new ApiException(400, "Unknown message type");
    String branch = BranchScope.pick(in.branchId());
    var me = CurrentUser.get();
    var ids = new java.util.ArrayList<Long>(); var skipped = new java.util.ArrayList<String>();
    for (String pid : new java.util.LinkedHashSet<>(in.patientIds())) {
      var p = db.sql("select name, mobile, email, branch_id from patient where id = ?").param(pid)
          .query((r, i) -> new String[] { r.getString(1), r.getString(2), r.getString(3), r.getString(4) }).optional();
      if (p.isEmpty() || !me.canSee(p.get()[3])) { skipped.add(pid + " (not found)"); continue; }
      String to = "Email".equals(in.channel()) ? p.get()[2] : p.get()[1];
      if (to == null || to.isBlank()) { skipped.add(pid + " (no " + ("Email".equals(in.channel()) ? "email" : "mobile") + ")"); continue; }
      ids.add(notes.queue(p.get()[3], in.channel(), in.type(), pid, p.get()[0] + " · " + to, to.trim(), in.message().trim()));
    }
    audit.logForBranch(branch, "Sent", "Notification", null, in.type() + " to " + ids.size() + " patient(s) by " + in.channel()
        + (notes.canSend(in.channel()) ? " (sending)" : " (queued, no provider)"));
    var list = ids.isEmpty() ? List.<Message>of() : db.sql("""
        select id, at, branch_id, channel, type, patient_id, to_text, message, status, error, sent_by from notification_msg
        where id = any(?) order by id desc""").param(ids.toArray(Long[]::new)).query(Message.class).list();
    return new SendResult(ids.size(), skipped, list, notes.canSend(in.channel()));
  }

  // ------------------------------------------------------------------ staff inbox

  private static final String MINE = """
      (n.user_id = :uid or (n.user_id is null and (n.role is null or n.role = :role)
        and (n.branch_id is null or :all or n.branch_id = any(:branches))))""";

  /** The signed-in user's inbox: notes to them, to their role, or to everyone, in their branches. */
  @GetMapping("/inbox")
  public List<InboxNote> inbox(@RequestParam(defaultValue = "100") int limit) {
    var me = CurrentUser.get();
    return db.sql("""
        select n.id, n.at, n.title, n.body, n.link, n.icon, n.tone, (r.note_id is not null) as read
        from inbox_note n left join inbox_read r on r.note_id = n.id and r.user_id = :uid
        where %s order by n.id desc limit :limit""".formatted(MINE))
        .param("uid", me.id()).param("role", me.role()).param("all", me.superAdmin()).param("branches", me.branches().toArray(String[]::new))
        .param("limit", Math.min(Math.max(limit, 1), 500)).query(InboxNote.class).list();
  }

  @PostMapping("/inbox/{id}/read")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void read(@PathVariable long id) {
    var me = CurrentUser.get();
    int n = db.sql("""
        insert into inbox_read (note_id, user_id) select n.id, :uid from inbox_note n where n.id = :id and %s
        on conflict do nothing""".formatted(MINE))
        .param("id", id).param("uid", me.id()).param("role", me.role()).param("all", me.superAdmin())
        .param("branches", me.branches().toArray(String[]::new)).update();
    if (n == 0 && db.sql("select count(*) from inbox_read where note_id = ? and user_id = ?").params(id, me.id()).query(Integer.class).single() == 0)
      throw new ApiException(404, "Notification not found");
  }

  @PostMapping("/inbox/read-all")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void readAll() {
    var me = CurrentUser.get();
    db.sql("insert into inbox_read (note_id, user_id) select n.id, :uid from inbox_note n where %s on conflict do nothing".formatted(MINE))
        .param("uid", me.id()).param("role", me.role()).param("all", me.superAdmin()).param("branches", me.branches().toArray(String[]::new)).update();
  }
}
