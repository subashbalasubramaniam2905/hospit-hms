package com.hospitos.finance;

import com.hospitos.audit.AuditService;
import com.hospitos.common.ApiException;
import com.hospitos.common.CurrentUser;
import com.hospitos.finance.TallyExporter.Ledger;
import com.hospitos.finance.TallyExporter.Voucher;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

/** Export of billing and expenses to Tally (XML) or Excel (CSV), and the ledger names used. */
@RestController
@RequestMapping("/api/tally")
@PreAuthorize(ExpenseController.ACCOUNTS)
public class TallyController {
  private final TallyExporter tally;
  private final JdbcClient db;
  private final AuditService audit;
  public TallyController(TallyExporter tally, JdbcClient db, AuditService audit) { this.tally = tally; this.db = db; this.audit = audit; }

  // ---- settings

  public record Settings(String companyName, List<Ledger> ledgers, List<String> groups, OffsetDateTime updatedAt, String updatedBy) {}

  @GetMapping("/settings")
  public Settings settings() {
    record Row(String company, OffsetDateTime at, String by) {}
    var r = db.sql("select company_name, updated_at, updated_by from tally_settings where id = 1")
        .query((rs, i) -> new Row(rs.getString(1), rs.getObject(2, OffsetDateTime.class), rs.getString(3))).single();
    return new Settings(r.company(), tally.ledgers(), TallyExporter.GROUPS.stream().sorted().toList(), r.at(), r.by());
  }

  public record LedgerInput(@NotBlank String key, @NotBlank @Size(max = 120) String ledgerName, @NotBlank String tallyGroup) {}
  public record SettingsInput(@NotNull @Size(max = 120) String companyName, @NotNull List<@Valid LedgerInput> ledgers) {}

  @PutMapping("/settings")
  @PreAuthorize(ExpenseController.MANAGERS)
  @Transactional
  public Settings update(@Valid @RequestBody SettingsInput in) {
    var known = new LinkedHashMap<String, Ledger>();
    tally.ledgers().forEach(l -> known.put(l.key(), l));
    var changes = new StringBuilder();
    for (var l : in.ledgers()) {
      var cur = known.get(l.key());
      if (cur == null) throw new ApiException(400, "Unknown ledger " + l.key());
      if (!TallyExporter.GROUPS.contains(l.tallyGroup())) throw new ApiException(400, "Unknown Tally group " + l.tallyGroup());
      String name = l.ledgerName().trim();
      if (name.equals(cur.ledgerName()) && l.tallyGroup().equals(cur.tallyGroup())) continue;
      db.sql("update tally_ledger set ledger_name = ?, tally_group = ? where key = ?").params(name, l.tallyGroup(), l.key()).update();
      changes.append(changes.isEmpty() ? "" : "; ").append(cur.label()).append(" -> ").append(name);
    }
    // One ledger name cannot sit under two groups in Tally.
    var clash = db.sql("select ledger_name from tally_ledger group by ledger_name having count(distinct tally_group) > 1 limit 1").query(String.class).optional();
    if (clash.isPresent()) throw new ApiException(422, "The ledger \"" + clash.get() + "\" is set under two different Tally groups. Use one group for it");
    db.sql("update tally_settings set company_name = ?, updated_at = now(), updated_by = ? where id = 1").params(in.companyName().trim(), CurrentUser.get().name()).update();
    audit.log("Updated", "TallySettings", "1", "Company \"" + in.companyName().trim() + "\"" + (changes.isEmpty() ? "" : ", " + changes));
    return settings();
  }

  // ---- preview and export

  public record Totals(int count, BigDecimal amount) {}
  public record Preview(LocalDate from, LocalDate to, int vouchers, Map<String, Totals> bySource, int skippedCancelled, int ledgers,
      List<String> warnings, List<Voucher> sample) {}

  private TallyExporter.Book book(LocalDate from, LocalDate to, String branchId) {
    return tally.build(from, to, ExpenseService.scope(branchId));
  }

