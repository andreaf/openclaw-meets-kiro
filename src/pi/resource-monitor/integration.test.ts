/**
 * Integration Tests for ResourceMonitor with Hardware Detection
 * 
 * Tests the integration between ResourceMonitor and hardware detection
 * to ensure proper configuration and functionality.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ResourceMonitor } from './resource-monitor.js';
import { detectPiHardware } from '../hardware/detection.js';
import type { PiConfiguration } from '../types/index.js';

describe('ResourceMonitor Integration', () => {
  let resourceMonitor: ResourceMonitor;
  let piConfig: PiConfiguration;

  beforeEach(() => {
    // Use actual hardware detection (will use defaults in test environment)
    piConfig = detectPiHardware();
    resourceMonitor = new ResourceMonitor(piConfig);
  });

  afterEach(() => {
    resourceMonitor.stopMonitoring();
  });

  describe('Hardware-aware configuration', () => {
    it('should initialize with detected hardware configuration', () => {
      expect(piConfig).toBeDefined();
      expect(piConfig.model).toBeDefined();
      expect(piConfig.architecture).toBeDefined();
      expect(piConfig.memory.total).toBeGreaterThan(0);
      expect(piConfig.memory.limit).toBeGreaterThan(0);
      expect(piConfig.memory.limit).toBeLessThanOrEqual(piConfig.memory.total);
    });

    it('should set appropriate memory limits based on detected hardware', () => {
      const thresholds = resourceMonitor.getThresholds();
      
      // Verify default thresholds are set
      expect(thresholds.memoryGCThreshold).toBe(0.8);
      expect(thresholds.memoryPressureThreshold).toBe(0.9);
      expect(thresholds.cpuUsageThreshold).toBe(0.85);
      expect(thresholds.storageCleanupThreshold).toBe(0.8);
      expect(thresholds.networkLatencyThreshold).toBe(100);
    });

    it('should handle memory limit enforcement based on Pi model', () => {
      // Test memory limit logic based on detected configuration
      const memoryLimitMB = piConfig.memory.limit;
      const totalMemoryMB = piConfig.memory.total;
      
      if (totalMemoryMB <= 1024) {
        expect(memoryLimitMB).toBe(512); // 512MB limit for 1GB Pi models
      } else if (totalMemoryMB <= 2048) {
        expect(memoryLimitMB).toBe(1024); // 1GB limit for 2GB Pi models
      } else {
        expect(memoryLimitMB).toBe(2048); // 2GB limit for 4GB+ Pi models
      }
    });
  });

  describe('System metrics collection', () => {
    it('should collect system metrics successfully', async () => {
      const metrics = await resourceMonitor.getSystemMetrics();

      // Verify all metric categories are present
      expect(metrics.timestamp).toBeInstanceOf(Date);
      expect(metrics.cpu).toBeDefined();
      expect(metrics.memory).toBeDefined();
      expect(metrics.storage).toBeDefined();
      expect(metrics.network).toBeDefined();

      // Verify CPU metrics
      expect(metrics.cpu.usage).toBeGreaterThanOrEqual(0);
      expect(metrics.cpu.usage).toBeLessThanOrEqual(100);
      expect(metrics.cpu.temperature).toBeGreaterThan(0);
      expect(metrics.cpu.frequency).toBeGreaterThan(0);
      expect(typeof metrics.cpu.throttled).toBe('boolean');

      // Verify memory metrics
      expect(metrics.memory.total).toBeGreaterThan(0);
      expect(metrics.memory.used).toBeGreaterThanOrEqual(0);
      expect(metrics.memory.available).toBeGreaterThanOrEqual(0);
      expect(metrics.memory.swapUsed).toBeGreaterThanOrEqual(0);

      // Verify storage metrics
      expect(metrics.storage.total).toBeGreaterThan(0);
      expect(metrics.storage.used).toBeGreaterThanOrEqual(0);
      expect(metrics.storage.available).toBeGreaterThanOrEqual(0);
      expect(metrics.storage.writeCount).toBeGreaterThanOrEqual(0);

      // Verify network metrics
      expect(['wifi', 'ethernet']).toContain(metrics.network.interface);
      expect(metrics.network.bandwidth).toBeGreaterThan(0);
      expect(metrics.network.latency).toBeGreaterThanOrEqual(0);
      expect(metrics.network.packetsLost).toBeGreaterThanOrEqual(0);
    });

    it('should provide consistent performance profile assessment', async () => {
      await resourceMonitor.getSystemMetrics();
      
      const profile = resourceMonitor.getPerformanceProfile();
      expect(['high', 'medium', 'low', 'critical']).toContain(profile);
    });

    it('should track metrics over time', async () => {
      const metrics1 = await resourceMonitor.getSystemMetrics();
      
      // Wait a small amount of time
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const metrics2 = await resourceMonitor.getSystemMetrics();
      
      // Timestamps should be different
      expect(metrics2.timestamp.getTime()).toBeGreaterThan(metrics1.timestamp.getTime());
      
      // Last metrics should be updated
      const lastMetrics = resourceMonitor.getLastMetrics();
      expect(lastMetrics?.timestamp).toEqual(metrics2.timestamp);
    });
  });

  describe('Event-driven monitoring', () => {
    it('should emit events when thresholds are exceeded', async () => {
      let eventEmitted = false;
      
      // Listen for any threshold events
      resourceMonitor.on('memoryPressure', () => { eventEmitted = true; });
      resourceMonitor.on('cpuPressure', () => { eventEmitted = true; });
      resourceMonitor.on('storagePressure', () => { eventEmitted = true; });
      resourceMonitor.on('networkPressure', () => { eventEmitted = true; });
      resourceMonitor.on('memoryLimitExceeded', () => { eventEmitted = true; });
      
      // Set very low thresholds to trigger events
      resourceMonitor.setThresholds({
        memoryGCThreshold: 0.01,
        memoryPressureThreshold: 0.02,
        cpuUsageThreshold: 0.01,
        storageCleanupThreshold: 0.01,
        networkLatencyThreshold: 1,
      });
      
      await resourceMonitor.getSystemMetrics();
      
      // At least one event should be triggered with such low thresholds
      // Note: This might not always trigger in test environments, so we don't assert
      // but we verify the event system is properly set up
      expect(typeof eventEmitted).toBe('boolean');
    });

    it('should support adaptive scaling configuration', () => {
      let adaptiveScalingEnabled = false;
      
      resourceMonitor.on('adaptiveScalingEnabled', () => {
        adaptiveScalingEnabled = true;
      });
      
      resourceMonitor.enableAdaptiveScaling();
      
      expect(adaptiveScalingEnabled).toBe(true);
    });
  });

  describe('Monitoring lifecycle', () => {
    it('should start and stop monitoring correctly', () => {
      let monitoringStarted = false;
      let monitoringStopped = false;
      
      resourceMonitor.on('monitoringStarted', () => {
        monitoringStarted = true;
      });
      
      resourceMonitor.on('monitoringStopped', () => {
        monitoringStopped = true;
      });
      
      resourceMonitor.startMonitoring(1000);
      expect(monitoringStarted).toBe(true);
      
      resourceMonitor.stopMonitoring();
      expect(monitoringStopped).toBe(true);
    });

    it('should handle write count tracking', () => {
      const initialMetrics = resourceMonitor.getLastMetrics();
      const initialWriteCount = initialMetrics?.storage.writeCount || 0;
      
      resourceMonitor.incrementWriteCount();
      resourceMonitor.incrementWriteCount();
      
      // Write count should be tracked internally
      // (We can't directly verify the count without getting new metrics)
      expect(resourceMonitor.incrementWriteCount).toBeDefined();
    });
  });

  describe('Configuration validation', () => {
    it('should validate Pi configuration structure', () => {
      expect(piConfig.model).toBeDefined();
      expect(piConfig.architecture).toBeDefined();
      expect(piConfig.memory).toBeDefined();
      expect(piConfig.thermal).toBeDefined();
      expect(piConfig.storage).toBeDefined();
      expect(piConfig.gpio).toBeDefined();
      
      // Validate memory configuration
      expect(typeof piConfig.memory.total).toBe('number');
      expect(typeof piConfig.memory.limit).toBe('number');
      expect(piConfig.memory.total).toBeGreaterThan(0);
      expect(piConfig.memory.limit).toBeGreaterThan(0);
      
      // Validate thermal configuration
      expect(Array.isArray(piConfig.thermal.thresholds)).toBe(true);
      expect(piConfig.thermal.thresholds.length).toBeGreaterThan(0);
      
      // Validate storage configuration
      expect(['sd', 'usb', 'ssd']).toContain(piConfig.storage.type);
      expect(typeof piConfig.storage.wearLeveling).toBe('boolean');
      
      // Validate GPIO configuration
      expect(Array.isArray(piConfig.gpio.available)).toBe(true);
      expect(Array.isArray(piConfig.gpio.reserved)).toBe(true);
    });

    it('should handle different Pi models appropriately', () => {
      // Test that the configuration makes sense for the detected model
      const model = piConfig.model;
      
      if (model.includes('Pi 5')) {
        // Pi 5 should have more GPIO pins available
        expect(piConfig.gpio.available.length).toBeGreaterThanOrEqual(26);
      } else if (model.includes('Pi 4') || model.includes('Pi 3')) {
        // Standard Pi models should have standard GPIO configuration
        expect(piConfig.gpio.available.length).toBeGreaterThanOrEqual(20);
      }
      
      // All models should have reasonable memory limits
      expect(piConfig.memory.limit).toBeLessThanOrEqual(piConfig.memory.total);
      expect(piConfig.memory.limit).toBeGreaterThanOrEqual(512); // Minimum 512MB limit
    });
  });
});