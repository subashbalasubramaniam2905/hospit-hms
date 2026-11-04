package com.hospitos.appointments;

import java.time.Clock;
import java.time.ZoneId;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Appointments run on clinic time. Override with HOSPITAL_TIMEZONE; tests replace the bean. */
@Configuration
class ClockConfig {
    @Bean
    @ConditionalOnMissingBean
    Clock clinicClock(@Value("${hospitos.timezone:Asia/Kolkata}") String zone) {
        return Clock.system(ZoneId.of(zone));
    }
}
