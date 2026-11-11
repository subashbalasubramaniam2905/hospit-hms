package com.hospitos.finance;

import com.hospitos.common.ApiException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/**
 * Turns invoices, receipts, refunds and expenses into double-entry vouchers and writes them as TallyPrime XML
 * (Gateway of Tally > Import > Transactions / Masters) or as a CSV day book for Excel.
 *
 * Mapping, using the ledger names in tally_ledger and expense_category:
 *  - Invoice  -> Sales:   Dr patients, Cr income per billing category (taxable value), Cr output GST, round off.
 *  - Payment  -> Receipt: Dr cash/bank for the mode, Cr patients.
 *  - Refund   -> Payment: Dr patients, Cr cash/bank.
 *  - Expense  -> Payment: Dr expense ledger, Dr input GST, Cr TDS payable, Cr cash/bank (Journal when unpaid).
 * A voucher whose money side is not a cash or bank ledger is written as a Journal, which Tally always accepts.
 * Cancelled invoices and expenses are left out. Every voucher carries a fixed REMOTEID taken from its HospitOS id.
 */
@Service
public class TallyExporter {
  public static final Set<String> CASH_BANK = Set.of("Cash-in-Hand", "Bank Accounts", "Bank OD A/c");
  public static final Set<String> GROUPS = Set.of("Sundry Debtors", "Sundry Creditors", "Sales Accounts", "Direct Incomes", "Indirect Incomes",
      "Duties & Taxes", "Direct Expenses", "Indirect Expenses", "Cash-in-Hand", "Bank Accounts", "Bank OD A/c", "Current Liabilities",
      "Current Assets", "Loans & Advances (Asset)", "Provisions", "Fixed Assets", "Loans (Liability)");
  private static final DateTimeFormatter TALLY_DATE = DateTimeFormatter.BASIC_ISO_DATE;
  public static final int MAX_DAYS = 366;

  private final JdbcClient db;
  public TallyExporter(JdbcClient db) { this.db = db; }

  public record Ledger(String key, String label, String ledgerName, String tallyGroup) {}
  /** Positive amount = debit, negative = credit. */
  public record Entry(String ledger, BigDecimal amount) {}
  public record Voucher(String source, String type, String number, LocalDate date, String party, String narration, String remoteId, List<Entry> entries) {
    public BigDecimal debit() { return entries.stream().map(Entry::amount).filter(a -> a.signum() > 0).reduce(BigDecimal.ZERO, BigDecimal::add); }
  }
  public record Book(LocalDate from, LocalDate to, List<Voucher> vouchers, Map<String, String> ledgerGroups, int skippedCancelled) {}

  // ------------------------------------------------------------------ ledgers

  public List<Ledger> ledgers() {
    return db.sql("select key, label, ledger_name, tally_group from tally_ledger order by sort_order")
        .query((r, i) -> new Ledger(r.getString(1), r.getString(2), r.getString(3), r.getString(4))).list();
  }

  // ------------------------------------------------------------------ building

