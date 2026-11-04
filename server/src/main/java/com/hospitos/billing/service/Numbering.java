package com.hospitos.billing.service;

import com.hospitos.billing.gst.GstCalculator;
import java.time.LocalDate;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Issues consecutive document numbers per financial year, e.g. INV-2627-000123 (15 characters, inside GST's
 * 16-character limit). The counter row stays locked until the caller's transaction commits, so a rolled-back
 * invoice gives its number back and the series stays gap-free.
 */
@Component
public class Numbering {
  private final JdbcClient db;
  public Numbering(JdbcClient db) { this.db = db; }

  @Transactional(propagation = Propagation.MANDATORY)
  public String next(String prefix, LocalDate date) {
    String fy = GstCalculator.finYear(date);
    long n = db.sql("""
        insert into billing_number_sequences (doc_type, fin_year, next_value) values (?, ?, 2)
        on conflict (doc_type, fin_year) do update set next_value = billing_number_sequences.next_value + 1
        returning next_value - 1""").params(prefix, fy).query(Long.class).single();
    return prefix + "-" + fy + "-" + String.format("%06d", n);
  }
}
