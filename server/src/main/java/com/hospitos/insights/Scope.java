package com.hospitos.insights;

import com.hospitos.common.ApiException;
import com.hospitos.common.CurrentUser;
import java.time.Clock;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import org.springframework.stereotype.Component;

/** Branch scope and clinic-day boundaries shared by the insight queries. */
@Component
public class Scope {
  /** SQL fragment: the row's branch is in :br (null means every branch). Pass the alias of the table. */
  public static String in(String alias) {
    return " (cast(:br as text[]) is null or " + alias + ".branch_id = any(cast(:br as text[]))) ";
  }

  private final Clock clock;
  public Scope(Clock clock) { this.clock = clock; }

  public LocalDate today() { return LocalDate.now(clock); }
  public OffsetDateTime startOf(LocalDate d) { return d.atStartOfDay(clock.getZone()).toOffsetDateTime(); }
  public OffsetDateTime now() { return OffsetDateTime.now(clock); }
  public String zone() { return clock.getZone().getId(); }

  /**
   * The branches a query covers: the requested branch (which the user must work in), else all of the user's branches.
   * Null means every branch (super administrators only).
   */
  public String[] branches(String requested) {
    var me = CurrentUser.get();
    if (requested != null && !requested.isBlank()) {
      if (!me.canSee(requested)) throw new ApiException(403, "You don't work in branch " + requested);
      return new String[] { requested };
    }
    if (me.superAdmin()) return null;
    if (me.branches().isEmpty()) throw new ApiException(403, "Your account isn't linked to a branch yet");
    return me.branches().toArray(String[]::new);
  }
}