  public Book build(LocalDate from, LocalDate to, String[] branches) {
    if (from == null || to == null) throw new ApiException(400, "Choose a from and to date");
    if (to.isBefore(from)) throw new ApiException(400, "The to date is before the from date");
    if (from.plusDays(MAX_DAYS).isBefore(to)) throw new ApiException(400, "Export at most one year at a time");

    var led = new LinkedHashMap<String, Ledger>();
    ledgers().forEach(l -> led.put(l.key(), l));
    var groups = new LinkedHashMap<String, String>();
    java.util.function.Function<String, String> L = key -> {
      var l = led.get(key);
      if (l == null) throw new IllegalStateException("Tally ledger " + key + " is not set up");
      groups.putIfAbsent(l.ledgerName(), l.tallyGroup());
      return l.ledgerName();
    };
    var out = new ArrayList<Voucher>();
    String scope = " (cast(:br as text[]) is null or i.branch_id = any(cast(:br as text[]))) ";

    // Sales: one voucher per invoice, income split by billing category.
    record Inv(UUID id, String number, LocalDate date, String patientId, String patient, BigDecimal cgst, BigDecimal sgst, BigDecimal igst, BigDecimal total) {}
    var invs = db.sql("select i.id, i.number, i.invoice_date, i.patient_id, p.name, i.cgst, i.sgst, i.igst, i.total from billing_invoices i join patient p on p.id = i.patient_id " +
            "where i.status <> 'CANCELLED' and i.invoice_date between :f and :t and " + scope + " order by i.invoice_date, i.number")
        .param("f", from).param("t", to).param("br", branches)
        .query((r, n) -> new Inv(r.getObject(1, UUID.class), r.getString(2), r.getObject(3, LocalDate.class), r.getString(4), r.getString(5),
            r.getBigDecimal(6), r.getBigDecimal(7), r.getBigDecimal(8), r.getBigDecimal(9))).list();
    var income = new LinkedHashMap<UUID, Map<String, BigDecimal>>();
    db.sql("select l.invoice_id, l.category, sum(l.taxable) from billing_invoice_lines l join billing_invoices i on i.id = l.invoice_id " +
            "where i.status <> 'CANCELLED' and i.invoice_date between :f and :t and " + scope + " group by 1, 2 order by 1, 2")
        .param("f", from).param("t", to).param("br", branches)
        .query(rs -> { income.computeIfAbsent(rs.getObject(1, UUID.class), k -> new LinkedHashMap<>()).put(rs.getString(2), rs.getBigDecimal(3)); });
    for (var i : invs) {
      var e = new ArrayList<Entry>();
      e.add(new Entry(L.apply("PATIENTS"), i.total()));
      income.getOrDefault(i.id(), Map.of()).forEach((cat, amt) -> e.add(new Entry(L.apply("SALES_" + cat), amt.negate())));
      e.add(new Entry(L.apply("OUTPUT_CGST"), i.cgst().negate()));
      e.add(new Entry(L.apply("OUTPUT_SGST"), i.sgst().negate()));
      e.add(new Entry(L.apply("OUTPUT_IGST"), i.igst().negate()));
      balance(e, L.apply("ROUND_OFF"));
      add(out, "INVOICE", "Sales", i.number(), i.date(), L.apply("PATIENTS"), i.patient() + " (" + i.patientId() + "), invoice " + i.number(), i.id(), e);
    }
    int cancelled = db.sql("select count(*) from billing_invoices i where i.status = 'CANCELLED' and i.invoice_date between :f and :t and " + scope)
        .param("f", from).param("t", to).param("br", branches).query(Integer.class).single();

    // Money received and refunded, on the Indian calendar day it happened.
    record Pay(UUID id, String receipt, String type, String mode, BigDecimal amount, String ref, String reason, OffsetDateTime at, String invoice, String patientId, String patient) {}
    var pays = db.sql("select p.id, p.receipt_number, p.type, p.mode, p.amount, p.reference, p.reason, p.received_at, i.number, i.patient_id, pt.name " +
            "from billing_payments p join billing_invoices i on i.id = p.invoice_id join patient pt on pt.id = i.patient_id " +
            "where (p.received_at at time zone 'Asia/Kolkata')::date between :f and :t and " + scope + " order by p.received_at, p.receipt_number")
        .param("f", from).param("t", to).param("br", branches)
        .query((r, n) -> new Pay(r.getObject(1, UUID.class), r.getString(2), r.getString(3), r.getString(4), r.getBigDecimal(5), r.getString(6),
            r.getString(7), r.getObject(8, OffsetDateTime.class), r.getString(9), r.getString(10), r.getString(11))).list();
    for (var p : pays) {
      String money = L.apply("MODE_" + p.mode());
      boolean cash = CASH_BANK.contains(led.get("MODE_" + p.mode()).tallyGroup());
      LocalDate d = p.at().atZoneSameInstant(com.hospitos.billing.service.BillingTime.IST).toLocalDate();
      String who = p.patient() + " (" + p.patientId() + ")";
      if (p.type().equals("PAYMENT")) {
        add(out, "RECEIPT", cash ? "Receipt" : "Journal", p.receipt(), d, L.apply("PATIENTS"),
            "Received from " + who + " against " + p.invoice() + " by " + p.mode().replace('_', ' ').toLowerCase() + (p.ref() == null ? "" : ", ref " + p.ref()), p.id(),
            List.of(new Entry(money, p.amount()), new Entry(L.apply("PATIENTS"), p.amount().negate())));
      } else {
        add(out, "REFUND", cash ? "Payment" : "Journal", p.receipt(), d, L.apply("PATIENTS"),
            "Refund to " + who + " against " + p.invoice() + (p.reason() == null ? "" : ": " + p.reason()), p.id(),
            List.of(new Entry(L.apply("PATIENTS"), p.amount()), new Entry(money, p.amount().negate())));
      }
    }

    // Expenses.
    String escope = " (cast(:br as text[]) is null or e.branch_id = any(cast(:br as text[]))) ";
    record Exp(UUID id, String number, LocalDate date, String ledger, String group, String category, String payee, String desc, String bill,
               BigDecimal amount, BigDecimal gst, boolean inter, BigDecimal tds, String mode, String ref) {}
    var exps = db.sql("select e.id, e.number, e.expense_date, c.tally_ledger, c.tally_group, c.name, e.payee, e.description, e.bill_no, e.amount, e.gst_amount, " +
            "e.interstate, e.tds_amount, e.pay_mode, e.reference from expense e join expense_category c on c.id = e.category_id " +
            "where e.status = 'RECORDED' and e.expense_date between :f and :t and " + escope + " order by e.expense_date, e.number")
        .param("f", from).param("t", to).param("br", branches)
        .query((r, n) -> new Exp(r.getObject(1, UUID.class), r.getString(2), r.getObject(3, LocalDate.class), r.getString(4), r.getString(5), r.getString(6),
            r.getString(7), r.getString(8), r.getString(9), r.getBigDecimal(10), r.getBigDecimal(11), r.getBoolean(12), r.getBigDecimal(13), r.getString(14), r.getString(15))).list();
    cancelled += db.sql("select count(*) from expense e where e.status = 'CANCELLED' and e.expense_date between :f and :t and " + escope)
        .param("f", from).param("t", to).param("br", branches).query(Integer.class).single();
    for (var x : exps) {
      groups.putIfAbsent(x.ledger(), x.group());
      var e = new ArrayList<Entry>();
      e.add(new Entry(x.ledger(), x.amount()));
      if (x.gst().signum() > 0) {
        if (x.inter()) e.add(new Entry(L.apply("INPUT_IGST"), x.gst()));
        else {
          BigDecimal c = x.gst().divide(BigDecimal.valueOf(2), 2, RoundingMode.HALF_UP);
          e.add(new Entry(L.apply("INPUT_CGST"), c));
          e.add(new Entry(L.apply("INPUT_SGST"), x.gst().subtract(c)));
        }
      }
      if (x.tds().signum() > 0) e.add(new Entry(L.apply("TDS_PAYABLE"), x.tds().negate()));
      String key = x.mode().equals("UNPAID") ? "EXPENSES_PAYABLE" : "MODE_" + x.mode();
      boolean cash = CASH_BANK.contains(led.get(key).tallyGroup());
      e.add(new Entry(L.apply(key), x.amount().add(x.gst()).subtract(x.tds()).negate()));
      String narr = x.category() + ": " + x.payee() + (x.desc() == null ? "" : ", " + x.desc()) + (x.bill() == null ? "" : ", bill " + x.bill())
          + (x.ref() == null ? "" : ", ref " + x.ref()) + (x.mode().equals("UNPAID") ? " (not yet paid)" : "");
      add(out, "EXPENSE", cash ? "Payment" : "Journal", x.number(), x.date(), L.apply(key), narr, x.id(), e);
    }

    out.sort((a, b) -> a.date().compareTo(b.date()));
    return new Book(from, to, out, groups, cancelled);
  }

