/**
 * Resource Monitor Implementation
 * 
 * Provides comprehensive system resource monitoring and adaptive scaling for Raspberry Pi.
 * Implements CPU, memory, disk I/O, and network monitoring with hardware-specific
 * memory limit detection and enforcement.
 */

import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { SystemMetrics } from '../types/index.js';
import type { PiConfiguration } from '../types/pi-configuration.js';

export interface ResourceThresholds {
  /** Memory usage threshold (0-1) that triggers garbage collection */
  memoryGCThreshold: number;
  /** Memory usage threshold (0-1) that triggers service reduction */
  memoryPressureThreshold: number;
  /** CPU usage threshold (0-1) that triggers performance alerts */
  cpuUsageThreshold: number;
  /** Storage usage threshold (0-1) that triggers cleanup */
  storageCleanupThreshold: number;
  /** Network latency threshold (ms) that triggers optimization */
  networkLatencyThreshold: number;
}

export class ResourceMonitor extends EventEmitter {
  private config: PiConfiguration;
  private monitoringInterval?: NodeJS.Timeout;
  private thresholds: ResourceThresholds;
  private lastMetrics?: SystemMetrics;
  private memoryPressureActive = false;
  private storageWriteCount = 0;

  constructor(config: PiConfiguration, thresholds?: Partial<ResourceThresholds>) {
    super();
    this.config = config;
    this.thresholds = {
      memoryGCThreshold: 0.8,
      memoryPressureThreshold: 0.9,
      cpuUsageThreshold: 0.85,
      storageCleanupThreshold: 0.8,
      networkLatencyThreshold: 100,
      ...thresholds,
    };
  }

  /**
   * Gets current comprehensive system metrics
   */
  async getSystemMetrics(): Promise<SystemMetrics> {
    const timestamp = new Date();
    
    const [cpu, memory, storage, network] = await Promise.all([
      this.getCPUMetrics(),
      this.getMemoryMetrics(),
      this.getStorageMetrics(),
      this.getNetworkMetrics(),
    ]);

    const metrics: SystemMetrics = {
      timestamp,
      cpu,
      memory,
      storage,
      network,
    };

    this.lastMetrics = metrics;
    this.checkThresholds(metrics);
    
    return metrics;
  }

  /**
   * Gets CPU-related metrics including usage, temperature, frequency, and throttling status
   */
  private async getCPUMetrics(): Promise<SystemMetrics['cpu']> {
    const usage = await this.getCPUUsage();
    const temperature = this.getCPUTemperature();
    const frequency = this.getCPUFrequency();
    const throttled = this.getCPUThrottleStatus();

    return {
      usage,
      temperature,
      frequency,
      throttled,
    };
  }

  /**
   * Calculates CPU usage percentage by reading /proc/stat
   */
  private async getCPUUsage(): Promise<number> {
    try {
      if (!existsSync('/proc/stat')) {
        return 0;
      }

      const stat1 = this.readCPUStat();
      await new Promise(resolve => setTimeout(resolve, 100)); // 100ms sample
      const stat2 = this.readCPUStat();

      const idle1 = stat1.idle + stat1.iowait;
      const idle2 = stat2.idle + stat2.iowait;
      const total1 = stat1.user + stat1.nice + stat1.system + stat1.idle + stat1.iowait + stat1.irq + stat1.softirq;
      const total2 = stat2.user + stat2.nice + stat2.system + stat2.idle + stat2.iowait + stat2.irq + stat2.softirq;

      const totalDiff = total2 - total1;
      const idleDiff = idle2 - idle1;

      if (totalDiff === 0) return 0;
      
      return Math.max(0, Math.min(100, ((totalDiff - idleDiff) / totalDiff) * 100));
    } catch (error) {
      console.warn('Failed to read CPU usage:', error);
      return 0;
    }
  }

  /**
   * Reads CPU statistics from /proc/stat
   */
  private readCPUStat(): { user: number; nice: number; system: number; idle: number; iowait: number; irq: number; softirq: number } {
    const statContent = readFileSync('/proc/stat', 'utf8');
    const cpuLine = statContent.split('\n')[0];
    const values = cpuLine.split(/\s+/).slice(1).map(Number);
    
    return {
      user: values[0] || 0,
      nice: values[1] || 0,
      system: values[2] || 0,
      idle: values[3] || 0,
      iowait: values[4] || 0,
      irq: values[5] || 0,
      softirq: values[6] || 0,
    };
  }

