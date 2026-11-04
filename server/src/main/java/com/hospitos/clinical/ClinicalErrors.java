package com.hospitos.clinical;

import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** 422 problem detail that lists the blocking alerts in "alerts", so the screen can show them. */
@RestControllerAdvice
@Order(Ordered.HIGHEST_PRECEDENCE)
public class ClinicalErrors {
  @ExceptionHandler(SafetyBlockedException.class)
  ProblemDetail blocked(SafetyBlockedException e) {
    var p = ProblemDetail.forStatusAndDetail(HttpStatus.UNPROCESSABLE_ENTITY, e.getMessage());
    p.setProperty("alerts", e.alerts());
    return p;
  }
}