  /** Puts any paisa left over after GST rounding on the round-off ledger, so every voucher balances. */
  private static void balance(List<Entry> e, String roundOff) {
    BigDecimal sum = e.stream().map(Entry::amount).reduce(BigDecimal.ZERO, BigDecimal::add);
    if (sum.signum() != 0) e.add(new Entry(roundOff, sum.negate()));
  }

  private static void add(List<Voucher> out, String source, String type, String number, LocalDate date, String party, String narration, UUID id, List<Entry> entries) {
    // Merge repeated ledgers (e.g. UPI and card both on "Bank Account") and drop zero lines.
    var merged = new LinkedHashMap<String, BigDecimal>();
    entries.forEach(x -> merged.merge(x.ledger(), x.amount().setScale(2, RoundingMode.HALF_UP), BigDecimal::add));
    var list = new ArrayList<Entry>();
    merged.forEach((l, a) -> { if (a.signum() != 0) list.add(new Entry(l, a)); });
    if (list.size() < 2) return;
    BigDecimal sum = list.stream().map(Entry::amount).reduce(BigDecimal.ZERO, BigDecimal::add);
    if (sum.signum() != 0) throw new IllegalStateException("Voucher " + number + " does not balance by " + sum);
    out.add(new Voucher(source, type, number, date, party, narration, "hospitos-" + id, list));
  }

