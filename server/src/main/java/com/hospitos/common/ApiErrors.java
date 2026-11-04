package com.hospitos.common;

import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** All errors are RFC 7807 problem details; the human-readable message is in "detail". */
@RestControllerAdvice
public class ApiErrors {
  @ExceptionHandler(ApiException.class)
  ProblemDetail api(ApiException e) {
    return ProblemDetail.forStatusAndDetail(HttpStatus.valueOf(e.status()), e.getMessage());
  }

  @ExceptionHandler(AccessDeniedException.class)
  ProblemDetail denied(AccessDeniedException e) {
    return ProblemDetail.forStatusAndDetail(HttpStatus.FORBIDDEN, "Your role does not allow this action");
  }

  @ExceptionHandler(MethodArgumentNotValidException.class)
  ProblemDetail invalid(MethodArgumentNotValidException e) {
    var p = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, "Some fields need attention");
    p.setProperty("fields", e.getBindingResult().getFieldErrors().stream()
        .collect(Collectors.toMap(f -> f.getField(), f -> String.valueOf(f.getDefaultMessage()), (a, b) -> a)));
    return p;
  }
}
