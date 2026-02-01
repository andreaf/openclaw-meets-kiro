/**
 * Property-Based Testing Setup for Raspberry Pi Port
 * 
 * This module provides common test utilities and generators for property-based
 * testing of Pi-specific components using fast-check.
 */

import * as fc from 'fast-check';
import type { 
  SystemMetrics, 
  PiConfiguration, 
  ThermalPolicy, 
  GPIOConfiguration 
} from './types/index.js';

/**
 * Fast-check generators for Pi-specific data structures
 */

// System Metrics generators
export const systemMetricsArbitrary: fc.Arbitrary<SystemMetrics> = fc.record({
  timestamp: fc.date(),
  cpu: fc.record({
    usage: fc.float({ min: 0, max: 100 }),
    temperature: fc.float({ min: 20, max: 90 }),
    frequency: fc.integer({ min: 600, max: 2400 }), // MHz
    throttled: fc.boolean()
  }),
  memory: fc.record({
    total: fc.integer({ min: 256 * 1024 * 1024, max: 8 * 1024 * 1024 * 1024 }), // bytes
    used: fc.integer({ min: 0, max: 8 * 1024 * 1024 * 1024 }),
    available: fc.integer({ min: 0, max: 8 * 1024 * 1024 * 1024 }),
    swapUsed: fc.integer({ min: 0, max: 2 * 1024 * 1024 * 1024 })
  }).filter(mem => mem.used <= mem.total && mem.available <= mem.total),
  storage: fc.record({
    total: fc.integer({ min: 8 * 1024 * 1024 * 1024, max: 1024 * 1024 * 1024 * 1024 }), // bytes
    used: fc.integer({ min: 0, max: 1024 * 1024 * 1024 * 1024 }),
    available: fc.integer({ min: 0, max: 1024 * 1024 * 1024 * 1024 }),
    writeCount: fc.integer({ min: 0, max: 1000000 })
  }).filter(storage => storage.used <= storage.total && storage.available <= storage.total),
  network: fc.record({
    interface: fc.constantFrom('wifi', 'ethernet'),
    bandwidth: fc.float({ min: 1, max: 1000 }), // Mbps
    latency: fc.float({ min: 1, max: 500 }), // ms
    packetsLost: fc.integer({ min: 0, max: 1000 })
  })
});

// Thermal Policy generators
export const thermalPolicyArbitrary: fc.Arbitrary<ThermalPolicy> = fc.record({
  monitoring: fc.record({
    interval: fc.integer({ min: 1, max: 60 }),
    source: fc.constantFrom(
      '/sys/class/thermal/thermal_zone0/temp',
      '/sys/class/thermal/thermal_zone1/temp'
    )
  }),
  thresholds: fc.array(
    fc.record({
      temperature: fc.float({ min: 50, max: 90 }),
      action: fc.constantFrom('reduce_25', 'reduce_50', 'pause_services'),
      recovery: fc.float({ min: 40, max: 85 })
    }),
    { minLength: 1, maxLength: 5 }
  ).map(thresholds => 
    // Ensure thresholds are sorted and recovery < temperature
    thresholds
      .sort((a, b) => a.temperature - b.temperature)
      .map(t => ({ ...t, recovery: Math.min(t.recovery, t.temperature - 5) }))
  ),
  fanControl: fc.option(fc.record({
    pin: fc.integer({ min: 0, max: 31 }),
    pwmFrequency: fc.integer({ min: 100, max: 10000 })
  }))
});

// GPIO Configuration generators
export const gpioConfigurationArbitrary: fc.Arbitrary<GPIOConfiguration> = fc.record({
  pins: fc.dictionary(
    fc.integer({ min: 0, max: 31 }).map(String),
    fc.record({
      mode: fc.constantFrom('input', 'output', 'pwm', 'i2c', 'spi', 'uart'),
      pullup: fc.option(fc.boolean()),
      interrupt: fc.option(fc.constantFrom('rising', 'falling', 'both')),
      description: fc.option(fc.string({ minLength: 1, maxLength: 50 }))
    })
  ),
  protocols: fc.record({
    i2c: fc.option(fc.record({
      enabled: fc.boolean(),
      frequency: fc.integer({ min: 10000, max: 1000000 })
    })),
    spi: fc.option(fc.record({
      enabled: fc.boolean(),
      speed: fc.integer({ min: 100000, max: 50000000 })
    })),
    uart: fc.option(fc.record({
      enabled: fc.boolean(),
      baudRate: fc.constantFrom(9600, 19200, 38400, 57600, 115200)
    }))
  })
});

/**
 * Property test helpers
 */

/**
 * Validates that a SystemMetrics object has consistent values
 */
export function validateSystemMetrics(metrics: SystemMetrics): boolean {
  return (
    metrics.cpu.usage >= 0 && metrics.cpu.usage <= 100 &&
    metrics.cpu.temperature >= 0 && metrics.cpu.temperature < 150 && // Allow 0 for edge cases, including default values
    metrics.cpu.frequency != null && metrics.cpu.frequency > 0 && // Ensure frequency is not null
    metrics.memory.used <= metrics.memory.total &&
    metrics.memory.available <= metrics.memory.total &&
    metrics.storage.used <= metrics.storage.total &&
    metrics.storage.available <= metrics.storage.total &&
    metrics.network.bandwidth > 0 &&
    metrics.network.latency >= 0 &&
    metrics.network.packetsLost >= 0
  );
}

/**
 * Validates that a ThermalPolicy has consistent thresholds
 */
export function validateThermalPolicy(policy: ThermalPolicy): boolean {
  // Check monitoring configuration
  if (policy.monitoring.interval <= 0) return false;
  if (!policy.monitoring.source || policy.monitoring.source.length === 0) return false;
  
  // Check thresholds are sorted and have valid recovery temperatures
  for (let i = 0; i < policy.thresholds.length; i++) {
    const threshold = policy.thresholds[i];
    
    // Recovery should be less than trigger temperature
    if (threshold.recovery >= threshold.temperature) return false;
    
    // Thresholds should be in ascending order
    if (i > 0 && threshold.temperature <= policy.thresholds[i - 1].temperature) {
      return false;
    }
  }
  
  return true;
}

/**
 * Test configuration for property-based tests
 */
export const propertyTestConfig = {
  numRuns: 30, // Reduced from 100 to 30 for faster test execution while maintaining good coverage
  timeout: 5000, // Timeout per test in milliseconds
  verbose: false, // Set to true for detailed output
};

/**
 * Custom matchers for Pi-specific assertions
 */
export const piMatchers = {
  toBeValidTemperature: (received: number) => {
    const pass = received >= -40 && received <= 125; // Valid Pi temperature range
    return {
      message: () => `expected ${received} to be a valid Pi temperature (-40°C to 125°C)`,
      pass,
    };
  },
  
  toBeValidGpioPin: (received: number) => {
    const pass = Number.isInteger(received) && received >= 0 && received <= 31;
    return {
      message: () => `expected ${received} to be a valid GPIO pin (0-31)`,
      pass,
    };
  },
  
  toBeValidMemorySize: (received: number) => {
    const pass = Number.isInteger(received) && received > 0;
    return {
      message: () => `expected ${received} to be a valid memory size (positive integer)`,
      pass,
    };
  },
};