  // ------------------------------------------------------------------ writers

  public String mastersXml(Book b, String company) {
    var sb = new StringBuilder();
    open(sb, "All Masters", company);
    b.ledgerGroups().forEach((name, group) -> {
      sb.append("   <TALLYMESSAGE xmlns:UDF=\"TallyUDF\">\n    <LEDGER NAME=\"").append(x(name)).append("\" ACTION=\"Create\">\n")
        .append("     <NAME.LIST><NAME>").append(x(name)).append("</NAME></NAME.LIST>\n")
        .append("     <PARENT>").append(x(group)).append("</PARENT>\n")
        .append("     <ISBILLWISEON>No</ISBILLWISEON>\n     <AFFECTSSTOCK>No</AFFECTSSTOCK>\n");
      String head = name.toUpperCase().contains("CGST") ? "Central Tax" : name.toUpperCase().contains("SGST") ? "State Tax" : name.toUpperCase().contains("IGST") ? "Integrated Tax" : null;
      if ("Duties & Taxes".equals(group) && head != null)
        sb.append("     <TAXTYPE>GST</TAXTYPE>\n     <GSTDUTYHEAD>").append(head).append("</GSTDUTYHEAD>\n");
      sb.append("    </LEDGER>\n   </TALLYMESSAGE>\n");
    });
    close(sb);
    return sb.toString();
  }

  public String vouchersXml(Book b, String company) {
    var sb = new StringBuilder();
    open(sb, "Vouchers", company);
    for (var v : b.vouchers()) {
      String d = v.date().format(TALLY_DATE);
      sb.append("   <TALLYMESSAGE xmlns:UDF=\"TallyUDF\">\n    <VOUCHER REMOTEID=\"").append(x(v.remoteId())).append("\" VCHTYPE=\"").append(v.type())
        .append("\" ACTION=\"Create\" OBJVIEW=\"Accounting Voucher View\">\n")
        .append("     <DATE>").append(d).append("</DATE>\n")
        .append("     <VOUCHERTYPENAME>").append(v.type()).append("</VOUCHERTYPENAME>\n")
        .append("     <VOUCHERNUMBER>").append(x(v.number())).append("</VOUCHERNUMBER>\n")
        .append("     <REFERENCE>").append(x(v.number())).append("</REFERENCE>\n")
        .append("     <PARTYLEDGERNAME>").append(x(v.party())).append("</PARTYLEDGERNAME>\n")
        .append("     <NARRATION>").append(x(v.narration())).append("</NARRATION>\n")
        .append("     <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>\n");
      for (var e : v.entries()) {
        boolean dr = e.amount().signum() > 0;
        // Tally writes debits as negative amounts with ISDEEMEDPOSITIVE=Yes, credits as positive with No.
        sb.append("     <ALLLEDGERENTRIES.LIST>\n      <LEDGERNAME>").append(x(e.ledger())).append("</LEDGERNAME>\n")
          .append("      <ISDEEMEDPOSITIVE>").append(dr ? "Yes" : "No").append("</ISDEEMEDPOSITIVE>\n")
          .append("      <ISPARTYLEDGER>").append(e.ledger().equals(v.party()) ? "Yes" : "No").append("</ISPARTYLEDGER>\n")
          .append("      <AMOUNT>").append(e.amount().negate().toPlainString()).append("</AMOUNT>\n     </ALLLEDGERENTRIES.LIST>\n");
      }
      sb.append("    </VOUCHER>\n   </TALLYMESSAGE>\n");
    }
    close(sb);
    return sb.toString();
  }

