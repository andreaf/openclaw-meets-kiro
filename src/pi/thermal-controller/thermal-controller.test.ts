/**
 * ThermalController Unit Tests
 * 
 * Tests the thermal management and CPU throttling functionality
 * for Raspberry Pi thermal control.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type MockedFunction } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { ThermalController, type ThermalEvent, type ThermalStatus, type ThermalNotification } from './thermal-controller.js';
import type { ThermalPolicy } from '../types/index.js';

// Mock fs functions
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

// Mock logging modules
vi.mock('../../logging/subsystem.js', () => ({
  createSubsystemLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('../../logger.js', () => ({
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

const mockReadFileSync = readFileSync as MockedFunction<typeof readFileSync>;
const mockExistsSync = existsSync as MockedFunction<typeof existsSync>;

describe('ThermalController', () => {
  let thermalController: ThermalController;
  let mockPolicy: ThermalPolicy;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    
    // Default mock policy with 5-second interval and standard thresholds
    mockPolicy = {
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

    thermalController = new ThermalController(mockPolicy);
  });

  afterEach(() => {
    thermalController.stopMonitoring();
  });

  describe('Temperature Reading', () => {
    it('should read temperature from thermal zone file', async () => {
      // Mock successful temperature reading (45.5°C = 45500 millicelsius)
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('45500\n');

      const temperature = await thermalController.getCurrentTemperature();

      expect(temperature).toBe(45.5);
      expect(mockExistsSync).toHaveBeenCalledWith('/sys/class/thermal/thermal_zone0/temp');
      expect(mockReadFileSync).toHaveBeenCalledWith('/sys/class/thermal/thermal_zone0/temp', 'utf8');
    });

    it('should handle missing thermal sensor file', async () => {
      mockExistsSync.mockReturnValue(false);

      const temperature = await thermalController.getCurrentTemperature();

      expect(temperature).toBe(45.0); // Fallback temperature
      expect(mockExistsSync).toHaveBeenCalledWith('/sys/class/thermal/thermal_zone0/temp');
      expect(mockReadFileSync).not.toHaveBeenCalled();
    });

    it('should handle invalid temperature readings', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('invalid\n');

      const temperature = await thermalController.getCurrentTemperature();

      expect(temperature).toBe(45.0); // Fallback temperature
    });

    it('should handle file read errors', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const temperature = await thermalController.getCurrentTemperature();

      expect(temperature).toBe(45.0); // Fallback temperature
    });

    it('should convert millicelsius to celsius correctly', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('72350'); // 72.35°C

      const temperature = await thermalController.getCurrentTemperature();

      expect(temperature).toBe(72.35);
    });
  });

  describe('Thermal Monitoring', () => {
    it('should start monitoring with correct interval', () => {
      const startSpy = vi.spyOn(thermalController, 'emit');
      
      thermalController.startMonitoring();

      expect(startSpy).toHaveBeenCalledWith('monitoringStarted', {
        interval: 5,
        source: '/sys/class/thermal/thermal_zone0/temp',
      });
      expect(thermalController.isMonitoring()).toBe(true);
    });

    it('should stop monitoring correctly', () => {
      const stopSpy = vi.spyOn(thermalController, 'emit');
      
      thermalController.startMonitoring();
      thermalController.stopMonitoring();

      expect(stopSpy).toHaveBeenCalledWith('monitoringStopped');
      expect(thermalController.isMonitoring()).toBe(false);
    });

    it('should restart monitoring when already running', () => {
      thermalController.startMonitoring();
      const firstInterval = thermalController.isMonitoring();
      
      thermalController.startMonitoring(); // Start again
      
      expect(thermalController.isMonitoring()).toBe(true);
      expect(firstInterval).toBe(true);
    });
  });

  describe('Thermal Thresholds', () => {
    beforeEach(() => {
      mockExistsSync.mockReturnValue(true);
    });

    it('should trigger 25% reduction at 70°C (Requirement 4.1)', async () => {
      const throttlingSpy = vi.spyOn(thermalController, 'emit');
      mockReadFileSync.mockReturnValue('70000'); // 70°C

      await thermalController.forceThermalCheck();

      expect(throttlingSpy).toHaveBeenCalledWith('thermalThrottling', expect.objectContaining({
        temperature: 70,
        threshold: 70,
        action: 'reduce_25',
        reductionLevel: 0.25,
      }));
    });

    it('should trigger 50% reduction at 75°C (Requirement 4.2)', async () => {
      const throttlingSpy = vi.spyOn(thermalController, 'emit');
      mockReadFileSync.mockReturnValue('75000'); // 75°C

      await thermalController.forceThermalCheck();

      expect(throttlingSpy).toHaveBeenCalledWith('thermalThrottling', expect.objectContaining({
        temperature: 75,
        threshold: 75,
        action: 'reduce_50',
        reductionLevel: 0.50,
      }));
    });

    it('should pause services at 80°C (Requirement 4.3)', async () => {
      const emergencySpy = vi.spyOn(thermalController, 'emit');
      mockReadFileSync.mockReturnValue('80000'); // 80°C

      await thermalController.forceThermalCheck();

      expect(emergencySpy).toHaveBeenCalledWith('thermalEmergency', expect.objectContaining({
        temperature: 80,
        threshold: 80,
        action: 'pause_services',
        emergencyLevel: 'pause_services',
      }));
    });

    it('should use highest applicable threshold', async () => {
      const throttlingSpy = vi.spyOn(thermalController, 'emit');
      mockReadFileSync.mockReturnValue('78000'); // 78°C - should trigger 50% reduction, not 25%

      await thermalController.forceThermalCheck();

      expect(throttlingSpy).toHaveBeenCalledWith('thermalThrottling', expect.objectContaining({
        action: 'reduce_50',
        reductionLevel: 0.50,
      }));
    });

    it('should not trigger action below thresholds', async () => {
      const throttlingSpy = vi.spyOn(thermalController, 'emit');
      mockReadFileSync.mockReturnValue('65000'); // 65°C - below all thresholds

      await thermalController.forceThermalCheck();

      expect(throttlingSpy).not.toHaveBeenCalledWith('thermalThrottling', expect.anything());
      expect(throttlingSpy).not.toHaveBeenCalledWith('thermalEmergency', expect.anything());
    });
  });

  describe('Thermal Recovery', () => {
    beforeEach(() => {
      mockExistsSync.mockReturnValue(true);
    });

    it('should recover from throttling when temperature drops', async () => {
      const recoverySpy = vi.spyOn(thermalController, 'emit');
      
      // First trigger throttling at 75°C
      mockReadFileSync.mockReturnValue('75000');
      await thermalController.forceThermalCheck();
      
      // Then drop temperature to recovery threshold (70°C)
      mockReadFileSync.mockReturnValue('70000');
      await thermalController.forceThermalCheck();

      expect(recoverySpy).toHaveBeenCalledWith('thermalRecovery', expect.objectContaining({
        temperature: 70,
        threshold: 70,
        action: 'recovery',
      }));
    });

    it('should not recover if temperature is still above recovery threshold', async () => {
      const recoverySpy = vi.spyOn(thermalController, 'emit');
      
      // First trigger throttling at 75°C
      mockReadFileSync.mockReturnValue('75000');
      await thermalController.forceThermalCheck();
      
      // Temperature drops but not enough (72°C > 70°C recovery threshold)
      mockReadFileSync.mockReturnValue('72000');
      await thermalController.forceThermalCheck();

      expect(recoverySpy).not.toHaveBeenCalledWith('thermalRecovery', expect.anything());
    });
  });

  describe('Thermal Status', () => {
    beforeEach(() => {
      mockExistsSync.mockReturnValue(true);
    });

    it('should track thermal status correctly', async () => {
      mockReadFileSync.mockReturnValue('72000'); // 72°C

      await thermalController.getCurrentTemperature();
      const status = thermalController.getThermalStatus();

      expect(status.currentTemperature).toBe(72);
      expect(status.lastUpdate).toBeInstanceOf(Date);
    });

    it('should update status when throttling is active', async () => {
      mockReadFileSync.mockReturnValue('75000'); // 75°C

      await thermalController.forceThermalCheck();
      const status = thermalController.getThermalStatus();

      expect(status.activeThrottling).toBe(true);
      expect(status.currentAction).toBe('reduce_50');
    });

    it('should clear status when recovering', async () => {
      // Trigger throttling
      mockReadFileSync.mockReturnValue('75000');
      await thermalController.forceThermalCheck();
      
      // Recover
      mockReadFileSync.mockReturnValue('68000');
      await thermalController.forceThermalCheck();
      
      const status = thermalController.getThermalStatus();

      expect(status.activeThrottling).toBe(false);
      expect(status.currentAction).toBeUndefined();
    });
  });

  describe('Temperature History', () => {
    beforeEach(() => {
      mockExistsSync.mockReturnValue(true);
    });

    it('should maintain temperature history', async () => {
      mockReadFileSync.mockReturnValue('65000'); // 65°C
      await thermalController.getCurrentTemperature();
      
      mockReadFileSync.mockReturnValue('67000'); // 67°C
      await thermalController.getCurrentTemperature();

      const history = thermalController.getTemperatureHistory();
      
      expect(history).toHaveLength(2);
      expect(history[0].temperature).toBe(65);
      expect(history[1].temperature).toBe(67);
      expect(history[0].timestamp).toBeInstanceOf(Date);
    });

    it('should limit history size', async () => {
      // Add more than 100 readings
      for (let i = 0; i < 105; i++) {
        mockReadFileSync.mockReturnValue(`${60000 + i * 100}`); // Incrementing temperature
        await thermalController.getCurrentTemperature();
      }

      const history = thermalController.getTemperatureHistory();
      
      expect(history).toHaveLength(100); // Should be limited to 100
      expect(history[0].temperature).toBe(60.5); // Should have removed the first 5 readings (60.0-60.4)
    });
  });

  describe('Policy Management', () => {
    it('should update thermal policy', () => {
      const newPolicy: ThermalPolicy = {
        monitoring: {
          interval: 3,
          source: '/custom/thermal/path',
        },
        thresholds: [
          {
            temperature: 65,
            action: 'reduce_25',
            recovery: 60,
          },
        ],
      };

      const policySpy = vi.spyOn(thermalController, 'emit');
      
      thermalController.setThermalPolicy(newPolicy);
      
      expect(thermalController.getThermalPolicy()).toEqual(newPolicy);
      expect(policySpy).toHaveBeenCalledWith('policyUpdated', newPolicy);
    });

    it('should restart monitoring when policy is updated during monitoring', () => {
      thermalController.startMonitoring();
      expect(thermalController.isMonitoring()).toBe(true);

      const newPolicy: ThermalPolicy = {
        ...mockPolicy,
        monitoring: { ...mockPolicy.monitoring, interval: 3 },
      };

      thermalController.setThermalPolicy(newPolicy);
      
      expect(thermalController.isMonitoring()).toBe(true);
      expect(thermalController.getMonitoringInterval()).toBe(3);
    });
  });

  describe('Fan Control', () => {
    it('should enable fan control when configured', () => {
      const policyWithFan: ThermalPolicy = {
        ...mockPolicy,
        fanControl: {
          pin: 18,
          pwmFrequency: 1000,
        },
      };

      thermalController.setThermalPolicy(policyWithFan);
      
      const fanSpy = vi.spyOn(thermalController, 'emit');
      thermalController.enableFanControl();

      expect(fanSpy).toHaveBeenCalledWith('fanControlRequested', {
        pin: 18,
        pwmFrequency: 1000,
      });
    });

    it('should warn when fan control is not configured', () => {
      // Mock the logger to capture the warning
      const loggerWarnSpy = vi.fn();
      const mockLogger = {
        info: vi.fn(),
        warn: loggerWarnSpy,
        error: vi.fn(),
        fatal: vi.fn(),
        debug: vi.fn(),
      };
      
      // Replace the logger in the controller
      (thermalController as any).logger = mockLogger;
      
      thermalController.enableFanControl();

      expect(loggerWarnSpy).toHaveBeenCalledWith('Fan control not configured in thermal policy');
    });
  });

  describe('Statistics', () => {
    beforeEach(() => {
      mockExistsSync.mockReturnValue(true);
    });

    it('should calculate thermal statistics', async () => {
      // Add some temperature readings
      const temperatures = [65, 70, 68, 72, 69];
      
      for (const temp of temperatures) {
        mockReadFileSync.mockReturnValue(`${temp * 1000}`);
        await thermalController.getCurrentTemperature();
      }

      const stats = thermalController.getThermalStatistics();
      
      expect(stats.averageTemperature).toBe(68.8);
      expect(stats.maxTemperature).toBe(72);
      expect(stats.minTemperature).toBe(65);
    });

    it('should handle empty history', () => {
      const stats = thermalController.getThermalStatistics();
      
      expect(stats.averageTemperature).toBe(0);
      expect(stats.maxTemperature).toBe(0);
      expect(stats.minTemperature).toBe(0);
      expect(stats.throttlingEvents).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle monitoring errors gracefully', async () => {
      // Create a controller with a very short interval for testing
      const testPolicy: ThermalPolicy = {
        ...mockPolicy,
        monitoring: { ...mockPolicy.monitoring, interval: 0.1 }, // 100ms
      };
      const testController = new ThermalController(testPolicy);
      
      const errorSpy = vi.spyOn(testController, 'emit');
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      // Mock getCurrentTemperature to throw an error directly
      vi.spyOn(testController, 'getCurrentTemperature').mockImplementation(async () => {
        throw new Error('Sensor failure');
      });

      testController.startMonitoring();
      
      // Wait for the monitoring interval to trigger
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(errorSpy).toHaveBeenCalledWith('monitoringError', expect.any(Error));
      
      testController.stopMonitoring();
      consoleSpy.mockRestore();
    });
  });

  describe('Thermal Event Logging and Notifications (Requirement 4.5)', () => {
    beforeEach(() => {
      mockExistsSync.mockReturnValue(true);
    });

    it('should log thermal events with structured logging', async () => {
      const thermalEventSpy = vi.spyOn(thermalController, 'emit');
      mockReadFileSync.mockReturnValue('75000'); // 75°C

      await thermalController.forceThermalCheck();

      // Should emit thermal event
      expect(thermalEventSpy).toHaveBeenCalledWith('thermalEvent', expect.objectContaining({
        temperature: 75,
        threshold: 75,
        action: 'reduce_50',
        severity: 'critical',
        message: expect.stringContaining('CPU temperature 75°C exceeded 50% throttling threshold'),
      }));

      // Should have thermal event in log
      const eventLog = thermalController.getThermalEventLog();
      expect(eventLog).toHaveLength(1);
      expect(eventLog[0]).toMatchObject({
        temperature: 75,
        action: 'reduce_50',
        severity: 'critical',
      });
    });

    it('should send administrator notifications for thermal throttling', async () => {
      const notificationSpy = vi.spyOn(thermalController, 'emit');
      mockReadFileSync.mockReturnValue('80000'); // 80°C - emergency threshold

      await thermalController.forceThermalCheck();

      // Should emit notification event
      expect(notificationSpy).toHaveBeenCalledWith('thermalNotification', expect.objectContaining({
        type: 'emergency',
        severity: 'emergency',
        title: 'Thermal Emergency: Services Paused',
        temperature: 80,
        action: 'pause_services',
      }));
    });

    it('should respect notification cooldown period', async () => {
      const notificationSpy = vi.spyOn(thermalController, 'emit');
      
      // Configure short cooldown for testing
      thermalController.setNotificationConfig({ cooldownPeriod: 1 }); // 1 second
      
      mockReadFileSync.mockReturnValue('75000'); // 75°C

      // First trigger
      await thermalController.forceThermalCheck();
      
      // Check that notification was sent
      const firstNotificationCall = notificationSpy.mock.calls.find(call => call[0] === 'thermalNotification');
      expect(firstNotificationCall).toBeDefined();
      
      notificationSpy.mockClear();
      
      // Second trigger immediately (should be blocked by cooldown)
      await thermalController.forceThermalCheck();
      const secondNotificationCall = notificationSpy.mock.calls.find(call => call[0] === 'thermalNotification');
      expect(secondNotificationCall).toBeUndefined();
      
      // Wait for cooldown to expire
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      // Clear the spy to start fresh
      notificationSpy.mockClear();
      
      // Third trigger (should work after cooldown) - but we need to trigger a different state
      // to avoid the system thinking it's the same throttling event
      // First, let temperature drop to trigger recovery
      mockReadFileSync.mockReturnValue('68000'); // 68°C - below recovery threshold
      await thermalController.forceThermalCheck();
      
      // Then trigger throttling again
      mockReadFileSync.mockReturnValue('75000'); // 75°C
      await thermalController.forceThermalCheck();
      
      const thirdNotificationCall = notificationSpy.mock.calls.find(call => call[0] === 'thermalNotification');
      expect(thirdNotificationCall).toBeDefined();
    });

    it('should log thermal recovery events', async () => {
      const thermalEventSpy = vi.spyOn(thermalController, 'emit');
      
      // First trigger throttling at 75°C
      mockReadFileSync.mockReturnValue('75000');
      await thermalController.forceThermalCheck();
      
      // Then trigger recovery at 68°C (below 70°C recovery threshold)
      mockReadFileSync.mockReturnValue('68000');
      await thermalController.forceThermalCheck();

      expect(thermalEventSpy).toHaveBeenCalledWith('thermalEvent', expect.objectContaining({
        temperature: 68,
        action: 'recovery',
        severity: 'info',
        message: expect.stringContaining('CPU temperature 68°C dropped below recovery threshold'),
      }));
    });

    it('should filter thermal events by criteria', async () => {
      // Generate multiple thermal events
      const temperatures = [70000, 75000, 68000, 80000]; // Mix of throttling and recovery
      
      for (const temp of temperatures) {
        mockReadFileSync.mockReturnValue(temp.toString());
        await thermalController.forceThermalCheck();
      }

      const allEvents = thermalController.getThermalEventLog();
      expect(allEvents.length).toBeGreaterThan(0);

      // Filter by action
      const throttlingEvents = thermalController.getThermalEvents({ action: 'reduce_25' });
      expect(throttlingEvents.every(e => e.action === 'reduce_25')).toBe(true);

      // Filter by severity
      const criticalEvents = thermalController.getThermalEvents({ severity: 'critical' });
      expect(criticalEvents.every(e => e.severity === 'critical')).toBe(true);

      // Filter with limit
      const limitedEvents = thermalController.getThermalEvents({ limit: 2 });
      expect(limitedEvents.length).toBeLessThanOrEqual(2);
    });

    it('should maintain thermal event log size limit', async () => {
      // Create controller with small log size for testing
      const testController = new ThermalController(mockPolicy);
      
      // Generate many events (more than the limit)
      for (let i = 0; i < 1005; i++) {
        mockReadFileSync.mockReturnValue('75000'); // 75°C
        await testController.forceThermalCheck();
      }

      const eventLog = testController.getThermalEventLog();
      expect(eventLog.length).toBeLessThanOrEqual(1000); // Should respect maxEventLogSize
      
      testController.stopMonitoring();
    });

    it('should handle sensor failure notifications', async () => {
      const notificationSpy = vi.spyOn(thermalController, 'emit');
      
      // Simulate sensor failure by making existsSync return false
      mockExistsSync.mockReturnValue(false);

      await thermalController.getCurrentTemperature();

      // Should log sensor failure event
      const eventLog = thermalController.getThermalEventLog();
      const sensorFailureEvent = eventLog.find(e => e.message.includes('Thermal sensor failure'));
      expect(sensorFailureEvent).toBeDefined();
      expect(sensorFailureEvent?.severity).toBe('warning');
      expect(sensorFailureEvent?.action).toBe('recovery');
    });

    it('should allow notification configuration updates', () => {
      const originalConfig = thermalController.getNotificationConfig();
      expect(originalConfig.enabled).toBe(true);

      // Update configuration
      thermalController.setNotificationConfig({
        enabled: false,
        throttlingThreshold: 65,
        cooldownPeriod: 600,
      });

      const updatedConfig = thermalController.getNotificationConfig();
      expect(updatedConfig.enabled).toBe(false);
      expect(updatedConfig.throttlingThreshold).toBe(65);
      expect(updatedConfig.cooldownPeriod).toBe(600);
      expect(updatedConfig.channels).toEqual(originalConfig.channels); // Should preserve unchanged values
    });

    it('should clear thermal event log', async () => {
      // Generate some events
      mockReadFileSync.mockReturnValue('75000');
      await thermalController.forceThermalCheck();
      
      expect(thermalController.getThermalEventLog().length).toBeGreaterThan(0);
      
      // Clear log
      thermalController.clearThermalEventLog();
      
      expect(thermalController.getThermalEventLog().length).toBe(0);
    });
  });
});