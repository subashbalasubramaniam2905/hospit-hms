package com.hospitos.billing.service;

import com.hospitos.audit.AuditService;
import com.hospitos.billing.api.LineCategory;
import com.hospitos.billing.gst.GstCalculator;
import com.hospitos.billing.model.BillingSettings;
import com.hospitos.billing.model.TaxRate;
import com.hospitos.common.ApiException;
import com.hospitos.common.CurrentUser;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SettingsService {
  private final JdbcClient db;
  private final AuditService audit;
  public SettingsService(JdbcClient db, AuditService audit) { this.db = db; this.audit = audit; }

  public BillingSettings get() {
    return db.sql("select * from billing_settings where id = 1").query((r, i) -> new BillingSettings(
        r.getString("legal_name"), r.getString("trade_name"), r.getString("gstin"), r.getString("state_code"),
        r.getString("state_name"), r.getString("address"), r.getString("phone"), r.getString("email"),
        r.getString("invoice_prefix"), r.getString("receipt_prefix"), r.getString("refund_prefix"), r.getString("claim_prefix"),
        r.getBigDecimal("discount_approval_pct"), r.getBigDecimal("default_copay_pct"), r.getString("invoice_footer"),
        r.getBoolean("sample_data"), r.getObject("updated_at", OffsetDateTime.class).toInstant(), r.getString("updated_by"),
        r.getInt("version"))).single();
  }

  /** GSTIN printed on a branch's invoices: the branch's own registration if set, else the hospital's. */
  public String gstinFor(String branchId, BillingSettings s) {
    String g = db.sql("select gstin from branch where id = ?").param(branchId).query(String.class).optional().orElse(null);
    return g != null && !g.isBlank() ? g.trim().toUpperCase() : s.gstin();
  }

  public List<TaxRate> taxRates() {
    return db.sql("select * from billing_tax_rates order by category").query((r, i) -> new TaxRate(
        LineCategory.valueOf(r.getString("category")), r.getBigDecimal("gst_pct"), r.getString("hsn_sac"), r.getString("note"))).list();
  }

  public Map<LineCategory, TaxRate> taxRateMap() {
    var m = new EnumMap<LineCategory, TaxRate>(LineCategory.class);
    taxRates().forEach(t -> m.put(t.category(), t));
    return m;
  }

  public record SettingsUpdate(String legalName, String tradeName, String gstin, String stateCode, String stateName,
      String address, String phone, String email, BigDecimal discountApprovalPct, BigDecimal defaultCopayPct,
      String invoiceFooter, int version) {}

  @Transactional
  public BillingSettings update(SettingsUpdate u) {
    String gstin = u.gstin() == null ? "" : u.gstin().trim().toUpperCase();
    if (!GstCalculator.isValidGstin(gstin)) throw new ApiException(422, "GSTIN is not valid. Check the format and the last (check) character");
    if (!gstin.startsWith(u.stateCode())) throw new ApiException(422, "GSTIN must start with the state code " + u.stateCode());
    int n = db.sql("""
        update billing_settings set legal_name = :legal, trade_name = :trade, gstin = :gstin, state_code = :sc, state_name = :sn,
          address = :addr, phone = :phone, email = :email,
          discount_approval_pct = coalesce(:dap, discount_approval_pct), default_copay_pct = coalesce(:dcp, default_copay_pct),
          invoice_footer = :footer, sample_data = false, updated_at = :now, updated_by = :by, version = version + 1
        where id = 1 and version = :version""")
        .param("legal", u.legalName().trim()).param("trade", u.tradeName().trim()).param("gstin", gstin)
        .param("sc", u.stateCode()).param("sn", u.stateName()).param("addr", u.address()).param("phone", u.phone())
        .param("email", u.email()).param("dap", u.discountApprovalPct()).param("dcp", u.defaultCopayPct())
        .param("footer", u.invoiceFooter()).param("now", OffsetDateTime.now()).param("by", CurrentUser.get().name())
        .param("version", u.version()).update();
    if (n == 0) throw new ApiException(409, "Billing settings were changed by someone else. Reload and try again");
    audit.log("Updated", "BillingSettings", "1", "GSTIN " + gstin + ", " + u.legalName());
    return get();
  }

  @Transactional
  public TaxRate updateRate(LineCategory category, BigDecimal gstPct, String hsnSac, String note) {
    BigDecimal old = db.sql("select gst_pct from billing_tax_rates where category = ?").param(category.name())
        .query(BigDecimal.class).optional().orElseThrow(() -> new ApiException(404, "Tax category not found"));
    db.sql("update billing_tax_rates set gst_pct = ?, hsn_sac = ?, note = ? where category = ?")
        .params(gstPct, hsnSac, note, category.name()).update();
    audit.log("Updated", "TaxRate", category.name(), old.stripTrailingZeros().toPlainString() + "% -> " + gstPct.stripTrailingZeros().toPlainString() + "%");
    return new TaxRate(category, gstPct, hsnSac, note);
  }

}
