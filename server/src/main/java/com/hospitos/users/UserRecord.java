package com.hospitos.users;

import com.fasterxml.jackson.annotation.JsonIgnore;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public record UserRecord(UUID id, String email, String name, String role, List<String> branches,
                         @JsonIgnore String passwordHash, String status, boolean mustChangePw,
                         @JsonIgnore int failedLogins, @JsonIgnore OffsetDateTime lockedUntil,
                         OffsetDateTime lastLogin, OffsetDateTime createdAt,
                         @JsonIgnore int tokenVersion) {}
