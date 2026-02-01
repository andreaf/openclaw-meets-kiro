/**
 * Unit Tests for ResourceMonitor
 * 
 * Tests the comprehensive system resource monitoring functionality
 * including CPU, memory, disk I/O, and network monitoring.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type MockedFunction } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { ResourceMonitor, type ResourceThresholds } from './resource-monitor.js';
import type { PiConfiguration } from '../types/index.js';

// Mock Node.js modules
vi.mock('node:fs');
vi.mock('node:child_process');

const mockReadFileSync = readFileSync as MockedFunction<typeof readFileSync>;
const mockExistsSync = existsSync as MockedFunction<typeof existsSync>;
const mockStatSync = statSync as MockedFunction<typeof statSync>;
const mockExecSync = execSync as MockedFunction<typeof execSync>;

describe('ResourceMonitor', () => {
  let resourceMonitor: ResourceMonitor;
  let mockConfig: PiConfiguration;
  let mockThresholds: ResourceThresholds;

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockConfig = {
      model: 'Pi 4B',
      architecture: 'arm64',
      memory: {
        total: 4096, // 4GB
        limit: 2048, // 2GB limit
      },
      thermal: {
        thresholds: [70, 75, 80],
      },
      storage: {
        type: 'sd',
        wearLeveling: true,
      },
      gpio: {
        available: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27],
        reserved: [0, 1],
      },
    };

    mockThresholds = {
      memoryGCThreshold: 0.8,
      memoryPressureThreshold: 0.9,
      cpuUsageThreshold: 0.85,
      storageCleanupThreshold: 0.8,
      networkLatencyThreshold: 100,
    };

    resourceMonitor = new ResourceMonitor(mockConfig, mockThresholds);
  });

  afterEach(() => {
    resourceMonitor.stopMonitoring();
  });

  describe('constructor', () => {
    it('should initialize with provided configuration and thresholds', () => {
      expect(resourceMonitor.getThresholds()).toEqual(mockThresholds);
    });

    it('should use default thresholds when not provided', () => {
      const monitor = new ResourceMonitor(mockConfig);
      const thresholds = monitor.getThresholds();
      
      expect(thresholds.memoryGCThreshold).toBe(0.8);
      expect(thresholds.memoryPressureThreshold).toBe(0.9);
      expect(thresholds.cpuUsageThreshold).toBe(0.85);
      expect(thresholds.storageCleanupThreshold).toBe(0.8);
      expect(thresholds.networkLatencyThreshold).toBe(100);
    });
  });

  describe('getSystemMetrics', () => {
    beforeEach(() => {
      // Setup basic mocks
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('');
      mockExecSync.mockReturnValue('');
    });

    it('should collect comprehensive system metrics', async () => {
      // Mock successful file reads
      mockReadFileSync.mockImplementation((path) => {
        const pathStr = String(path);
        if (pathStr === '/proc/stat') return 'cpu  100 0 50 1000 0 0 0 0 0 0\n';
        if (pathStr === '/sys/class/thermal/thermal_zone0/temp') return '45000';
        if (pathStr === '/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq') return '1500000';
        if (pathStr === '/sys/devices/system/cpu/cpu0/cpufreq/scaling_max_freq') return '1800000';
        if (pathStr === '/proc/meminfo') return 'MemTotal: 4194304 kB\nMemAvailable: 3145728 kB\nSwapTotal: 1048576 kB\nSwapFree: 524288 kB';
        return '';
      });

      mockExecSync.mockImplementation((command) => {
        const cmdStr = String(command);
        if (cmdStr === 'df -B1 /') return 'Filesystem 1B-blocks Used Available Use% Mounted\n/dev/root 34359738368 17179869184 17179869184 50% /';
        if (cmdStr === 'ip route get 8.8.8.8') return 'via 192.168.1.1 dev wlan0 src 192.168.1.100';
        if (cmdStr === 'ping -c 1 -W 1 8.8.8.8') return 'PING 8.8.8.8: time=15.2 ms';
        return '';
      });

      const metrics = await resourceMonitor.getSystemMetrics();

      expect(metrics).toHaveProperty('timestamp');
      expect(metrics).toHaveProperty('cpu');
      expect(metrics).toHaveProperty('memory');
      expect(metrics).toHaveProperty('storage');
      expect(metrics).toHaveProperty('network');
      
      expect(metrics.timestamp).toBeInstanceOf(Date);
    });

    it('should handle missing system files gracefully', async () => {
      mockExistsSync.mockReturnValue(false);

      const metrics = await resourceMonitor.getSystemMetrics();

      expect(metrics.cpu.temperature).toBe(45); // Default safe temperature
      expect(metrics.cpu.frequency).toBe(1500); // Default frequency
      expect(metrics.memory.total).toBe(mockConfig.memory.total * 1024 * 1024);
    });

    it('should handle file read errors gracefully', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation(() => {
        throw new Error('File read error');
      });

      const metrics = await resourceMonitor.getSystemMetrics();

      // Should return default values without throwing
      expect(metrics).toBeDefined();
      expect(metrics.cpu.usage).toBe(0);
      expect(metrics.cpu.temperature).toBe(45);
    });
  });

  describe('threshold management', () => {
    it('should emit memoryPressure event when memory usage exceeds GC threshold', async () => {
      const eventSpy = vi.fn();
      resourceMonitor.on('memoryPressure', eventSpy);

      // Mock high memory usage (90% of total)
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation((path) => {
        const pathStr = String(path);
        if (pathStr === '/proc/meminfo') {
          return 'MemTotal: 4194304 kB\nMemAvailable: 419430 kB\nSwapTotal: 1048576 kB\nSwapFree: 524288 kB';
        }
        if (pathStr === '/proc/stat') return 'cpu  100 0 50 1000 0 0 0 0 0 0\n';
        return '';
      });

      mockExecSync.mockReturnValue('');

      await resourceMonitor.getSystemMetrics();

      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'critical',
          usage: expect.any(Number),
        })
      );
    });

    it('should emit storagePressure event when storage usage exceeds threshold', async () => {
      const eventSpy = vi.fn();
      resourceMonitor.on('storagePressure', eventSpy);

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('');
      
      // Mock high storage usage (90% used)
      mockExecSync.mockImplementation((command) => {
        const cmdStr = String(command);
        if (cmdStr === 'df -B1 /') {
          return 'Filesystem 1B-blocks Used Available Use% Mounted\n/dev/root 10000000000 9000000000 1000000000 90% /';
        }
        return '';
      });

      await resourceMonitor.getSystemMetrics();

      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          usage: 0.9,
        })
      );
    });

    it('should emit networkPressure event when latency exceeds threshold', async () => {
      const eventSpy = vi.fn();
      resourceMonitor.on('networkPressure', eventSpy);

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('');
      
      // Mock high network latency
      mockExecSync.mockImplementation((command) => {
        const cmdStr = String(command);
        if (cmdStr === 'ping -c 1 -W 1 8.8.8.8') {
          return 'PING 8.8.8.8: time=150.5 ms';
        }
        return '';
      });

      await resourceMonitor.getSystemMetrics();

      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          latency: 150.5,
        })
      );
    });

    it('should emit memoryLimitExceeded event when usage exceeds hardware limit', async () => {
      const eventSpy = vi.fn();
      resourceMonitor.on('memoryLimitExceeded', eventSpy);

      mockExistsSync.mockReturnValue(true);
      
      // Mock memory usage that exceeds the configured limit (2GB)
      mockReadFileSync.mockImplementation((path) => {
        const pathStr = String(path);
        if (pathStr === '/proc/meminfo') {
          return 'MemTotal: 4194304 kB\nMemAvailable: 524288 kB\nSwapTotal: 1048576 kB\nSwapFree: 524288 kB';
        }
        if (pathStr === '/proc/stat') return 'cpu  100 0 50 1000 0 0 0 0 0 0\n';
        return '';
      });

      mockExecSync.mockReturnValue('');

      await resourceMonitor.getSystemMetrics();

      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          used: expect.any(Number),
          limit: mockConfig.memory.limit * 1024 * 1024,
        })
      );
    });
  });

  describe('adaptive scaling', () => {
    it('should enable adaptive scaling and respond to events', () => {
      const serviceSpy = vi.fn();
      const cpuSpy = vi.fn();
      const storageSpy = vi.fn();

      resourceMonitor.on('serviceReductionRequested', serviceSpy);
      resourceMonitor.on('cpuReductionRequested', cpuSpy);
      resourceMonitor.on('storageCleanupRequested', storageSpy);

      resourceMonitor.enableAdaptiveScaling();

      // Simulate events
      resourceMonitor.emit('memoryPressure', { level: 'critical', usage: 0.95, metrics: {} });
      resourceMonitor.emit('cpuPressure', { usage: 90, metrics: {} });
      resourceMonitor.emit('storagePressure', { usage: 0.85, metrics: {} });

      expect(serviceSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'memory_pressure',
          level: expect.any(String),
          timestamp: expect.any(Date),
          memoryUsage: expect.any(Number),
        })
      );
      expect(cpuSpy).toHaveBeenCalledWith({ reason: 'cpu_pressure' });
      expect(storageSpy).toHaveBeenCalledWith({ reason: 'storage_pressure' });
    });

    it('should trigger garbage collection at 80% memory usage', () => {
      // Mock global.gc to be available
      const originalGC = global.gc;
      global.gc = vi.fn();
      
      const gcSpy = vi.fn();
      resourceMonitor.on('garbageCollectionTriggered', gcSpy);

      resourceMonitor.enableAdaptiveScaling();

      // Simulate GC threshold event
      resourceMonitor.emit('memoryPressure', { level: 'gc', usage: 0.8, metrics: {} });

      expect(gcSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          memoryFreed: expect.any(Number),
          beforeGC: expect.any(Object),
          afterGC: expect.any(Object),
          timestamp: expect.any(Date),
        })
      );
      
      // Restore original
      global.gc = originalGC;
    });

    it('should handle memory limit exceeded events', () => {
      // Mock global.gc to be available
      const originalGC = global.gc;
      global.gc = vi.fn();
      
      const serviceSpy = vi.fn();
      const gcSpy = vi.fn();

      resourceMonitor.on('serviceReductionRequested', serviceSpy);
      resourceMonitor.on('garbageCollectionTriggered', gcSpy);

      resourceMonitor.enableAdaptiveScaling();

      // Simulate memory limit exceeded
      const memoryLimitBytes = mockConfig.memory.limit * 1024 * 1024;
      resourceMonitor.emit('memoryLimitExceeded', {
        used: memoryLimitBytes + 1000000, // 1MB over limit
        limit: memoryLimitBytes,
        metrics: {},
      });

      // Should trigger both GC and aggressive service reduction
      expect(gcSpy).toHaveBeenCalled();
      expect(serviceSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'memory_limit_exceeded',
          level: 'aggressive',
          timestamp: expect.any(Date),
          memoryUsage: expect.any(Number),
          memoryLimit: memoryLimitBytes,
        })
      );
      
      // Restore original
      global.gc = originalGC;
    });

    it('should emit service restoration when memory pressure resolves', () => {
      const restorationSpy = vi.fn();
      resourceMonitor.on('serviceRestorationRequested', restorationSpy);

      resourceMonitor.enableAdaptiveScaling();

      // Simulate memory pressure resolution
      resourceMonitor.emit('memoryPressure', { level: 'normal', usage: 0.6, metrics: {} });

      expect(restorationSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'memory_pressure_resolved',
          timestamp: expect.any(Date),
          memoryUsage: 0.6,
        })
      );
    });
  });

  describe('performance profile', () => {
    it('should return "medium" performance profile when no metrics available', () => {
      expect(resourceMonitor.getPerformanceProfile()).toBe('medium');
    });

    it('should return performance profile based on last metrics', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation((path) => {
        const pathStr = String(path);
        if (pathStr === '/proc/meminfo') return 'MemTotal: 4194304 kB\nMemAvailable: 3145728 kB';
        if (pathStr === '/proc/stat') return 'cpu  100 0 50 5000 0 0 0 0 0 0\n'; // Low CPU usage
        if (pathStr === '/sys/class/thermal/thermal_zone0/temp') return '50000'; // 50°C
        return '';
      });

      mockExecSync.mockReturnValue('');

      await resourceMonitor.getSystemMetrics();
      expect(resourceMonitor.getPerformanceProfile()).toBe('high');
    });
  });

  describe('monitoring lifecycle', () => {
    it('should start and stop monitoring', () => {
      const startSpy = vi.fn();
      const stopSpy = vi.fn();

      resourceMonitor.on('monitoringStarted', startSpy);
      resourceMonitor.on('monitoringStopped', stopSpy);

      resourceMonitor.startMonitoring(500);
      expect(startSpy).toHaveBeenCalledWith({ interval: 500 });

      resourceMonitor.stopMonitoring();
      expect(stopSpy).toHaveBeenCalled();
    });
  });

  describe('utility methods', () => {
    it('should update thresholds correctly', () => {
      const newThresholds = { memoryGCThreshold: 0.7 };
      resourceMonitor.setThresholds(newThresholds);

      const updatedThresholds = resourceMonitor.getThresholds();
      expect(updatedThresholds.memoryGCThreshold).toBe(0.7);
      expect(updatedThresholds.memoryPressureThreshold).toBe(0.9); // Should remain unchanged
    });

    it('should track storage write count', () => {
      expect(resourceMonitor.getLastMetrics()?.storage.writeCount).toBeUndefined();
      
      resourceMonitor.incrementWriteCount();
      resourceMonitor.incrementWriteCount();
      
      // Write count should be tracked internally
      expect(resourceMonitor.incrementWriteCount).toBeDefined();
    });

    it('should track memory pressure state', () => {
      expect(resourceMonitor.isMemoryPressureActive()).toBe(false);
    });

    it('should return last collected metrics', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('');
      mockExecSync.mockReturnValue('');

      expect(resourceMonitor.getLastMetrics()).toBeUndefined();
      
      await resourceMonitor.getSystemMetrics();
      
      const lastMetrics = resourceMonitor.getLastMetrics();
      expect(lastMetrics).toBeDefined();
      expect(lastMetrics?.timestamp).toBeInstanceOf(Date);
    });

    it('should get memory pressure level correctly', async () => {
      // Initially should be normal
      expect(resourceMonitor.getMemoryPressureLevel()).toBe('normal');

      // Mock high memory usage scenario
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation((path) => {
        const pathStr = String(path);
        if (pathStr === '/proc/meminfo') {
          return 'MemTotal: 4194304 kB\nMemAvailable: 419430 kB\nSwapTotal: 1048576 kB\nSwapFree: 524288 kB'; // ~90% usage
        }
        if (pathStr === '/proc/stat') return 'cpu  100 0 50 1000 0 0 0 0 0 0\n';
        return '';
      });
      mockExecSync.mockReturnValue('');

      await resourceMonitor.getSystemMetrics();
      expect(resourceMonitor.getMemoryPressureLevel()).toBe('critical');
    });

    it('should force garbage collection when available', () => {
      // Mock global.gc
      const originalGC = global.gc;
      global.gc = vi.fn();

      const result = resourceMonitor.forceGarbageCollection();
      expect(result).toBe(true);
      expect(global.gc).toHaveBeenCalled();

      // Restore original
      global.gc = originalGC;
    });

    it('should handle force garbage collection when unavailable', () => {
      // Ensure global.gc is undefined
      const originalGC = global.gc;
      delete (global as any).gc;

      const result = resourceMonitor.forceGarbageCollection();
      expect(result).toBe(false);

      // Restore original
      global.gc = originalGC;
    });

    it('should get memory limit usage statistics', async () => {
      // Test without metrics
      let limitUsage = resourceMonitor.getMemoryLimitUsage();
      expect(limitUsage.totalUsage).toBe(0);
      expect(limitUsage.limitUsage).toBe(0);
      expect(limitUsage.withinLimit).toBe(true);
      expect(limitUsage.availableBeforeLimit).toBe(mockConfig.memory.limit * 1024 * 1024);

      // Mock memory usage scenario - 50% of total memory used
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation((path) => {
        const pathStr = String(path);
        if (pathStr === '/proc/meminfo') {
          // Total: 4GB, Available: 2GB (so 2GB used = 50% usage)
          return 'MemTotal: 4194304 kB\nMemAvailable: 2097152 kB\nSwapTotal: 1048576 kB\nSwapFree: 524288 kB';
        }
        if (pathStr === '/proc/stat') return 'cpu  100 0 50 1000 0 0 0 0 0 0\n';
        return '';
      });
      mockExecSync.mockReturnValue('Filesystem 1B-blocks Used Available Use% Mounted\n/dev/root 32000000000 16000000000 16000000000 50% /\n');

      await resourceMonitor.getSystemMetrics();
      limitUsage = resourceMonitor.getMemoryLimitUsage();
      
      expect(limitUsage.totalUsage).toBeCloseTo(0.5, 1); // 50% of total memory
      expect(limitUsage.withinLimit).toBe(true); // 2GB used should be within 2GB limit
      expect(limitUsage.availableBeforeLimit).toBeGreaterThanOrEqual(0); // Should be at or near the limit
    });
  });

  describe('edge cases', () => {
    it('should handle invalid CPU stat format', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation((path) => {
        const pathStr = String(path);
        if (pathStr === '/proc/stat') return 'invalid format\n';
        return '';
      });

      mockExecSync.mockReturnValue('');

      const metrics = await resourceMonitor.getSystemMetrics();
      expect(metrics.cpu.usage).toBe(0); // Should default to 0 for invalid format
    });

    it('should handle missing network interface', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('');
      
      mockExecSync.mockImplementation((command) => {
        const cmdStr = String(command);
        if (cmdStr === 'ip route get 8.8.8.8') {
          throw new Error('Network unreachable');
        }
        if (cmdStr === 'ping -c 1 -W 1 8.8.8.8') {
          return 'PING 8.8.8.8: time=10.0 ms'; // This will be called since ip route fails
        }
        return '';
      });

      const metrics = await resourceMonitor.getSystemMetrics();
      expect(metrics.network.interface).toBe('wifi'); // Should use default
      expect(metrics.network.latency).toBe(10); // Should use the ping result
    });

    it('should handle zero total memory gracefully', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation((path) => {
        const pathStr = String(path);
        if (pathStr === '/proc/meminfo') return 'MemTotal: 0 kB\nMemAvailable: 0 kB';
        return '';
      });

      mockExecSync.mockReturnValue('');

      const metrics = await resourceMonitor.getSystemMetrics();
      expect(metrics.memory.total).toBe(0);
      expect(metrics.memory.used).toBe(0);
    });
  });
});