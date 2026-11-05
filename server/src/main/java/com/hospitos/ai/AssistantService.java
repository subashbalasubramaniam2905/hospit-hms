package com.hospitos.ai;

import com.hospitos.audit.AuditService;
import com.hospitos.common.ApiException;
import com.hospitos.common.CurrentUser;
import com.hospitos.insights.DashboardService;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.text.NumberFormat;
import java.util.List;
import java.util.Locale;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;

/**
 * The operations assistant. It answers from a snapshot of today's figures for the user's branches (counts and amounts only, no
 * patient names or clinical notes), so nothing identifying leaves the hospital. With a Claude API key the snapshot and question go
 * to Claude; without one, or if the call fails, fixed rules answer from the same snapshot.
 */
@Service
public class AssistantService {
  private final DashboardService dashboard;
  private final AiModel model;
  private final AuditService audit;
  public AssistantService(DashboardService dashboard, AiModel model, AuditService audit) { this.dashboard = dashboard; this.model = model; this.audit = audit; }

  public record Turn(String from, String text) {}
  public record Answer(String answer, String link, String label, String source, String model) {}
  public record Status(boolean live, String model) {}

  public Status status() { return new Status(model.enabled(), model.enabled() ? model.name() : null); }

  static final String SYSTEM = """
      You are the operations assistant inside HospitOS, a hospital management system used by staff at a hospital in Tamil Nadu, India.
      You answer questions from hospital staff about today's operations using only the figures provided in the user turn, which come
      live from the hospital's database for the branches the staff member works in.

      Rules:
      - Use only the figures given. If the figures do not answer the question, say what you can and cannot see. Never invent numbers.
      - You do not have patient names, records or clinical notes. Do not give diagnoses, treatment or dosing advice; for clinical
        questions say that the treating clinician decides and point to the relevant screen.
      - Bed occupancy, emergency and staff rosters are not in the figures yet. Say so if asked.
      - Money is in Indian rupees. Write amounts like ₹1,25,000 (Indian digit grouping).
      - Keep answers short: two to four plain sentences, no headings, no tables, no markdown.
      - Where it helps, suggest one practical next step (for example, which queue step to staff up).""";

  public Answer ask(String question, List<Turn> history, String branch) {
    String q = question == null ? "" : question.trim();
    if (q.isEmpty()) throw new ApiException(400, "Ask a question");
    if (q.length() > 1000) throw new ApiException(400, "Keep the question under 1,000 characters");
    var d = dashboard.get(branch);
    String figures = figures(d);
    var link = link(q);
    var me = CurrentUser.get();
    audit.logForBranch(me.homeBranch(), "Asked", "AI assistant", null, q.length() > 80 ? q.substring(0, 80) + "…" : q);

    if (model.enabled()) {
      String earlier = history == null || history.isEmpty() ? "" : "Earlier in this conversation:\n" + history.stream()
          .skip(Math.max(0, history.size() - 6))
          .map(t -> ("me".equals(t.from()) ? "Staff: " : "Assistant: ") + trim(t.text(), 500)).collect(Collectors.joining("\n")) + "\n\n";
      String user = "Today's figures (" + d.date() + "):\n" + figures + "\n\n" + earlier + "Question from " + me.role() + ": " + q;
      var a = model.answer(SYSTEM, user);
      if (a.isPresent()) return new Answer(a.get(), link[0], link[1], "claude", model.name());
    }
    return new Answer(rules(q, d), link[0], link[1], "rules", null);
  }

  private static String trim(String s, int n) { return s == null ? "" : s.length() > n ? s.substring(0, n) : s; }

  static String inr(BigDecimal v) {
    var f = NumberFormat.getInstance(Locale.forLanguageTag("en-IN"));
    f.setMaximumFractionDigits(0);
    return "₹" + f.format(v.setScale(0, RoundingMode.HALF_UP));
  }

  static final String[] STEPS = { "Registration", "Billing", "Triage", "Consultation", "Lab / imaging", "Pharmacy", "Discharge" };

