package com.hospitos.billing.service;

import com.hospitos.audit.AuditService;
import com.hospitos.billing.api.LineCategory;
import com.hospitos.billing.model.TariffItem;
import com.hospitos.billing.model.TaxRate;
import com.hospitos.common.ApiException;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** The hospital's price list, plus doctor consultations priced from each doctor's fee. */
@Service
public class TariffService {
  public static final String DOCTOR_PREFIX = "DOC-";
  private final JdbcClient db;
  private final SettingsService settings;
  private final AuditService audit;
  public TariffService(JdbcClient db, SettingsService settings, AuditService audit) { this.db = db; this.settings = settings; this.audit = audit; }

  public record TariffInput(String code, String name, LineCategory category, BigDecimal price, BigDecimal taxPct,
      String hsnSac, String department, Boolean active, Integer version) {}

  private TariffItem map(ResultSet r, Map<LineCategory, TaxRate> rates) throws SQLException {
    var cat = LineCategory.valueOf(r.getString("category"));
    BigDecimal tax = r.getBigDecimal("tax_pct");
    TaxRate rate = rates.get(cat);
    return new TariffItem(r.getString("id"), r.getString("code"), r.getString("name"), cat, r.getBigDecimal("price"), tax,
        tax != null ? tax : rate != null ? rate.gstPct() : BigDecimal.ZERO,
        r.getString("hsn_sac") != null ? r.getString("hsn_sac") : rate != null ? rate.hsnSac() : null,
        r.getString("department"), r.getBoolean("active"), r.getBoolean("from_doctor"), (Integer) r.getObject("version"));
  }

  private static final String UNION = """
      select id::text as id, code, name, category, price, tax_pct, hsn_sac, department, active, false as from_doctor, version
        from billing_tariff_items
      union all
      select d.id, 'DOC-' || d.id, 'Consultation, ' || dp.name || ' (' || d.name || ')', 'CONSULTATION', d.fee, null, null,
             dp.name, d.active, true, null
        from doctor d join department dp on dp.id = d.dept_id
      """;

  public List<TariffItem> search(String q, boolean includeInactive, String category) {
    var rates = settings.taxRateMap();
    String like = q == null || q.isBlank() ? null : "%" + q.trim().toLowerCase() + "%";
    return db.sql("select * from (" + UNION + ") t where (:all or active) and (cast(:like as text) is null or lower(name) like :like or lower(code) like :like) " +
            "and (cast(:cat as text) is null or category = :cat) order by from_doctor desc, category, name limit 500")
        .param("all", includeInactive).param("like", like).param("cat", category)
        .query((r, i) -> map(r, rates)).list();
  }

  public Optional<TariffItem> byCode(String code) {
    var rates = settings.taxRateMap();
    return db.sql("select * from (" + UNION + ") t where code = ?").param(code.trim().toUpperCase())
        .query((r, i) -> map(r, rates)).optional();
  }

  @Transactional
  public TariffItem create(TariffInput in) {
    String code = code(in);
    UUID id;
    try {
      id = db.sql("""
          insert into billing_tariff_items (code, name, category, price, tax_pct, hsn_sac, department, active)
          values (?, ?, ?, ?, ?, ?, ?, ?) returning id""")
          .params(code, in.name().trim(), in.category().name(), in.price(), in.taxPct(), in.hsnSac(), in.department(),
              in.active() == null || in.active()).query(UUID.class).single();
    } catch (DuplicateKeyException e) {
      throw new ApiException(409, "Tariff code " + code + " already exists");
    }
    audit.log("Created", "Tariff", code, in.name().trim() + " Rs " + in.price().toPlainString());
    return byCode(code).orElseThrow();
  }

  @Transactional
  public TariffItem update(UUID id, TariffInput in) {
    if (in.version() == null) throw new ApiException(400, "version is required");
    String code = code(in);
    BigDecimal old = db.sql("select price from billing_tariff_items where id = ?").param(id).query(BigDecimal.class)
        .optional().orElseThrow(() -> new ApiException(404, "Tariff item not found"));
    int n;
    try {
      n = db.sql("""
          update billing_tariff_items set code = ?, name = ?, category = ?, price = ?, tax_pct = ?, hsn_sac = ?, department = ?,
            active = coalesce(?, active), version = version + 1, updated_at = now()
          where id = ? and version = ?""")
          .params(code, in.name().trim(), in.category().name(), in.price(), in.taxPct(), in.hsnSac(), in.department(),
              in.active(), id, in.version()).update();
    } catch (DuplicateKeyException e) {
      throw new ApiException(409, "Tariff code " + code + " already exists");
    }
    if (n == 0) throw new ApiException(409, "Someone else changed this tariff item. Reload and try again");
    audit.log("Updated", "Tariff", code, "price " + old.toPlainString() + " -> " + in.price().toPlainString());
    return byCode(code).orElseThrow();
  }

  private static String code(TariffInput in) {
    String c = in.code().trim().toUpperCase();
    if (c.startsWith(DOCTOR_PREFIX)) throw new ApiException(422, "Codes starting with DOC- are reserved for doctor consultations");
    return c;
  }

}
