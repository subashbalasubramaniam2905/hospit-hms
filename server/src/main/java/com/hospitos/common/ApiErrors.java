package com.hospitos.common;

import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.lang.NonNull;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

/**
 * All errors are RFC 7807 problem details with a human-readable "detail".
 * Database and other internal error text is logged, never sent to the client.
 */
@RestControllerAdvice
public class ApiErrors extends ResponseEntityExceptionHandler {
  private static final Logger log = LoggerFactory.getLogger(ApiErrors.class);

  @ExceptionHandler(ApiException.class)
  ProblemDetail api(ApiException e) {
    return ProblemDetail.forStatusAndDetail(HttpStatus.valueOf(e.status()), e.getMessage());
  }

  @ExceptionHandler(AccessDeniedException.class)
  ProblemDetail denied(AccessDeniedException e) {
    return ProblemDetail.forStatusAndDetail(HttpStatus.FORBIDDEN, "Your role does not allow this action");
  }

  @ExceptionHandler(DataIntegrityViolationException.class)
  ProblemDetail integrity(DataIntegrityViolationException e) {
    log.warn("Data integrity violation: {}", e.getMostSpecificCause().getMessage());
    return ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, "This conflicts with existing data or refers to something that does not exist");
  }

  @ExceptionHandler(Exception.class)
  ProblemDetail unexpected(Exception e) {
    log.error("Unhandled error", e);
    return ProblemDetail.forStatusAndDetail(HttpStatus.INTERNAL_SERVER_ERROR, "Something went wrong. Please try again");
  }

  @Override
  protected ResponseEntity<Object> handleMethodArgumentNotValid(@NonNull MethodArgumentNotValidException e, @NonNull HttpHeaders headers,
                                                                @NonNull HttpStatusCode status, @NonNull WebRequest request) {
    var p = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, "Some fields need attention");
    p.setProperty("fields", e.getBindingResult().getFieldErrors().stream()
        .collect(Collectors.toMap(f -> f.getField(), f -> String.valueOf(f.getDefaultMessage()), (a, b) -> a)));
    return ResponseEntity.badRequest().body(p);
  }
}