  /** The snapshot sent to the model: aggregate figures only. */
  static String figures(DashboardService.Dashboard d) {
    var sb = new StringBuilder();
    sb.append("Appointments today: ").append(d.appointments()).append(" booked, ").append(d.checkedIn()).append(" checked in, ").append(d.completed())
        .append(" completed, ").append(d.toCome()).append(" still to come, ").append(d.cancelledOrNoShow()).append(" cancelled or no-show\n");
    sb.append("OPD queue now by step: ");
    for (int i = 0; i < 7; i++) sb.append(STEPS[i]).append(" ").append(d.queueByStep()[i]).append(i < 6 ? ", " : "\n");
    sb.append("Patients waiting more than 25 minutes at one step: ").append(d.longWaits()).append("\n");
    sb.append("New registrations today: ").append(d.newRegistrations()).append("\n");
    sb.append("Collected today: ").append(inr(d.collectedToday())).append(" (pharmacy ").append(inr(d.pharmacySalesToday())).append(")\n");
    sb.append("Outstanding on open invoices: ").append(inr(d.outstanding())).append(" across ").append(d.outstandingCount()).append(" invoices\n");
    sb.append("Lab: ").append(d.labAwaitingSample()).append(" awaiting sample, ").append(d.labProcessing()).append(" processing, ")
        .append(d.labToVerify()).append(" results to verify, ").append(d.labCritical()).append(" orders with critical values not yet delivered\n");
    sb.append("Pharmacy: ").append(d.rxToDispense()).append(" prescriptions to dispense, ").append(d.lowStock()).append(" medicines below reorder level, ")
        .append(d.nearExpiry()).append(" batches expiring within 60 days\n");
    sb.append("Insurance claims: ").append(d.claimsInReview()).append(" with insurers, ").append(d.claimDrafts()).append(" drafts not submitted\n");
    sb.append("Unbilled: ").append(d.unbilledConsultations()).append(" completed consultations and ").append(d.unbilledLab()).append(" lab orders without an invoice\n");
    sb.append("Follow-ups: ").append(d.followUpsOverdue()).append(" overdue, ").append(d.followUpsDue()).append(" due in the next 7 days\n");
    sb.append("Doctors: ").append(d.doctorsAvailable()).append(" of ").append(d.doctorsTotal()).append(" available")
        .append(d.runningLateDepts().isEmpty() ? "" : ", running late in " + String.join(", ", d.runningLateDepts())).append("\n");
    sb.append("Open alerts: ").append(d.openAlerts()).append(" (").append(d.criticalAlerts()).append(" critical)\n");
    sb.append("Departments, last 30 days (visits, completed, consultation revenue, average wait to see the doctor):\n");
    for (var r : d.departments()) {
      if (r.visits() == 0) continue;
      sb.append("- ").append(r.name()).append(": ").append(r.visits()).append(" visits, ").append(r.completed()).append(" completed, ")
          .append(inr(r.revenue())).append(", ").append(r.avgWaitMin() == null ? "wait not recorded" : r.avgWaitMin() + " min wait").append("\n");
    }
    return sb.toString().trim();
  }

  /** The screen that goes with a question. */
  static String[] link(String q) {
    String t = q.toLowerCase(Locale.ROOT);
    if (t.matches("(?s).*(wait|queue|delay|token).*")) return new String[] { "/queue", "Open queue" };
    if (t.matches("(?s).*(revenue|collect|income|cash|outstanding|unpaid|bill).*")) return new String[] { "/billing", "Open billing" };
    if (t.matches("(?s).*(stock|expir|medicine|pharmac|dispens).*")) return new String[] { "/pharmacy/inventory", "Open pharmacy stock" };
    if (t.matches("(?s).*(lab|tat|turnaround|sample|report|critical).*")) return new String[] { "/lab/orders", "Open lab orders" };
    if (t.matches("(?s).*(claim|insur|tpa).*")) return new String[] { "/insurance", "Open claims" };
    if (t.matches("(?s).*(no.?show|cancel|appointment|booking).*")) return new String[] { "/appointments", "Open appointments" };
    if (t.matches("(?s).*(follow.?up|review|recall).*")) return new String[] { "/follow-ups", "Open follow-ups" };
    if (t.matches("(?s).*(alert).*")) return new String[] { "/alerts", "Open alerts" };
    if (t.matches("(?s).*(leak|unbilled|not billed).*")) return new String[] { "/revenue-leakage", "Open revenue leakage" };
    return new String[] { null, null };
  }