  @GetMapping("/preview")
  public Preview preview(@RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                         @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to, @RequestParam(required = false) String branchId) {
    var b = book(from, to, branchId);
    var by = new LinkedHashMap<String, Totals>();
    for (String s : List.of("INVOICE", "RECEIPT", "REFUND", "EXPENSE")) by.put(s, new Totals(0, BigDecimal.ZERO));
    for (var v : b.vouchers()) by.merge(v.source(), new Totals(1, v.debit()), (a, c) -> new Totals(a.count() + c.count(), a.amount().add(c.amount())));
    var warn = new java.util.ArrayList<String>();
    String company = db.sql("select company_name from tally_settings where id = 1").query(String.class).single();
    if (company.isBlank()) warn.add("No Tally company name is set, so Tally imports into whichever company is open.");
    if (db.sql("select sample_data from billing_settings where id = 1").query(Boolean.class).single())
      warn.add("Billing still uses the sample GSTIN and hospital name. Save the real details in billing settings first.");
    if (b.skippedCancelled() > 0) warn.add(b.skippedCancelled() + " cancelled invoices or expenses are left out.");
    return new Preview(from, to, b.vouchers().size(), by, b.skippedCancelled(), b.ledgerGroups().size(), warn,
        b.vouchers().subList(0, Math.min(50, b.vouchers().size())));
  }

  @GetMapping("/export")
  public ResponseEntity<byte[]> export(@RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                       @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
                                       @RequestParam(required = false) String branchId, @RequestParam(defaultValue = "xml") String format) {
    var b = book(from, to, branchId);
    String company = db.sql("select company_name from tally_settings where id = 1").query(String.class).single();
    String body, name; MediaType type;
    switch (format) {
      case "xml" -> { body = tally.vouchersXml(b, company); name = "tally-vouchers"; type = MediaType.APPLICATION_XML; }
      case "masters" -> { body = tally.mastersXml(b, company); name = "tally-ledgers"; type = MediaType.APPLICATION_XML; }
      case "csv" -> { body = tally.csv(b); name = "daybook"; type = new MediaType("text", "csv", StandardCharsets.UTF_8); }
      default -> throw new ApiException(400, "Format must be xml, masters or csv");
    }
    String file = name + "-" + from + "-to-" + to + (branchId == null || branchId.isBlank() ? "" : "-" + branchId.replaceAll("[^A-Za-z0-9]", "")) + (format.equals("csv") ? ".csv" : ".xml");
    int count = format.equals("masters") ? b.ledgerGroups().size() : b.vouchers().size();
    db.sql("insert into tally_export_log (branch_id, from_date, to_date, format, vouchers, exported_by) values (?, ?, ?, ?, ?, ?)")
        .params(branchId == null || branchId.isBlank() ? null : branchId, from, to, format, count, CurrentUser.get().name()).update();
    audit.logForBranch(branchId == null || branchId.isBlank() ? null : branchId, "Exported", "Tally", format,
        from + " to " + to + ", " + count + (format.equals("masters") ? " ledgers" : " vouchers"));
    return ResponseEntity.ok()
        .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment().filename(file).build().toString())
        .header(HttpHeaders.CACHE_CONTROL, "no-store")
        .contentType(type).body(body.getBytes(StandardCharsets.UTF_8));
  }

  public record LogEntry(UUID id, String branchId, LocalDate from, LocalDate to, String format, int vouchers, String exportedBy, OffsetDateTime exportedAt) {}

  @GetMapping("/history")
  public List<LogEntry> history() {
    var me = CurrentUser.get();
    String[] br = me.superAdmin() ? null : me.branches().toArray(String[]::new);
    return db.sql("""
        select * from tally_export_log where cast(:br as text[]) is null or branch_id is null or branch_id = any(cast(:br as text[]))
        order by exported_at desc limit 30""").param("br", br)
        .query((r, i) -> new LogEntry(r.getObject("id", UUID.class), r.getString("branch_id"), r.getObject("from_date", LocalDate.class),
            r.getObject("to_date", LocalDate.class), r.getString("format"), r.getInt("vouchers"), r.getString("exported_by"),
            r.getObject("exported_at", OffsetDateTime.class))).list();
  }
}
