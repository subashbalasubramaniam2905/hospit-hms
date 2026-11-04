package com.hospitos.appointments;

import com.hospitos.common.ApiException;

/** Shorthands for the module's errors. Messages are written for front-desk staff. */
final class Errors {
    private Errors() {}

    static ApiException notFound(String what) { return new ApiException(404, what + " not found."); }

    static ApiException conflict(String reason) { return new ApiException(409, reason); }

    static ApiException bad(String reason) { return new ApiException(400, reason); }
}
