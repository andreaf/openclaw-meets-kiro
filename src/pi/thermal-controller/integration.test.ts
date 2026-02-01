/**
 * ThermalController Integration Tests
 * 
 * Tests the integration of ThermalController with the Pi system
 * and validates the complete thermal management workflow.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ThermalController } from './thermal-controller.js';
import type { ThermalPolicy } from '../types/index.js';
import { readFileSync, existsSync } from 'node:fs';

// Mock fs functions for integration testing
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

const mockReadFileSync = readFileSync as any;
const mockExistsSync = existsSync as any;

describe('ThermalController Integration', () => {
  let thermalController: ThermalController;
  let thermalPolicy: ThermalPolicy;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Standard thermal policy matching requirements
    thermalPolicy = {
      monitoring: {
        interval: 5, // 5 seconds as per requirement 4.4
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
    };

    thermalController = new ThermalController(thermalPolicy);
  });

  afterEach(() => {
    thermalController.stopMonitoring();
  });

  describe('Complete Thermal Management Workflow', () => {
    it('should handle complete thermal event lifecycle', async () => {
      mockExistsSync.mockReturnValue(true);
      
      const events: any[] = [];
      
      // Listen to all thermal events
      thermalController.on('thermalThrottling', (event) => events.push({ type: 'throttling', ...event }));
      thermalController.on('thermalEmergency', (event) => events.push({ type: 'emergency', ...event }));
      thermalController.on('thermalRecovery', (event) => events.push({ type: 'recovery', ...event }));

      // Scenario 1: Normal temperature (no action)
      mockReadFileSync.mockReturnValue('65000'); // 65°C
      await thermalController.forceThermalCheck();
      expect(events).toHaveLength(0);

      // Scenario 2: First threshold - 25% reduction at 70°C
      mockReadFileSync.mockReturnValue('70000'); // 70°C
      await thermalController.forceThermalCheck();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'throttling',
        action: 'reduce_25',
        reductionLevel: 0.25,
        temperature: 70,
      });

      // Scenario 3: Escalation to 50% reduction at 75°C
      mockReadFileSync.mockReturnValue('75000'); // 75°C
      await thermalController.forceThermalCheck();
      expect(events).toHaveLength(2);
      expect(events[1]).toMatchObject({
        type: 'throttling',
        action: 'reduce_50',
        reductionLevel: 0.50,
        temperature: 75,
      });

      // Scenario 4: Emergency - pause services at 80°C
      mockReadFileSync.mockReturnValue('80000'); // 80°C
      await thermalController.forceThermalCheck();
      expect(events).toHaveLength(3);
      expect(events[2]).toMatchObject({
        type: 'emergency',
        action: 'pause_services',
        emergencyLevel: 'pause_services',
        temperature: 80,
      });

      // Scenario 5: Recovery - temperature drops to 75°C (recovery threshold for pause_services)
      mockReadFileSync.mockReturnValue('75000'); // 75°C
      await thermalController.forceThermalCheck();
      expect(events).toHaveLength(4);
      expect(events[3]).toMatchObject({
        type: 'recovery',
        action: 'recovery',
        temperature: 75,
      });

      // Verify thermal status is updated correctly
      const status = thermalController.getThermalStatus();
      expect(status.activeThrottling).toBe(false);
      expect(status.currentAction).toBeUndefined();
    });

    it('should maintain accurate temperature history during thermal events', async () => {
      mockExistsSync.mockReturnValue(true);
      
      const temperatures = [65, 68, 72, 76, 80, 78, 74, 70, 66];
      
      for (const temp of temperatures) {
        mockReadFileSync.mockReturnValue(`${temp * 1000}`);
        await thermalController.getCurrentTemperature();
      }

      const history = thermalController.getTemperatureHistory();
      expect(history).toHaveLength(temperatures.length);
      
      const recordedTemps = history.map(h => h.temperature);
      expect(recordedTemps).toEqual(temperatures);

      const stats = thermalController.getThermalStatistics();
      expect(stats.maxTemperature).toBe(80);
      expect(stats.minTemperature).toBe(65);
      expect(stats.averageTemperature).toBeCloseTo(72.1, 1);
    });

    it('should handle sensor failures gracefully during monitoring', async () => {
      mockExistsSync.mockReturnValue(false); // Simulate missing sensor
      
      const temperature = await thermalController.getCurrentTemperature();
      expect(temperature).toBe(45.0); // Fallback temperature

      const status = thermalController.getThermalStatus();
      expect(status.currentTemperature).toBe(45.0); // Status should be updated
      expect(status.activeThrottling).toBe(false);
    });

    it('should support dynamic policy updates during operation', async () => {
      mockExistsSync.mockReturnValue(true);
      
      // Start with normal temperature
      mockReadFileSync.mockReturnValue('68000'); // 68°C
      await thermalController.forceThermalCheck();
      
      let status = thermalController.getThermalStatus();
      expect(status.activeThrottling).toBe(false);

      // Update policy with lower thresholds
      const stricterPolicy: ThermalPolicy = {
        ...thermalPolicy,
        thresholds: [
          {
            temperature: 65,
            action: 'reduce_25',
            recovery: 60,
          },
          {
            temperature: 70,
            action: 'reduce_50',
            recovery: 65,
          },
        ],
      };

      thermalController.setThermalPolicy(stricterPolicy);

      // Same temperature should now trigger throttling
      await thermalController.forceThermalCheck();
      
      status = thermalController.getThermalStatus();
      expect(status.activeThrottling).toBe(true);
      expect(status.currentAction).toBe('reduce_25');
    });

    it('should integrate with fan control when configured', () => {
      const policyWithFan: ThermalPolicy = {
        ...thermalPolicy,
        fanControl: {
          pin: 18,
          pwmFrequency: 1000,
        },
      };

      thermalController.setThermalPolicy(policyWithFan);

      const fanEvents: any[] = [];
      thermalController.on('fanControlRequested', (event) => fanEvents.push(event));

      thermalController.enableFanControl();

      expect(fanEvents).toHaveLength(1);
      expect(fanEvents[0]).toEqual({
        pin: 18,
        pwmFrequency: 1000,
      });
    });
  });

  describe('Performance and Reliability', () => {
    it('should handle rapid temperature changes efficiently', async () => {
      mockExistsSync.mockReturnValue(true);
      
      const events: any[] = [];
      thermalController.on('thermalThrottling', (event) => events.push(event));
      thermalController.on('thermalRecovery', (event) => events.push(event));

      // Simulate rapid temperature fluctuations ending below recovery threshold
      const rapidChanges = [70, 75, 72, 78, 74, 76, 71, 69, 73, 64]; // End at 64°C (below 65°C recovery)
      
      for (const temp of rapidChanges) {
        mockReadFileSync.mockReturnValue(`${temp * 1000}`);
        await thermalController.forceThermalCheck();
      }

      // Should handle all changes without errors
      expect(events.length).toBeGreaterThan(0);
      
      // Final temperature (64°C) should result in recovery (below 65°C recovery threshold)
      const status = thermalController.getThermalStatus();
      expect(status.activeThrottling).toBe(false);
    });

    it('should maintain consistent monitoring interval', () => {
      expect(thermalController.getMonitoringInterval()).toBe(5);
      
      thermalController.startMonitoring();
      expect(thermalController.isMonitoring()).toBe(true);
      
      // Update policy with different interval
      const newPolicy: ThermalPolicy = {
        ...thermalPolicy,
        monitoring: { ...thermalPolicy.monitoring, interval: 3 },
      };
      
      thermalController.setThermalPolicy(newPolicy);
      expect(thermalController.getMonitoringInterval()).toBe(3);
      expect(thermalController.isMonitoring()).toBe(true);
    });
  });

  describe('Requirements Validation', () => {
    it('should validate Requirement 4.1: 25% reduction at 70°C', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('70000'); // Exactly 70°C

      const throttlingEvents: any[] = [];
      thermalController.on('thermalThrottling', (event) => throttlingEvents.push(event));

      await thermalController.forceThermalCheck();

      expect(throttlingEvents).toHaveLength(1);
      expect(throttlingEvents[0]).toMatchObject({
        temperature: 70,
        threshold: 70,
        action: 'reduce_25',
        reductionLevel: 0.25,
      });
    });

    it('should validate Requirement 4.2: 50% reduction at 75°C', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('75000'); // Exactly 75°C

      const throttlingEvents: any[] = [];
      thermalController.on('thermalThrottling', (event) => throttlingEvents.push(event));

      await thermalController.forceThermalCheck();

      expect(throttlingEvents).toHaveLength(1);
      expect(throttlingEvents[0]).toMatchObject({
        temperature: 75,
        threshold: 75,
        action: 'reduce_50',
        reductionLevel: 0.50,
      });
    });

    it('should validate Requirement 4.3: pause services at 80°C', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('80000'); // Exactly 80°C

      const emergencyEvents: any[] = [];
      thermalController.on('thermalEmergency', (event) => emergencyEvents.push(event));

      await thermalController.forceThermalCheck();

      expect(emergencyEvents).toHaveLength(1);
      expect(emergencyEvents[0]).toMatchObject({
        temperature: 80,
        threshold: 80,
        action: 'pause_services',
        emergencyLevel: 'pause_services',
      });
    });

    it('should validate Requirement 4.4: 5-second monitoring interval', () => {
      expect(thermalController.getMonitoringInterval()).toBe(5);
      
      const policy = thermalController.getThermalPolicy();
      expect(policy.monitoring.interval).toBe(5);
      expect(policy.monitoring.source).toBe('/sys/class/thermal/thermal_zone0/temp');
    });
  });
});