  /** A day book that opens in Excel: one row per ledger line, debits and credits in their own columns. */
  public String csv(Book b) {
    var sb = new StringBuilder("﻿");
    sb.append("Date,Voucher type,Voucher number,Ledger,Tally group,Debit,Credit,Narration,Source\r\n");
    for (var v : b.vouchers())
      for (var e : v.entries()) {
        boolean dr = e.amount().signum() > 0;
        sb.append(v.date()).append(',').append(c(v.type())).append(',').append(c(v.number())).append(',').append(c(e.ledger())).append(',')
          .append(c(b.ledgerGroups().getOrDefault(e.ledger(), ""))).append(',').append(dr ? e.amount().toPlainString() : "").append(',')
          .append(dr ? "" : e.amount().negate().toPlainString()).append(',').append(c(v.narration())).append(',').append(v.source()).append("\r\n");
      }
    return sb.toString();
  }

  private static void open(StringBuilder sb, String report, String company) {
    sb.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!-- Exported from HospitOS. Import in TallyPrime: Gateway of Tally > Import > ")
      .append(report.equals("Vouchers") ? "Transactions" : "Masters").append(" -->\n")
      .append("<ENVELOPE>\n <HEADER>\n  <TALLYREQUEST>Import Data</TALLYREQUEST>\n </HEADER>\n <BODY>\n  <IMPORTDATA>\n   <REQUESTDESC>\n")
      .append("    <REPORTNAME>").append(report).append("</REPORTNAME>\n");
    if (company != null && !company.isBlank())
      sb.append("    <STATICVARIABLES><SVCURRENTCOMPANY>").append(x(company.trim())).append("</SVCURRENTCOMPANY></STATICVARIABLES>\n");
    sb.append("   </REQUESTDESC>\n   <REQUESTDATA>\n");
  }

  private static void close(StringBuilder sb) { sb.append("   </REQUESTDATA>\n  </IMPORTDATA>\n </BODY>\n</ENVELOPE>\n"); }

  /** XML text: escapes markup and drops control characters Tally rejects. */
  static String x(String s) {
    if (s == null) return "";
    var sb = new StringBuilder(s.length());
    for (char ch : s.toCharArray()) {
      switch (ch) {
        case '&' -> sb.append("&amp;"); case '<' -> sb.append("&lt;"); case '>' -> sb.append("&gt;");
        case '"' -> sb.append("&quot;"); case '\'' -> sb.append("&apos;");
        default -> { if (ch >= 0x20 || ch == '\t') sb.append(ch); else if (ch == '\n' || ch == '\r') sb.append(' '); }
      }
    }
    return sb.toString();
  }

  /** CSV cell, also guarding against spreadsheet formula injection from typed-in text. */
  static String c(String s) {
    if (s == null) return "";
    String v = s;
    if (!v.isEmpty() && "=+-@".indexOf(v.charAt(0)) >= 0) v = "'" + v;
    return v.contains(",") || v.contains("\"") || v.contains("\n") || v.contains("\r") ? "\"" + v.replace("\"", "\"\"") + "\"" : v;
  }
}
