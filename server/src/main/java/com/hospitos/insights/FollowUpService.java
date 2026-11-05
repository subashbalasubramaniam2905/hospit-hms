package com.hospitos.insights;

import com.hospitos.audit.AuditService;
import com.hospitos.common.ApiException;
import com.hospitos.common.CurrentUser;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Follow-ups are the review dates doctors set when they complete a consultation (consultation.follow_up_date).
 * A follow-up counts as booked once the patient has a later visit with the same doctor, and as completed when that visit is done.
 */
@Service
public class FollowUpService {
  private final JdbcClient db;
  private final Scope scope;
  private final AuditService audit;
  public FollowUpService(JdbcClient db, Scope scope, AuditService audit) { this.db = db; this.scope = scope; this.audit = audit; }

  /** A visit with the same doctor booked after the consultation was completed. */
  static final String LATER_VISIT = " from appointment a where a.patient_id = c.patient_id and a.doctor_id = c.doctor_id " +
      "and a.created_at >= c.completed_at and a.status not in ('Cancelled','No-show')";
  /** SQL on consultation c: a follow-up that is neither booked nor completed. */
  static final String OPEN_FOLLOW_UP = " c.status = 'Completed' and c.follow_up_date is not null and not exists (select 1 " + LATER_VISIT + ") ";

  public record FollowUp(String id, String patientId, String patientName, String mobile, String doctorId, String doctorName,
                         String reason, LocalDate due, String status, String reminder, OffsetDateTime lastReminderAt, String branchId) {}

  public List<FollowUp> list(String branch, String doctorId) {
    String[] br = scope.branches(branch);
    LocalDate t = scope.today();
    return db.sql("""
        select c.id, c.patient_id, p.name, p.mobile, c.doctor_id, d.name,
               coalesce(nullif(c.follow_up, ''), (select label from consultation_diagnosis x where x.consultation_id = c.id order by position limit 1), 'Review'),
               c.follow_up_date,
               case when exists (select 1 """ + LATER_VISIT + """
                     and a.status = 'Completed') then 'Completed'
                    when exists (select 1 """ + LATER_VISIT + """
                    ) then 'Booked'
                    when c.follow_up_date < :t then 'Overdue' else 'Due' end,
               (select max(sent_at) from followup_reminder r where r.consultation_id = c.id),
               c.branch_id
          from consultation c join patient p on p.id = c.patient_id join doctor d on d.id = c.doctor_id
         where c.status = 'Completed' and c.follow_up_date is not null and c.follow_up_date >= :from
           and (cast(:doc as text) is null or c.doctor_id = :doc) and""" + Scope.in("c") + """
         order by c.follow_up_date""")
        .param("t", t).param("from", t.minusDays(180)).param("doc", doctorId == null || doctorId.isBlank() ? null : doctorId).param("br", br)
        .query((rs, n) -> {
          var last = rs.getObject(10, OffsetDateTime.class);
          return new FollowUp(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5), rs.getString(6),
              rs.getString(7), rs.getObject(8, LocalDate.class), rs.getString(9), last == null ? "Not sent" : "Sent", last, rs.getString(11));
        }).list();
  }

  /**
   * Records reminders for the given follow-ups. No WhatsApp or SMS gateway is connected yet, so this only records that the desk
   * reminded the patient (for example by phone) and audits it.
   */
  @Transactional
  public int remind(List<String> ids) {
    var me = CurrentUser.get();
    int n = 0;
    for (String raw : ids) {
      UUID id;
      try { id = UUID.fromString(raw); } catch (IllegalArgumentException e) { throw new ApiException(400, "Unknown follow-up " + raw); }
      var branch = db.sql("select branch_id from consultation where id = :id and follow_up_date is not null").param("id", id).query(String.class).optional();
      if (branch.isEmpty() || !me.canSee(branch.get())) throw new ApiException(404, "Follow-up not found");
      db.sql("insert into followup_reminder (consultation_id, sent_by) values (:id, :by)").param("id", id).param("by", me.id()).update();
      audit.logForBranch(branch.get(), "Sent", "Follow-up reminder", id.toString(), "Reminder recorded");
      n++;
    }
    return n;
  }
}
