/**
 * Hardware Configuration Tests
 * 
 * Property-based tests for Raspberry Pi hardware configuration utilities.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { 
  createDefaultThermalPolicy,
  createDefaultGPIOConfiguration,
  validatePiConfiguration,
  optimizeConfigurationForHardware
} from './configuration.js';
import { piConfigurationArbitrary, temperatureArbitrary } from './detection.test.js';
import type { PiConfiguration } from '../types/index.js';

describe('Pi Hardware Configuration', () => {
  describe('createDefaultThermalPolicy', () => {
    it('should create valid thermal policies for any Pi configuration', () => {
      fc.assert(fc.property(
        piConfigurationArbitrary,
        (config) => {
          const policy = createDefaultThermalPolicy(config);
          
          // Property: Should have monitoring configuration
          expect(policy.monitoring).toBeDefined();
          expect(policy.monitoring.interval).toBeGreaterThan(0);
          expect(typeof policy.monitoring.source).toBe('string');
          expect(policy.monitoring.source.length).toBeGreaterThan(0);
          
          // Property: Should have at least one threshold
          expect(Array.isArray(policy.thresholds)).toBe(true);
          expect(policy.thresholds.length).toBeGreaterThan(0);
          
          // Property: Thresholds should be in ascending order
          for (let i = 1; i < policy.thresholds.length; i++) {
            expect(policy.thresholds[i].temperature)
              .toBeGreaterThan(policy.thresholds[i - 1].temperature);
          }
          
          // Property: Recovery temperatures should be lower than trigger temperatures
          policy.thresholds.forEach(threshold => {
            expect(threshold.recovery).toBeLessThan(threshold.temperature);
          });
          
          // Property: Fan control should match config
          if (config.thermal.fanPin !== undefined) {
            expect(policy.fanControl).toBeDefined();
            expect(policy.fanControl?.pin).toBe(config.thermal.fanPin);
            expect(policy.fanControl?.pwmFrequency).toBeGreaterThan(0);
          }
        }
      ));
    });
  });

  describe('createDefaultGPIOConfiguration', () => {
    it('should create valid GPIO configurations for any Pi configuration', () => {
      fc.assert(fc.property(
        piConfigurationArbitrary,
        (config) => {
          const gpioConfig = createDefaultGPIOConfiguration(config);
          
          // Property: Should configure all available pins
          config.gpio.available.forEach(pin => {
            expect(gpioConfig.pins[pin]).toBeDefined();
            expect(gpioConfig.pins[pin].mode).toBe('input'); // Default mode
          });
          
          // Property: Should not configure reserved pins
          config.gpio.reserved.forEach(pin => {
            expect(gpioConfig.pins[pin]).toBeUndefined();
          });
          
          // Property: Should have protocol configurations
          expect(gpioConfig.protocols.i2c).toBeDefined();
          expect(gpioConfig.protocols.spi).toBeDefined();
          expect(gpioConfig.protocols.uart).toBeDefined();
          
          // Property: Protocol frequencies should be positive
          expect(gpioConfig.protocols.i2c?.frequency).toBeGreaterThan(0);
          expect(gpioConfig.protocols.spi?.speed).toBeGreaterThan(0);
          expect(gpioConfig.protocols.uart?.baudRate).toBeGreaterThan(0);
        }
      ));
    });
  });

  describe('validatePiConfiguration', () => {
    it('should validate memory limits correctly', () => {
      fc.assert(fc.property(
        fc.record({
          model: fc.constantFrom('Pi 4B', 'Pi 5'),
          architecture: fc.constantFrom('arm64', 'armv7l'),
          memory: fc.record({
            total: fc.integer({ min: 512, max: 8192 }),
            limit: fc.integer({ min: 100, max: 10000 }) // Intentionally allow invalid values
          }),
          thermal: fc.record({
            thresholds: fc.array(temperatureArbitrary, { minLength: 0, maxLength: 5 }),
            fanPin: fc.option(fc.integer({ min: 0, max: 31 }))
          }),
          storage: fc.record({
            type: fc.constantFrom('sd', 'usb', 'ssd'),
            wearLeveling: fc.boolean()
          }),
          gpio: fc.record({
            available: fc.array(fc.integer({ min: 0, max: 31 }), { minLength: 1, maxLength: 30 }),
            reserved: fc.array(fc.integer({ min: 0, max: 31 }), { minLength: 0, maxLength: 10 })
          })
        }),
        (config) => {
          const errors = validatePiConfiguration(config);
          
          // Property: Should detect memory limit exceeding total
          if (config.memory.limit > config.memory.total) {
            expect(errors.some(error => error.includes('Memory limit cannot exceed total memory'))).toBe(true);
          }
          
          // Property: Should detect insufficient memory limit
          if (config.memory.limit < 256) {
            expect(errors.some(error => error.includes('Memory limit should be at least 256MB'))).toBe(true);
          }
          
          // Property: Should detect missing thermal thresholds
          if (config.thermal.thresholds.length === 0) {
            expect(errors.some(error => error.includes('At least one thermal threshold must be configured'))).toBe(true);
          }
          
          // Property: Should detect conflicting GPIO pins
          const reservedSet = new Set(config.gpio.reserved);
          const hasConflicts = config.gpio.available.some(pin => reservedSet.has(pin));
          if (hasConflicts) {
            expect(errors.some(error => error.includes('are both available and reserved'))).toBe(true);
          }
        }
      ));
    });

    it('should return no errors for valid configurations', () => {
      fc.assert(fc.property(
        piConfigurationArbitrary.filter(config => {
          // Only test with valid configurations
          return config.memory.limit <= config.memory.total &&
                 config.memory.limit >= 256 &&
                 config.thermal.thresholds.length > 0 &&
                 !config.gpio.available.some(pin => config.gpio.reserved.includes(pin));
        }),
        (config) => {
          const errors = validatePiConfiguration(config);
          expect(errors).toHaveLength(0);
        }
      ));
    });
  });

  describe('optimizeConfigurationForHardware', () => {
    it('should preserve essential configuration properties', () => {
      fc.assert(fc.property(
        piConfigurationArbitrary,
        (config) => {
          const optimized = optimizeConfigurationForHardware(config);
          
          // Property: Should preserve model and architecture
          expect(optimized.model).toBe(config.model);
          expect(optimized.architecture).toBe(config.architecture);
          
          // Property: Should preserve total memory
          expect(optimized.memory.total).toBe(config.memory.total);
          
          // Property: Should preserve GPIO pin arrays
          expect(optimized.gpio.available).toEqual(config.gpio.available);
          expect(optimized.gpio.reserved).toEqual(config.gpio.reserved);
          
          // Property: Memory limit should still be valid
          expect(optimized.memory.limit).toBeLessThanOrEqual(optimized.memory.total);
          expect(optimized.memory.limit).toBeGreaterThan(0);
        }
      ));
    });

    it('should apply model-specific optimizations', () => {
      // Test Pi 5 optimizations
      const pi5Config: PiConfiguration = {
        model: 'Pi 5',
        architecture: 'arm64',
        memory: { total: 8192, limit: 2048 },
        thermal: { thresholds: [70, 75, 80] },
        storage: { type: 'sd', wearLeveling: false },
        gpio: { available: [2, 3, 4], reserved: [0, 1] }
      };
      
      const optimizedPi5 = optimizeConfigurationForHardware(pi5Config);
      
      // Property: Pi 5 should get higher memory limits
      expect(optimizedPi5.memory.limit).toBeGreaterThan(pi5Config.memory.limit);
      
      // Property: Pi 5 should get higher thermal thresholds
      expect(optimizedPi5.thermal.thresholds[0]).toBeGreaterThan(70);
      
      // Test Pi Zero optimizations
      const piZeroConfig: PiConfiguration = {
        model: 'Pi Zero',
        architecture: 'armv6l',
        memory: { total: 512, limit: 256 },
        thermal: { thresholds: [70, 75, 80] },
        storage: { type: 'sd', wearLeveling: false },
        gpio: { available: [2, 3, 4], reserved: [0, 1] }
      };
      
      const optimizedZero = optimizeConfigurationForHardware(piZeroConfig);
      
      // Property: Pi Zero should get lower thermal thresholds
      expect(optimizedZero.thermal.thresholds[0]).toBeLessThan(70);
      
      // Property: SD card storage should enable wear leveling
      if (optimizedZero.storage.type === 'sd') {
        expect(optimizedZero.storage.wearLeveling).toBe(true);
      }
    });
  });
});

/**
 * Property-Based Test for Configuration Consistency
 * 
 * This test ensures that any configuration that passes validation
 * should also work correctly with other configuration functions.
 */
describe('Configuration Consistency Properties', () => {
  it('should maintain consistency across all configuration functions', () => {
    fc.assert(fc.property(
      piConfigurationArbitrary.filter(config => {
        // Only use valid configurations
        const errors = validatePiConfiguration(config);
        return errors.length === 0;
      }),
      (config) => {
        // Property: Valid configs should work with all functions
        const thermalPolicy = createDefaultThermalPolicy(config);
        const gpioConfig = createDefaultGPIOConfiguration(config);
        const optimized = optimizeConfigurationForHardware(config);
        
        // All functions should complete without throwing
        expect(thermalPolicy).toBeDefined();
        expect(gpioConfig).toBeDefined();
        expect(optimized).toBeDefined();
        
        // Optimized config should still be valid
        const optimizedErrors = validatePiConfiguration(optimized);
        expect(optimizedErrors).toHaveLength(0);
      }
    ));
  });
});