  /**
   * Gets CPU temperature from thermal zone
   */
  private getCPUTemperature(): number {
    try {
      const thermalPath = '/sys/class/thermal/thermal_zone0/temp';
      if (!existsSync(thermalPath)) {
        return 45; // Default safe temperature
      }
      
      const tempStr = readFileSync(thermalPath, 'utf8').trim();
      const tempMilliC = parseInt(tempStr, 10);
      return tempMilliC / 1000; // Convert from millicelsius to celsius
    } catch (error) {
      console.warn('Failed to read CPU temperature:', error);
      return 45;
    }
  }

  /**
   * Gets current CPU frequency
   */
  private getCPUFrequency(): number {
    try {
      const freqPath = '/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq';
      if (!existsSync(freqPath)) {
        return 1500; // Default frequency in MHz
      }
      
      const freqStr = readFileSync(freqPath, 'utf8').trim();
      const freqKHz = parseInt(freqStr, 10);
      return Math.round(freqKHz / 1000); // Convert from KHz to MHz
    } catch (error) {
      console.warn('Failed to read CPU frequency:', error);
      return 1500;
    }
  }

  /**
   * Checks if CPU is currently throttled
   */
  private getCPUThrottleStatus(): boolean {
    try {
      // Check for throttling indicators in various locations
      const throttlePath = '/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq';
      const maxFreqPath = '/sys/devices/system/cpu/cpu0/cpufreq/scaling_max_freq';
      
      if (!existsSync(throttlePath) || !existsSync(maxFreqPath)) {
        return false;
      }
      
      const currentFreq = parseInt(readFileSync(throttlePath, 'utf8').trim(), 10);
      const maxFreq = parseInt(readFileSync(maxFreqPath, 'utf8').trim(), 10);
      
      // Consider throttled if current frequency is significantly below max (less than 90%)
      return currentFreq < (maxFreq * 0.9);
    } catch (error) {
      console.warn('Failed to check CPU throttle status:', error);
      return false;
    }
  }

  /**
   * Gets memory-related metrics with hardware-specific limits
   */
  private getMemoryMetrics(): SystemMetrics['memory'] {
    try {
      if (!existsSync('/proc/meminfo')) {
        return {
          total: this.config.memory.total * 1024 * 1024,
          used: 0,
          available: this.config.memory.total * 1024 * 1024,
          swapUsed: 0,
        };
      }

      const memInfo = readFileSync('/proc/meminfo', 'utf8');
      const lines = memInfo.split('\n');
      
      const getMemValue = (key: string): number => {
        const line = lines.find(l => l.startsWith(key));
        if (!line) return 0;
        const match = line.match(/(\d+)/);
        return match ? parseInt(match[1], 10) * 1024 : 0; // Convert KB to bytes
      };

      const total = getMemValue('MemTotal:');
      const available = getMemValue('MemAvailable:');
      const swapTotal = getMemValue('SwapTotal:');
      const swapFree = getMemValue('SwapFree:');
      
      const used = total - available;
      const swapUsed = swapTotal - swapFree;

      return {
        total,
        used,
        available,
        swapUsed,
      };
    } catch (error) {
      console.warn('Failed to read memory metrics:', error);
      return {
        total: this.config.memory.total * 1024 * 1024,
        used: 0,
        available: this.config.memory.total * 1024 * 1024,
        swapUsed: 0,
      };
    }
  }

  /**
   * Gets storage-related metrics including wear leveling tracking
   */
  private getStorageMetrics(): SystemMetrics['storage'] {
    try {
      // Use df command for more accurate filesystem statistics
      const dfOutput = execSync('df -B1 /', { encoding: 'utf8' });
      const dfLines = dfOutput.split('\n');
      const dfLine = dfLines.length > 1 ? dfLines[1] : '';
      
      if (!dfLine) {
        throw new Error('No df output available');
      }
      
      const dfValues = dfLine.split(/\s+/);
      
      const total = parseInt(dfValues[1] || '0', 10);
      const used = parseInt(dfValues[2] || '0', 10);
      const available = parseInt(dfValues[3] || '0', 10);

      return {
        total,
        used,
        available,
        writeCount: this.storageWriteCount,
      };
    } catch (error) {
      console.warn('Failed to read storage metrics:', error);
      return {
        total: 32 * 1024 * 1024 * 1024, // 32GB default
        used: 0,
        available: 32 * 1024 * 1024 * 1024,
        writeCount: this.storageWriteCount,
      };
    }
  }

