package com.hospitos.clinical;

import com.hospitos.common.ApiException;
import com.hospitos.common.CurrentUser;
import java.sql.Array;
import java.sql.SQLException;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

/** Reads the patient and doctor facts the clinical module needs, and enforces who may act for which doctor. */
@Component
public class ClinicalLookup {
  public record PatientFacts(String id, String name, String branchId, List<String> allergies, String history,
                             String familyHistory, String medications, List<String> conditions) {}
  public record DoctorFacts(String id, String name, String branchId, UUID userId) {}

  public static final String CLINICAL_READERS =
      "hasAnyRole('super-admin','admin','doctor','nurse','pharmacist','lab-tech','radiologist','billing')";
  public static final String CLINICIANS = "hasAnyRole('super-admin','admin','doctor')";
  public static final String VITALS_WRITERS = "hasAnyRole('super-admin','admin','doctor','nurse')";

  private final JdbcClient db;
  public ClinicalLookup(JdbcClient db) { this.db = db; }

  public PatientFacts patient(String id) {
    return db.sql("select id, name, branch_id, allergies, history, family_history, medications, conditions from patient where id = ?")
        .param(id)
        .query((r, i) -> new PatientFacts(r.getString(1), r.getString(2), r.getString(3), arr(r.getArray(4)), r.getString(5),
            r.getString(6), r.getString(7), arr(r.getArray(8))))
        .optional().orElseThrow(() -> new ApiException(404, "Patient not found"));
  }

  public DoctorFacts doctor(String id) {
    return db.sql("select id, name, branch_id, user_id from doctor where id = ?").param(id)
        .query((r, i) -> new DoctorFacts(r.getString(1), r.getString(2), r.getString(3), r.getObject(4, UUID.class)))
        .optional().orElseThrow(() -> new ApiException(404, "Doctor not found"));
  }

  /**
   * The doctor a clinical record is written for. The user must see the doctor's branch, and a doctor account
   * that is linked to a doctor profile may only write as that doctor.
   */
  public DoctorFacts actingDoctor(String doctorId) {
    var me = CurrentUser.get();
    var d = doctor(doctorId);
    if (!me.canSee(d.branchId())) throw new ApiException(403, "You cannot work in this doctor's branch");
    if ("doctor".equals(me.role())) {
      var mine = db.sql("select id from doctor where user_id = ?").param(me.id()).query(String.class).optional();
      if (mine.isPresent() && !mine.get().equals(d.id())) throw new ApiException(403, "You can only write records as yourself");
    }
    return d;
  }

  private static List<String> arr(Array a) throws SQLException {
    return a == null ? List.of() : Arrays.asList((String[]) a.getArray());
  }
}