  /** Fixed answers from the same snapshot, used without an API key. */
  static String rules(String q, DashboardService.Dashboard d) {
    String t = q.toLowerCase(Locale.ROOT);
    int[] s = d.queueByStep();
    if (t.matches("(?s).*(bed|occupan|admit|ward|icu).*"))
      return "Bed and ward figures are not on the server yet, so I can't count free beds. The inpatient module will add them.";
    if (t.matches("(?s).*(wait|queue|delay|token).*")) {
      int busiest = 0;
      for (int i = 0; i < 6; i++) if (s[i] > s[busiest]) busiest = i;
      int inQueue = 0;
      for (int i = 0; i < 6; i++) inQueue += s[i];
      return inQueue + " patients are in the OPD queue. " + d.longWaits() + " have waited more than 25 minutes at one step. "
          + (inQueue == 0 ? "Nobody is waiting right now." : "The longest line is at " + STEPS[busiest] + " (" + s[busiest] + " patients).");
    }
    if (t.matches("(?s).*(revenue|collect|income|cash).*"))
      return "Collections today are " + inr(d.collectedToday()) + ", of which pharmacy is " + inr(d.pharmacySalesToday()) + ". "
          + inr(d.outstanding()) + " is outstanding across " + d.outstandingCount() + " open invoices.";
    if (t.matches("(?s).*(outstanding|unpaid|due).*"))
      return inr(d.outstanding()) + " is outstanding across " + d.outstandingCount() + " open invoices.";
    if (t.matches("(?s).*(stock|expir|medicine|pharmac|dispens).*"))
      return d.lowStock() + " medicines are below reorder level and " + d.nearExpiry() + " batches expire within 60 days. "
          + d.rxToDispense() + " prescriptions are waiting to be dispensed.";
    if (t.matches("(?s).*(no.?show|cancel).*"))
      return d.cancelledOrNoShow() + " of today's appointments are cancelled or marked no-show. Reminders the day before are the usual first fix.";
    if (t.matches("(?s).*(lab|tat|turnaround|sample|critical).*"))
      return (d.labAwaitingSample() + d.labProcessing() + d.labToVerify()) + " lab orders are in progress: " + d.labAwaitingSample() + " awaiting sample, "
          + d.labProcessing() + " processing and " + d.labToVerify() + " waiting for verification. " + d.labCritical() + " have critical values not yet delivered.";
    if (t.matches("(?s).*(claim|insur|tpa).*"))
      return d.claimsInReview() + " insurance claims are waiting on insurers and " + d.claimDrafts() + " drafts have not been submitted.";
    if (t.matches("(?s).*(follow.?up|recall).*"))
      return d.followUpsOverdue() + " follow-ups are overdue and " + d.followUpsDue() + " are due in the next 7 days.";
    if (t.matches("(?s).*(unbilled|leak|not billed).*"))
      return d.unbilledConsultations() + " completed consultations and " + d.unbilledLab() + " lab orders have no invoice yet.";
    if (t.matches("(?s).*(doctor|late|available).*"))
      return d.doctorsAvailable() + " of " + d.doctorsTotal() + " doctors are available."
          + (d.runningLateDepts().isEmpty() ? " No clinic is marked as running late." : " Running late: " + String.join(", ", d.runningLateDepts()) + ".");
    if (t.matches("(?s).*(appointment|booking|today|visit).*"))
      return d.appointments() + " appointments are booked today: " + d.checkedIn() + " checked in, " + d.completed() + " completed and " + d.toCome() + " still to come.";
    if (t.matches("(?s).*(alert).*"))
      return d.openAlerts() + " alerts are open, " + d.criticalAlerts() + " of them critical.";
    return "Without the AI service I can answer about the queue, appointments, collections and dues, medicine stock, lab work, claims, "
        + "follow-ups, unbilled services, doctors and alerts.";
  }
}
