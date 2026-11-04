package com.hospitos.billing.model;

public record InsuranceProvider(String id, String name, String tpa, String type, String phone, boolean cashless, boolean active) {}
