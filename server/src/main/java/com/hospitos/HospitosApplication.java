package com.hospitos;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@SpringBootApplication
@ConfigurationPropertiesScan
public class HospitosApplication {
  public static void main(String[] args) {
    SpringApplication.run(HospitosApplication.class, args);
  }
}
