package com.hospitos.pharmacy;

import com.hospitos.audit.AuditService;
import com.hospitos.common.ApiException;
import com.hospitos.common.CurrentUser;
import com.hospitos.pharmacy.PharmacyDtos.AdjustInput;
import com.hospitos.pharmacy.PharmacyDtos.FefoPick;
import com.hospitos.pharmacy.PharmacyDtos.Medicine;
import com.hospitos.pharmacy.PharmacyDtos.ReceiveInput;
import com.hospitos.pharmacy.PharmacyDtos.TransferInput;
import java.time.LocalDate;
import java.util.List;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Receipts, adjustments, returns and branch transfers. Every change writes a stock movement and an audit entry. */
@Service
public class StockService {
  private final PharmacyRepository repo;
  private final AuditService audit;
  private final JdbcClient db;
  public StockService(PharmacyRepository repo, AuditService audit, JdbcClient db) { this.repo = repo; this.audit = audit; this.db = db; }

  /** The branch a request works in: the one asked for, else the user's first branch. */
  static String branch(CurrentUser me, String requested) {
    String b = requested != null && !requested.isBlank() ? requested.trim()
        : me.branches().isEmpty() ? "BR1" : me.branches().get(0);
    if (!me.canSee(b)) throw new ApiException(403, "You do not have access to this branch");
    return b;
  }

  private boolean branchExists(String id) {
    return db.sql("select count(*) from branch where id = ? and active").param(id).query(Integer.class).single() > 0;
  }

  @Transactional
  public Medicine receive(String medicineId, ReceiveInput in) {
    var me = CurrentUser.get();
    String br = branch(me, in.branchId());
    var m = repo.medicine(medicineId).orElseThrow(() -> new ApiException(404, "Medicine not found"));
    if (!in.expiry().isAfter(LocalDate.now())) throw new ApiException(422, "This batch has already expired");
    if (in.supplierId() != null && !in.supplierId().isBlank() && !repo.supplierExists(in.supplierId()))
      throw new ApiException(400, "Unknown supplier");
    String batch = in.batch().trim().toUpperCase();
    repo.findBatch(medicineId, br, batch).ifPresent(b -> {
      if (!b.expiry().equals(in.expiry())) throw new ApiException(422, "Batch " + batch + " is already in stock with a different expiry");
    });
    var id = repo.addToBatch(medicineId, br, batch, in.expiry(), in.qty(),
        in.supplierId() == null || in.supplierId().isBlank() ? null : in.supplierId(), in.cost());
    repo.move(br, medicineId, id, batch, "Receipt", in.qty(), in.ref(), null, me.id(), me.name());
    audit.logForBranch(br, "Received", "Stock", medicineId, m.label() + " batch " + batch + " +" + in.qty() + " at " + br);
    return repo.get(medicineId, br).orElseThrow();
  }

  @Transactional
  public Medicine adjust(AdjustInput in) {
    var me = CurrentUser.get();
    var b = repo.lockBatch(in.batchId()).orElseThrow(() -> new ApiException(404, "Batch not found"));
    if (!me.canSee(b.branchId())) throw new ApiException(404, "Batch not found");
    boolean ret = Boolean.TRUE.equals(in.returnToSupplier());
    if (in.delta() == 0) throw new ApiException(400, "Enter a quantity to add or remove");
    if (ret && in.delta() > 0) throw new ApiException(400, "A return to the supplier must remove stock");
    int next = b.qty() + in.delta();
    if (next < 0) throw new ApiException(422, "Only " + b.qty() + " units are left in batch " + b.batch());
    repo.setQty(b.id(), next);
    var m = repo.medicine(b.medicineId()).orElseThrow();
    repo.move(b.branchId(), b.medicineId(), b.id(), b.batch(), ret ? "Return" : "Adjustment", in.delta(), ret ? "RETURN" : "ADJ",
        in.note().trim(), me.id(), me.name());
    audit.logForBranch(b.branchId(), ret ? "Returned" : "Changed", "Stock", b.medicineId(),
        m.label() + " " + b.batch() + " " + (in.delta() > 0 ? "+" : "") + in.delta() + ": " + in.note().trim());
    return repo.get(b.medicineId(), b.branchId()).orElseThrow();
  }

  /** Moves stock first-expiry-first-out from one branch to another, keeping batch numbers and expiry dates. */
  @Transactional
  public Medicine transfer(TransferInput in) {
    var me = CurrentUser.get();
    String from = branch(me, in.fromBranchId());
    String to = in.toBranchId().trim();
    if (from.equals(to)) throw new ApiException(400, "Choose a different branch to transfer to");
    if (!branchExists(to)) throw new ApiException(400, "Unknown branch " + to);
    var m = repo.medicine(in.medicineId()).orElseThrow(() -> new ApiException(404, "Medicine not found"));
    var batches = repo.lockUsable(m.id(), from);
    List<FefoPick> plan = PharmacyRepository.pick(batches, in.qty());
    int got = plan.stream().mapToInt(FefoPick::take).sum();
    if (got < in.qty()) throw new ApiException(422, "Only " + got + " usable units of " + m.label() + " are in stock");
    String ref = "TR-" + from + "-" + to;
    for (var p : plan) {
      var src = batches.stream().filter(b -> b.id().equals(p.batchId())).findFirst().orElseThrow();
      repo.take(p.batchId(), p.take());
      repo.move(from, m.id(), p.batchId(), p.batch(), "Transfer", -p.take(), ref, "To " + to, me.id(), me.name());
      repo.findBatch(m.id(), to, p.batch()).ifPresent(t -> {
        if (!t.expiry().equals(p.expiry())) throw new ApiException(422, "Batch " + p.batch() + " has a different expiry at " + to);
      });
      var dest = repo.addToBatch(m.id(), to, p.batch(), p.expiry(), p.take(), src.supplierId(), src.cost());
      repo.move(to, m.id(), dest, p.batch(), "Transfer", p.take(), ref, "From " + from, me.id(), me.name());
    }
    audit.logForBranch(from, "Transferred", "Stock", m.id(), m.label() + " x" + got + " from " + from + " to " + to + " ("
        + plan.stream().map(p -> p.batch() + "x" + p.take()).collect(Collectors.joining(", ")) + ")");
    return repo.get(m.id(), from).orElseThrow();
  }
}
