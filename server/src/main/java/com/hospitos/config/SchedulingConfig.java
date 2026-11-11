package com.hospitos.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/** Background jobs, such as the WhatsApp message dispatcher. */
@Configuration
@EnableScheduling
public class SchedulingConfig {}
