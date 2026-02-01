/**
 * Hardware Detection Tests
 * 
 * Property-based tests for Raspberry Pi hardware detection utilities.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { 
  detectPiHardware, 
  detectPiModel, 
  detectArchitecture, 
  detectMemoryConfiguration,
  getAvailableGpioPins,
  getReservedGpioPins 
} from './detection.js';

// Mock filesystem and process modules for testing
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn()
}));

vi.mock('node:child_process', () => ({
  execSync: vi.fn()
}));

describe('Pi Hardware Detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('detectPiModel', () => {
    it('should return a valid Pi model string', () => {
      fc.assert(fc.property(
        fc.constantFrom(
          'Raspberry Pi 5 Model B Rev 1.0',
          'Raspberry Pi 4 Model B Rev 1.4',
          'Raspberry Pi 3 Model B Plus Rev 1.3',
          'Raspberry Pi Zero W Rev 1.1'
        ),
        async (cpuInfoModel) => {
          // Mock the file system to return our test model
          const { existsSync, readFileSync } = await import('node:fs');
          vi.mocked(existsSync).mockReturnValue(true);
          vi.mocked(readFileSync).mockReturnValue(`Model\t\t: ${cpuInfoModel}\n`);
          
          const result = detectPiModel();
          
          // Property: Result should be a non-empty string
          expect(typeof result).toBe('string');
          expect(result.length).toBeGreaterThan(0);
          
          // Property: Known models should be normalized correctly
          if (cpuInfoModel.includes('Raspberry Pi 5')) {
            expect(result).toBe('Pi 5');
          } else if (cpuInfoModel.includes('Raspberry Pi 4')) {
            expect(result).toBe('Pi 4B');
          } else if (cpuInfoModel.includes('Raspberry Pi 3')) {
            expect(result).toBe('Pi 3B+');
          } else if (cpuInfoModel.includes('Raspberry Pi Zero')) {
            expect(result).toBe('Pi Zero');
          }
        }
      ));
    });

    it('should handle missing /proc/cpuinfo gracefully', async () => {
      const { existsSync } = await import('node:fs');
      vi.mocked(existsSync).mockReturnValue(false);
      
      const result = detectPiModel();
      expect(result).toBe('Unknown Pi Model');
    });
  });

  describe('detectArchitecture', () => {
    it('should normalize architecture names correctly', () => {
      fc.assert(fc.property(
        fc.constantFrom('aarch64', 'armv7l', 'armv6l', 'x86_64'),
        async (unameOutput) => {
          const { execSync } = await import('node:child_process');
          vi.mocked(execSync).mockReturnValue(unameOutput);
          
          const result = detectArchitecture();
          
          // Property: Result should be a non-empty string
          expect(typeof result).toBe('string');
          expect(result.length).toBeGreaterThan(0);
          
          // Property: Known architectures should be normalized
          if (unameOutput === 'aarch64') {
            expect(result).toBe('arm64');
          } else {
            expect(result).toBe(unameOutput);
          }
        }
      ));
    });
  });

  describe('detectMemoryConfiguration', () => {
    it('should set appropriate memory limits based on total RAM', () => {
      fc.assert(fc.property(
        fc.integer({ min: 512, max: 8192 }), // Memory in MB
        async (totalMemoryMB) => {
          // Mock /proc/meminfo
          const { existsSync, readFileSync } = await import('node:fs');
          vi.mocked(existsSync).mockReturnValue(true);
          vi.mocked(readFileSync).mockReturnValue(
            `MemTotal:        ${totalMemoryMB * 1024} kB\n`
          );
          
          const result = detectMemoryConfiguration();
          
          // Property: Total memory should match input
          expect(result.total).toBe(totalMemoryMB);
          
          // Property: Memory limit should follow the specified rules
          if (totalMemoryMB <= 1024) {
            expect(result.limit).toBe(512);
          } else if (totalMemoryMB <= 2048) {
            expect(result.limit).toBe(1024);
          } else {
            expect(result.limit).toBe(2048);
          }
          
          // Property: Limit should never exceed total memory
          expect(result.limit).toBeLessThanOrEqual(result.total);
          
          // Property: Limit should be positive
          expect(result.limit).toBeGreaterThan(0);
        }
      ));
    });
  });

  describe('getAvailableGpioPins', () => {
    it('should return valid GPIO pin arrays for different Pi models', () => {
      fc.assert(fc.property(
        fc.constantFrom('Pi 5', 'Pi 4B', 'Pi 3B+', 'Pi Zero'),
        (model) => {
          const pins = getAvailableGpioPins(model);
          
          // Property: Should return an array
          expect(Array.isArray(pins)).toBe(true);
          
          // Property: All pins should be valid GPIO numbers
          pins.forEach(pin => {
            expect(typeof pin).toBe('number');
            expect(pin).toBeGreaterThanOrEqual(0);
            expect(pin).toBeLessThan(32); // Pi GPIO pins are 0-31
          });
          
          // Property: Pins should be unique
          const uniquePins = [...new Set(pins)];
          expect(uniquePins.length).toBe(pins.length);
          
          // Property: Pi 5 should have more pins than other models
          if (model === 'Pi 5') {
            expect(pins.length).toBeGreaterThan(26);
          } else {
            expect(pins.length).toBeLessThanOrEqual(26);
          }
        }
      ));
    });
  });

  describe('getReservedGpioPins', () => {
    it('should return consistent reserved pins', () => {
      const pins1 = getReservedGpioPins();
      const pins2 = getReservedGpioPins();
      
      // Property: Should be deterministic
      expect(pins1).toEqual(pins2);
      
      // Property: Should return an array of numbers
      expect(Array.isArray(pins1)).toBe(true);
      pins1.forEach(pin => {
        expect(typeof pin).toBe('number');
        expect(pin).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('detectPiHardware', () => {
    it('should return a complete PiConfiguration object', async () => {
      // Mock all dependencies
      const { existsSync, readFileSync } = await import('node:fs');
      const { execSync } = await import('node:child_process');
      
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync)
        .mockReturnValueOnce('Model\t\t: Raspberry Pi 4 Model B Rev 1.4\n')
        .mockReturnValueOnce('MemTotal:        4194304 kB\n');
      vi.mocked(execSync).mockReturnValueOnce('aarch64').mockReturnValueOnce('/dev/mmcblk0p2');
      
      const config = detectPiHardware();
      
      // Property: Should have all required fields
      expect(config).toHaveProperty('model');
      expect(config).toHaveProperty('architecture');
      expect(config).toHaveProperty('memory');
      expect(config).toHaveProperty('thermal');
      expect(config).toHaveProperty('storage');
      expect(config).toHaveProperty('gpio');
      
      // Property: Memory configuration should be valid
      expect(config.memory.total).toBeGreaterThan(0);
      expect(config.memory.limit).toBeGreaterThan(0);
      expect(config.memory.limit).toBeLessThanOrEqual(config.memory.total);
      
      // Property: GPIO arrays should be valid
      expect(Array.isArray(config.gpio.available)).toBe(true);
      expect(Array.isArray(config.gpio.reserved)).toBe(true);
      
      // Property: Thermal thresholds should be configured
      expect(Array.isArray(config.thermal.thresholds)).toBe(true);
      expect(config.thermal.thresholds.length).toBeGreaterThan(0);
    });
  });
});

/**
 * Property-Based Test Generators
 * 
 * Custom generators for Pi-specific data structures
 */

