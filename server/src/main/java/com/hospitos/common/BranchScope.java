package com.hospitos.common;

/** Picks the branch a request works in and checks the user may use it. */
public final class BranchScope {
  private BranchScope() {}

  /** The branch asked for, else the user's first branch (BR1 for a super administrator with none). */
  public static String pick(String requested) {
    var me = CurrentUser.get();
    String b = requested != null && !requested.isBlank() ? requested.trim() : me.branches().isEmpty() ? "BR1" : me.branches().get(0);
    if (!me.canSee(b)) throw new ApiException(403, "You do not have access to this branch");
    return b;
  }

  /** 404 rather than 403 for a record in another branch, so ids from other branches are not confirmed. */
  public static void check(String branchId, String what) {
    if (!CurrentUser.get().canSee(branchId)) throw new ApiException(404, what + " not found");
  }
}
