/**
 * Simple Hardware Detection Tests
 * 
 * Property-based tests demonstrating fast-check setup for Pi hardware utilities.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { 
  getAvailableGpioPins,
  getReservedGpioPins 
} from './detection.js';

describe('Pi Hardware Detection - Property Tests', () => {
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
      ), { numRuns: 50 }); // Run 50 test cases
    });

    it('should be deterministic for the same model', () => {
      fc.assert(fc.property(
        fc.constantFrom('Pi 5', 'Pi 4B', 'Pi 3B+', 'Pi Zero'),
        (model) => {
          const pins1 = getAvailableGpioPins(model);
          const pins2 = getAvailableGpioPins(model);
          
          // Property: Should return identical results for same input
          expect(pins1).toEqual(pins2);
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

    it('should have no duplicate pins', () => {
      const pins = getReservedGpioPins();
      const uniquePins = [...new Set(pins)];
      
      // Property: No duplicates
      expect(uniquePins.length).toBe(pins.length);
    });
  });

  describe('GPIO Pin Relationship Properties', () => {
    it('available and reserved pins should not overlap', () => {
      fc.assert(fc.property(
        fc.constantFrom('Pi 5', 'Pi 4B', 'Pi 3B+', 'Pi Zero'),
        (model) => {
          const available = getAvailableGpioPins(model);
          const reserved = getReservedGpioPins();
          
          // Property: No pin should be both available and reserved
          const availableSet = new Set(available);
          const reservedSet = new Set(reserved);
          
          const intersection = available.filter(pin => reservedSet.has(pin));
          expect(intersection).toHaveLength(0);
        }
      ));
    });

    it('all pins should be within valid GPIO range', () => {
      fc.assert(fc.property(
        fc.constantFrom('Pi 5', 'Pi 4B', 'Pi 3B+', 'Pi Zero'),
        (model) => {
          const available = getAvailableGpioPins(model);
          const reserved = getReservedGpioPins();
          const allPins = [...available, ...reserved];
          
          // Property: All pins should be in valid range
          allPins.forEach(pin => {
            expect(pin).toBeGreaterThanOrEqual(0);
            expect(pin).toBeLessThan(32);
          });
        }
      ));
    });
  });
});

/**
 * Demonstration of custom property generators
 */
describe('Custom Property Generators', () => {
  // Generator for valid Pi model names
  const piModelArbitrary = fc.constantFrom(
    'Pi 5', 'Pi 4B', 'Pi 3B+', 'Pi Zero', 'Unknown Pi Model'
  );

  // Generator for GPIO pin numbers
  const gpioPinArbitrary = fc.integer({ min: 0, max: 31 });

  // Generator for temperature values (excluding NaN and infinite values)
  const temperatureArbitrary = fc.float({ min: -10, max: 100, noNaN: true });

  it('should validate temperature ranges', () => {
    fc.assert(fc.property(
      temperatureArbitrary,
      (temp) => {
        // Property: Temperature should be within reasonable bounds
        expect(temp).toBeGreaterThanOrEqual(-10);
        expect(temp).toBeLessThanOrEqual(100);
        
        // Property: Should be a finite number
        expect(Number.isFinite(temp)).toBe(true);
      }
    ));
  });

  it('should validate GPIO pin ranges', () => {
    fc.assert(fc.property(
      gpioPinArbitrary,
      (pin) => {
        // Property: Pin should be valid GPIO number
        expect(pin).toBeGreaterThanOrEqual(0);
        expect(pin).toBeLessThan(32);
        expect(Number.isInteger(pin)).toBe(true);
      }
    ));
  });

  it('should validate Pi model names', () => {
    fc.assert(fc.property(
      piModelArbitrary,
      (model) => {
        // Property: Model should be a non-empty string
        expect(typeof model).toBe('string');
        expect(model.length).toBeGreaterThan(0);
        
        // Property: Should be one of the known models
        const knownModels = ['Pi 5', 'Pi 4B', 'Pi 3B+', 'Pi Zero', 'Unknown Pi Model'];
        expect(knownModels).toContain(model);
      }
    ));
  });
});

/**
 * Demonstration of property-based testing patterns
 */
describe('Property Testing Patterns', () => {
  it('demonstrates invariant properties', () => {
    fc.assert(fc.property(
      fc.array(fc.integer({ min: 0, max: 31 }), { minLength: 1, maxLength: 30 }),
      (pins) => {
        // Property: Sorting should not change array length
        const sorted = [...pins].sort((a, b) => a - b);
        expect(sorted.length).toBe(pins.length);
        
        // Property: All original elements should still be present
        pins.forEach(pin => {
          expect(sorted).toContain(pin);
        });
      }
    ));
  });

  it('demonstrates metamorphic properties', () => {
    fc.assert(fc.property(
      fc.constantFrom('Pi 4B', 'Pi 5'),
      (model) => {
        const pins1 = getAvailableGpioPins(model);
        const pins2 = getAvailableGpioPins(model);
        
        // Property: Function should be idempotent
        expect(pins1).toEqual(pins2);
        
        // Property: Result should not depend on call order
        const pins3 = getAvailableGpioPins(model);
        expect(pins1).toEqual(pins3);
      }
    ));
  });

  it('demonstrates conditional properties', () => {
    fc.assert(fc.property(
      fc.record({
        total: fc.integer({ min: 512, max: 8192 }),
        used: fc.integer({ min: 0, max: 8192 })
      }).filter(mem => mem.used <= mem.total),
      (memory) => {
        const available = memory.total - memory.used;
        
        // Property: Available memory should be non-negative
        expect(available).toBeGreaterThanOrEqual(0);
        
        // Property: Available + used should equal total
        expect(available + memory.used).toBe(memory.total);
        
        // Conditional property: If system is low on memory
        if (memory.used > memory.total * 0.8) {
          // Then available memory should be less than 20% of total
          expect(available).toBeLessThan(memory.total * 0.2);
        }
      }
    ));
  });
});