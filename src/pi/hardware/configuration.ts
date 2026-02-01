/**
 * Raspberry Pi Hardware Configuration
 * 
 * Provides utilities for configuring Raspberry Pi hardware based on detected specifications.
 */

import type { PiConfiguration, ThermalPolicy, GPIOConfiguration } from '../types/index.js';

/**
 * Creates a default thermal policy based on Pi configuration
 */
export function createDefaultThermalPolicy(config: PiConfiguration): ThermalPolicy {
  return {
    monitoring: {
      interval: 5, // Monitor every 5 seconds
      source: '/sys/class/thermal/thermal_zone0/temp',
    },
    thresholds: [
      {
        temperature: 70,
        action: 'reduce_25',
        recovery: 65,
      },
      {
        temperature: 75,
        action: 'reduce_50',
        recovery: 70,
      },
      {
        temperature: 80,
        action: 'pause_services',
        recovery: 75,
      },
    ],
    fanControl: config.thermal.fanPin ? {
      pin: config.thermal.fanPin,
      pwmFrequency: 1000, // 1kHz PWM frequency
    } : undefined,
  };
}

/**
 * Creates a default GPIO configuration based on Pi configuration
 */
export function createDefaultGPIOConfiguration(config: PiConfiguration): GPIOConfiguration {
  const pins: GPIOConfiguration['pins'] = {};
  
  // Configure available pins as inputs by default
  config.gpio.available.forEach(pin => {
    pins[pin] = {
      mode: 'input',
      pullup: false,
      description: `GPIO ${pin}`,
    };
  });
  
  return {
    pins,
    protocols: {
      i2c: {
        enabled: false,
        frequency: 100000, // 100kHz default
      },
      spi: {
        enabled: false,
        speed: 1000000, // 1MHz default
      },
      uart: {
        enabled: false,
        baudRate: 115200,
      },
    },
  };
}

/**
 * Validates Pi configuration for consistency and safety
 */
export function validatePiConfiguration(config: PiConfiguration): string[] {
  const errors: string[] = [];
  
  // Validate memory limits
  if (config.memory.limit > config.memory.total) {
    errors.push('Memory limit cannot exceed total memory');
  }
  
  if (config.memory.limit < 256) {
    errors.push('Memory limit should be at least 256MB for stable operation');
  }
  
  // Validate thermal thresholds
  if (config.thermal.thresholds.length === 0) {
    errors.push('At least one thermal threshold must be configured');
  }
  
  const sortedThresholds = [...config.thermal.thresholds].toSorted((a, b) => a - b);
  if (JSON.stringify(sortedThresholds) !== JSON.stringify(config.thermal.thresholds)) {
    errors.push('Thermal thresholds must be in ascending order');
  }
  
  // Validate GPIO configuration
  const reservedPins = new Set(config.gpio.reserved);
  const conflictingPins = config.gpio.available.filter(pin => reservedPins.has(pin));
  if (conflictingPins.length > 0) {
    errors.push(`GPIO pins ${conflictingPins.join(', ')} are both available and reserved`);
  }
  
  return errors;
}

/**
 * Optimizes configuration based on detected hardware capabilities
 */
export function optimizeConfigurationForHardware(config: PiConfiguration): PiConfiguration {
  const optimized = { ...config };
  
  // Optimize memory limits based on model
  if (config.model === 'Pi 5' && config.memory.total >= 8192) {
    // Pi 5 with 8GB can handle higher limits
    optimized.memory.limit = Math.min(4096, config.memory.total * 0.5);
  } else if (config.model === 'Pi Zero') {
    // Pi Zero needs more conservative limits
    optimized.memory.limit = Math.min(256, config.memory.total * 0.4);
  }
  
  // Enable wear leveling for SD card storage
  if (config.storage.type === 'sd') {
    optimized.storage.wearLeveling = true;
  }
  
  // Adjust thermal thresholds for different models
  if (config.model === 'Pi 5') {
    // Pi 5 can handle slightly higher temperatures
    optimized.thermal.thresholds = [75, 80, 85];
  } else if (config.model === 'Pi Zero') {
    // Pi Zero needs more aggressive thermal management
    optimized.thermal.thresholds = [65, 70, 75];
  }
  
  return optimized;
}