// Generator for valid Pi model names
export const piModelArbitrary = fc.constantFrom(
  'Pi 5', 'Pi 4B', 'Pi 3B+', 'Pi Zero', 'Unknown Pi Model'
);

// Generator for valid architectures
export const architectureArbitrary = fc.constantFrom(
  'arm64', 'armv7l', 'armv6l', 'unknown'
);

// Generator for memory configurations
export const memoryConfigArbitrary = fc.record({
  total: fc.integer({ min: 256, max: 8192 }),
  limit: fc.integer({ min: 128, max: 4096 })
}).filter(config => config.limit <= config.total);

// Generator for GPIO pin numbers
export const gpioPinArbitrary = fc.integer({ min: 0, max: 31 });

// Generator for temperature values
export const temperatureArbitrary = fc.float({ min: -10, max: 100 });

// Generator for complete PiConfiguration objects
export const piConfigurationArbitrary = fc.record({
  model: piModelArbitrary,
  architecture: architectureArbitrary,
  memory: memoryConfigArbitrary,
  thermal: fc.record({
    thresholds: fc.array(temperatureArbitrary, { minLength: 1, maxLength: 5 }),
    fanPin: fc.option(gpioPinArbitrary)
  }),
  storage: fc.record({
    type: fc.constantFrom('sd', 'usb', 'ssd'),
    wearLeveling: fc.boolean()
  }),
  gpio: fc.record({
    available: fc.array(gpioPinArbitrary, { minLength: 1, maxLength: 30 }),
    reserved: fc.array(gpioPinArbitrary, { minLength: 0, maxLength: 10 })
  })
});