  /**
   * Gets network-related metrics
   */
  private getNetworkMetrics(): SystemMetrics['network'] {
    try {
      // Determine active interface
      const routeOutput = execSync('ip route get 8.8.8.8', { encoding: 'utf8' });
      const interfaceMatch = routeOutput.match(/dev (\w+)/);
      const activeInterface = interfaceMatch ? interfaceMatch[1] : 'unknown';
      
      // Determine interface type
      let interfaceType: 'wifi' | 'ethernet' = 'ethernet';
      if (activeInterface.startsWith('wlan') || activeInterface.startsWith('wlp')) {
        interfaceType = 'wifi';
      }

      // Get basic network statistics
      const bandwidth = this.estimateBandwidth(activeInterface);
      const latency = this.measureLatency();
      const packetsLost = this.getPacketLoss(activeInterface);

      return {
        interface: interfaceType,
        bandwidth,
        latency,
        packetsLost,
      };
    } catch (error) {
      console.warn('Failed to read network metrics:', error);
      return {
        interface: 'wifi',
        bandwidth: 100,
        latency: 10,
        packetsLost: 0,
      };
    }
  }

  /**
   * Estimates available bandwidth for the given interface
   */
  private estimateBandwidth(interfaceName: string): number {
    try {
      // Read interface speed if available
      const speedPath = `/sys/class/net/${interfaceName}/speed`;
      if (existsSync(speedPath)) {
        const speedStr = readFileSync(speedPath, 'utf8').trim();
        const speedMbps = parseInt(speedStr, 10);
        return speedMbps > 0 ? speedMbps : 100;
      }
      
      // Default estimates based on interface type
      if (interfaceName.startsWith('wlan')) {
        return 150; // Typical WiFi speed
      } else if (interfaceName.startsWith('eth')) {
        return 1000; // Gigabit Ethernet
      }
      
      return 100; // Conservative default
    } catch (error) {
      return 100;
    }
  }

  /**
   * Measures network latency to a reliable host
   */
  private measureLatency(): number {
    try {
      const pingOutput = execSync('ping -c 1 -W 1 8.8.8.8', { encoding: 'utf8' });
      const latencyMatch = pingOutput.match(/time=([0-9.]+)/);
      return latencyMatch ? parseFloat(latencyMatch[1]) : 10;
    } catch (error) {
      return 100; // High latency indicates network issues
    }
  }

  /**
   * Gets packet loss statistics for the given interface
   */
  private getPacketLoss(interfaceName: string): number {
    try {
      const netstatPath = `/sys/class/net/${interfaceName}/statistics`;
      if (!existsSync(netstatPath)) {
        return 0;
      }
      
      const rxDropped = parseInt(readFileSync(`${netstatPath}/rx_dropped`, 'utf8').trim(), 10);
      const rxErrors = parseInt(readFileSync(`${netstatPath}/rx_errors`, 'utf8').trim(), 10);
      
      return rxDropped + rxErrors;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Checks resource thresholds and emits appropriate events
   */
  private checkThresholds(metrics: SystemMetrics): void {
    const memoryUsageRatio = metrics.memory.used / metrics.memory.total;
    const storageUsageRatio = metrics.storage.used / metrics.storage.total;
    
    // Check memory thresholds
    if (memoryUsageRatio >= this.thresholds.memoryGCThreshold && !this.memoryPressureActive) {
      this.emit('memoryPressure', { level: 'gc', usage: memoryUsageRatio, metrics });
      
      if (memoryUsageRatio >= this.thresholds.memoryPressureThreshold) {
        this.memoryPressureActive = true;
        this.emit('memoryPressure', { level: 'critical', usage: memoryUsageRatio, metrics });
      }
    } else if (memoryUsageRatio < this.thresholds.memoryGCThreshold && this.memoryPressureActive) {
      this.memoryPressureActive = false;
      this.emit('memoryPressure', { level: 'normal', usage: memoryUsageRatio, metrics });
    }

    // Check CPU threshold
    if (metrics.cpu.usage >= this.thresholds.cpuUsageThreshold * 100) {
      this.emit('cpuPressure', { usage: metrics.cpu.usage, metrics });
    }

    // Check storage threshold
    if (storageUsageRatio >= this.thresholds.storageCleanupThreshold) {
      this.emit('storagePressure', { usage: storageUsageRatio, metrics });
    }

    // Check network threshold
    if (metrics.network.latency >= this.thresholds.networkLatencyThreshold) {
      this.emit('networkPressure', { latency: metrics.network.latency, metrics });
    }

    // Check if memory usage exceeds hardware-specific limits
    const memoryLimitBytes = this.config.memory.limit * 1024 * 1024;
    if (metrics.memory.used > memoryLimitBytes) {
      this.emit('memoryLimitExceeded', { 
        used: metrics.memory.used, 
        limit: memoryLimitBytes, 
        metrics 
      });
    }
  }

  /**
   * Sets new resource thresholds
   */
  setThresholds(newThresholds: Partial<ResourceThresholds>): void {
    this.thresholds = { ...this.thresholds, ...newThresholds };
    this.emit('thresholdsUpdated', this.thresholds);
  }

  /**
   * Gets current resource thresholds
   */
  getThresholds(): ResourceThresholds {
    return { ...this.thresholds };
  }

  /**
   * Enables adaptive scaling based on resource availability
   * Implements memory pressure response system (Requirements 2.4, 2.5)
   */
  enableAdaptiveScaling(): void {
    // Memory pressure response system
    this.on('memoryPressure', (event) => {
      if (event.level === 'gc') {
        // Trigger garbage collection at 80% memory usage (Requirement 2.4)
        this.triggerGarbageCollection();
      } else if (event.level === 'critical') {
        // Graceful service reduction under memory pressure (Requirement 2.5)
        this.reduceNonEssentialServices();
      } else if (event.level === 'normal') {
        // Memory pressure has subsided, notify that services can be restored
        this.emit('serviceRestorationRequested', {
          reason: 'memory_pressure_resolved',
          timestamp: new Date(),
          memoryUsage: event.usage,
        });
      }
    });

    // CPU pressure response
    this.on('cpuPressure', () => {
      this.reduceCPUIntensiveOperations();
    });

    // Storage pressure response
    this.on('storagePressure', () => {
      this.triggerStorageCleanup();
    });

    // Memory limit exceeded response
    this.on('memoryLimitExceeded', (event) => {
      console.warn(`Memory usage (${Math.round(event.used / 1024 / 1024)}MB) exceeds configured limit (${Math.round(event.limit / 1024 / 1024)}MB)`);
      
      // Immediate garbage collection when limit is exceeded
      this.triggerGarbageCollection();
      
      // Aggressive service reduction
      this.emit('serviceReductionRequested', {
        reason: 'memory_limit_exceeded',
        level: 'aggressive',
        timestamp: new Date(),
        memoryUsage: event.used / (this.lastMetrics?.memory.total || event.used),
        memoryLimit: event.limit,
      });
    });

    this.emit('adaptiveScalingEnabled');
  }

  /**
   * Gets the current performance profile based on resource usage
   */
  getPerformanceProfile(): 'high' | 'medium' | 'low' | 'critical' {
    if (!this.lastMetrics) {
      return 'medium';
    }

    const memoryUsage = this.lastMetrics.memory.used / this.lastMetrics.memory.total;
    const cpuUsage = this.lastMetrics.cpu.usage / 100;
    const temperature = this.lastMetrics.cpu.temperature;

    if (memoryUsage > 0.9 || cpuUsage > 0.9 || temperature > 80) {
      return 'critical';
    } else if (memoryUsage > 0.7 || cpuUsage > 0.7 || temperature > 75) {
      return 'low';
    } else if (memoryUsage > 0.5 || cpuUsage > 0.5 || temperature > 65) {
      return 'medium';
    } else {
      return 'high';
    }
  }

  /**
   * Starts continuous resource monitoring
   */
  startMonitoring(intervalMs: number = 1000): void {
    if (this.monitoringInterval) {
      this.stopMonitoring();
    }

    this.monitoringInterval = setInterval(async () => {
      try {
        await this.getSystemMetrics();
      } catch (error) {
        console.error('Error during resource monitoring:', error);
        this.emit('monitoringError', error);
      }
    }, intervalMs);

    this.emit('monitoringStarted', { interval: intervalMs });
  }

  /**
   * Stops resource monitoring
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
      this.emit('monitoringStopped');
    }
  }

  /**
   * Triggers garbage collection to free memory
   * Implements automatic GC triggering at 80% memory usage (Requirement 2.4)
   */
  private triggerGarbageCollection(): void {
    try {
      if (global.gc) {
        const beforeGC = process.memoryUsage();
        global.gc();
        const afterGC = process.memoryUsage();
        
        const memoryFreed = beforeGC.heapUsed - afterGC.heapUsed;
        this.emit('garbageCollectionTriggered', {
          memoryFreed,
          beforeGC,
          afterGC,
          timestamp: new Date(),
        });
        
        console.log(`Garbage collection freed ${Math.round(memoryFreed / 1024 / 1024)}MB of memory`);
      } else {
        console.warn('Garbage collection not available - run with --expose-gc flag');
        this.emit('garbageCollectionUnavailable');
      }
    } catch (error) {
      console.warn('Failed to trigger garbage collection:', error);
      this.emit('garbageCollectionError', error);
    }
  }

  /**
   * Reduces non-essential services under memory pressure
   * Implements graceful service reduction (Requirement 2.5)
   */
  private reduceNonEssentialServices(): void {
    const reductionLevel = this.determineServiceReductionLevel();
    
    this.emit('serviceReductionRequested', { 
      reason: 'memory_pressure',
      level: reductionLevel,
      timestamp: new Date(),
      memoryUsage: this.lastMetrics ? this.lastMetrics.memory.used / this.lastMetrics.memory.total : 0,
    });
    
    console.log(`Reducing non-essential services - level: ${reductionLevel}`);
  }

  /**
   * Determines the appropriate level of service reduction based on memory pressure
   */
  private determineServiceReductionLevel(): 'light' | 'moderate' | 'aggressive' {
    if (!this.lastMetrics) return 'light';
    
    const memoryUsageRatio = this.lastMetrics.memory.used / this.lastMetrics.memory.total;
    const memoryLimitBytes = this.config.memory.limit * 1024 * 1024;
    const limitUsageRatio = this.lastMetrics.memory.used / memoryLimitBytes;
    
    // Aggressive reduction if we're over the hardware limit or very high usage
    if (limitUsageRatio > 1.0 || memoryUsageRatio > 0.95) {
      return 'aggressive';
    }
    // Moderate reduction for high memory pressure
    else if (memoryUsageRatio > 0.9 || limitUsageRatio > 0.9) {
      return 'moderate';
    }
    // Light reduction for initial memory pressure
    else {
      return 'light';
    }
  }

  /**
   * Reduces CPU-intensive operations under high CPU load
   */
  private reduceCPUIntensiveOperations(): void {
    this.emit('cpuReductionRequested', { reason: 'cpu_pressure' });
  }

  /**
   * Triggers storage cleanup when storage is low
   */
  private triggerStorageCleanup(): void {
    this.emit('storageCleanupRequested', { reason: 'storage_pressure' });
  }

  /**
   * Increments the storage write count for wear leveling tracking
   */
  incrementWriteCount(): void {
    this.storageWriteCount++;
  }

  /**
   * Gets the last collected metrics
   */
  getLastMetrics(): SystemMetrics | undefined {
    return this.lastMetrics;
  }

  /**
   * Checks if the system is currently under memory pressure
   */
  isMemoryPressureActive(): boolean {
    return this.memoryPressureActive;
  }

  /**
   * Gets current memory pressure level
   */
  getMemoryPressureLevel(): 'normal' | 'gc' | 'critical' {
    if (!this.lastMetrics) return 'normal';
    
    const memoryUsageRatio = this.lastMetrics.memory.used / this.lastMetrics.memory.total;
    
    if (memoryUsageRatio >= this.thresholds.memoryPressureThreshold) {
      return 'critical';
    } else if (memoryUsageRatio >= this.thresholds.memoryGCThreshold) {
      return 'gc';
    } else {
      return 'normal';
    }
  }

  /**
   * Forces garbage collection (for testing and emergency situations)
   */
  forceGarbageCollection(): boolean {
    try {
      if (global.gc) {
        this.triggerGarbageCollection();
        return true;
      }
      return false;
    } catch (error) {
      console.warn('Failed to force garbage collection:', error);
      return false;
    }
  }

  /**
   * Gets memory usage statistics relative to configured limits
   */
  getMemoryLimitUsage(): {
    totalUsage: number;
    limitUsage: number;
    withinLimit: boolean;
    availableBeforeLimit: number;
  } {
    if (!this.lastMetrics) {
      return {
        totalUsage: 0,
        limitUsage: 0,
        withinLimit: true,
        availableBeforeLimit: this.config.memory.limit * 1024 * 1024,
      };
    }

    const memoryLimitBytes = this.config.memory.limit * 1024 * 1024;
    const totalUsage = this.lastMetrics.memory.used / this.lastMetrics.memory.total;
    const limitUsage = this.lastMetrics.memory.used / memoryLimitBytes;
    const withinLimit = this.lastMetrics.memory.used <= memoryLimitBytes;
    const availableBeforeLimit = Math.max(0, memoryLimitBytes - this.lastMetrics.memory.used);

    return {
      totalUsage,
      limitUsage,
      withinLimit,
      availableBeforeLimit,
    };
  }
}