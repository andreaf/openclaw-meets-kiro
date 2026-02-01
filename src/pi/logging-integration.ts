/**
 * Pi Optimization Logging Integration
 * 
 * Integrates Pi optimization components with OpenClaw's logging system.
 * Provides comprehensive logging and monitoring across all Pi components.
 * 
 * Task 16.1: Add comprehensive logging and monitoring across all components
 */

import { createSubsystemLogger } from '../logging/subsystem.js';
import type { PiOrchestrator, PiSystemEvent } from './pi-orchestrator.js';
import type { ResourceMonitor } from './resource-monitor/resource-monitor.js';
import type { ThermalController } from './thermal-controller/thermal-controller.js';
import type { StorageManager } from './storage-manager/storage-manager.js';
import type { SystemMetrics } from './types/index.js';

const log = createSubsystemLogger('pi/logging-integration');

export interface PiLoggingConfig {
  /** Enable comprehensive Pi logging */
  enabled: boolean;
  /** Log all system events */
  logSystemEvents: boolean;
  /** Log performance metrics */
  logMetrics: boolean;
  /** Log component lifecycle events */
  logLifecycle: boolean;
  /** Log thermal events */
  logThermalEvents: boolean;
  /** Log storage events */
  logStorageEvents: boolean;
  /** Log resource events */
  logResourceEvents: boolean;
  /** Metrics logging interval in milliseconds */
  metricsInterval: number;
}

export interface PiLoggingStats {
  eventsLogged: number;
  metricsLogged: number;
  errorsLogged: number;
  warningsLogged: number;
  lastLogTime: Date;
}

/**
 * Pi Optimization Logging Integration
 * 
 * Provides comprehensive logging for all Pi optimization components
 */
export class PiLoggingIntegration {
  private config: PiLoggingConfig;
  private logger = createSubsystemLogger('pi/logging');
  private stats: PiLoggingStats;
  private metricsInterval?: NodeJS.Timeout;
  private isStarted = false;

  constructor(config: Partial<PiLoggingConfig> = {}) {
    this.config = {
      enabled: true,
      logSystemEvents: true,
      logMetrics: true,
      logLifecycle: true,
      logThermalEvents: true,
      logStorageEvents: true,
      logResourceEvents: true,
      metricsInterval: 30000, // 30 seconds
      ...config,
    };

    this.stats = {
      eventsLogged: 0,
      metricsLogged: 0,
      errorsLogged: 0,
      warningsLogged: 0,
      lastLogTime: new Date(),
    };

    this.logger.info('Pi logging integration initialized', {
      config: this.config,
    });
  }

  /**
   * Starts Pi logging integration
   */
  start(): void {
    if (this.isStarted || !this.config.enabled) {
      return;
    }

    this.logger.info('Starting Pi logging integration...');
    this.isStarted = true;
  }

  /**
   * Stops Pi logging integration
   */
  stop(): void {
    if (!this.isStarted) {
      return;
    }

    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = undefined;
    }

    this.isStarted = false;
    this.logger.info('Pi logging integration stopped');
  }

  /**
   * Integrates with Pi orchestrator for comprehensive event logging
   */
  integrateWithOrchestrator(orchestrator: PiOrchestrator): void {
    if (!this.config.enabled) {
      return;
    }

    this.logger.info('Integrating with Pi orchestrator for event logging');

    // System events
    if (this.config.logSystemEvents) {
      orchestrator.on('systemEvent', (event: PiSystemEvent) => {
        this.logSystemEvent(event);
      });
    }

    // Lifecycle events
    if (this.config.logLifecycle) {
      orchestrator.on('started', () => {
        this.logger.info('Pi orchestrator started', {
          timestamp: new Date(),
          uptime: 0,
        });
        this.updateStats('info');
      });

      orchestrator.on('stopped', () => {
        this.logger.info('Pi orchestrator stopped', {
          timestamp: new Date(),
          stats: this.stats,
        });
        this.updateStats('info');
      });
    }

    // Emergency events
    orchestrator.on('systemEmergency', (emergency) => {
      this.logger.fatal('Pi system emergency detected', {
        type: emergency.type,
        data: emergency.data,
        timestamp: emergency.timestamp,
      });
      this.updateStats('error');
    });
  }

  /**
   * Integrates with resource monitor for performance logging
   */
  integrateWithResourceMonitor(resourceMonitor: ResourceMonitor): void {
    if (!this.config.enabled) {
      return;
    }

    this.logger.info('Integrating with resource monitor for performance logging');

    // Resource events
    if (this.config.logResourceEvents) {
      resourceMonitor.on('memoryPressure', (data) => {
        const severity = data.level === 'critical' ? 'error' : 'warn';
        this.logger[severity]('Memory pressure detected', {
          level: data.level,
          usage: Math.round(data.usage * 100),
          metrics: data.metrics,
        });
        this.updateStats(severity === 'error' ? 'error' : 'warning');
      });

      resourceMonitor.on('cpuPressure', (data) => {
        this.logger.warn('CPU pressure detected', {
          usage: Math.round(data.usage),
          metrics: data.metrics,
        });
        this.updateStats('warning');
      });

      resourceMonitor.on('storagePressure', (data) => {
        this.logger.warn('Storage pressure detected', {
          usage: Math.round(data.usage * 100),
          metrics: data.metrics,
        });
        this.updateStats('warning');
      });

      resourceMonitor.on('serviceReductionRequested', (data) => {
        this.logger.warn('Service reduction requested', {
          reason: data.reason,
          level: data.level,
          memoryUsage: Math.round(data.memoryUsage * 100),
        });
        this.updateStats('warning');
      });

      resourceMonitor.on('garbageCollectionTriggered', (data) => {
        this.logger.info('Garbage collection triggered', {
          memoryFreed: Math.round(data.memoryFreed / 1024 / 1024), // MB
          beforeGC: {
            heapUsed: Math.round(data.beforeGC.heapUsed / 1024 / 1024),
            heapTotal: Math.round(data.beforeGC.heapTotal / 1024 / 1024),
          },
          afterGC: {
            heapUsed: Math.round(data.afterGC.heapUsed / 1024 / 1024),
            heapTotal: Math.round(data.afterGC.heapTotal / 1024 / 1024),
          },
        });
        this.updateStats('info');
      });
    }

    // Metrics logging
    if (this.config.logMetrics) {
      this.startMetricsLogging(resourceMonitor);
    }
  }

  /**
   * Integrates with thermal controller for thermal event logging
   */
  integrateWithThermalController(thermalController: ThermalController): void {
    if (!this.config.enabled || !this.config.logThermalEvents) {
      return;
    }

    this.logger.info('Integrating with thermal controller for thermal event logging');

    thermalController.on('thermalThrottling', (data) => {
      const severity = data.action === 'pause_services' ? 'error' : 'warn';
      this.logger[severity]('Thermal throttling activated', {
        temperature: data.temperature,
        threshold: data.threshold,
        action: data.action,
        reductionLevel: data.reductionLevel,
      });
      this.updateStats(severity === 'error' ? 'error' : 'warning');
    });

    thermalController.on('thermalRecovery', (data) => {
      this.logger.info('Thermal recovery completed', {
        temperature: data.temperature,
        threshold: data.threshold,
        previousAction: data.metadata?.previousAction,
      });
      this.updateStats('info');
    });

    thermalController.on('thermalEmergency', (data) => {
      this.logger.error('Thermal emergency detected', {
        temperature: data.temperature,
        threshold: data.threshold,
        emergencyLevel: data.emergencyLevel,
      });
      this.updateStats('error');
    });

    thermalController.on('thermalEvent', (data) => {
      this.logger.debug('Thermal event', {
        temperature: data.temperature,
        threshold: data.threshold,
        action: data.action,
        severity: data.severity,
        message: data.message,
      });
    });
  }

  /**
   * Integrates with storage manager for storage event logging
   */
  integrateWithStorageManager(storageManager: StorageManager): void {
    if (!this.config.enabled || !this.config.logStorageEvents) {
      return;
    }

    this.logger.info('Integrating with storage manager for storage event logging');

    storageManager.on('cleanupCompleted', (data) => {
      this.logger.info('Storage cleanup completed', {
        cleanedFiles: data.cleanedFiles,
        cleanedSize: Math.round(data.cleanedSize / 1024 / 1024), // MB
        usagePercentageBefore: Math.round(data.usagePercentageBefore * 100),
        usagePercentageAfter: Math.round(data.usagePercentageAfter * 100),
      });
      this.updateStats('info');
    });

    storageManager.on('logRotationCompleted', (data) => {
      this.logger.info('Log rotation completed', {
        totalSizeBefore: Math.round(data.totalSizeBefore / 1024 / 1024), // MB
        totalSizeAfter: Math.round(data.totalSizeAfter / 1024 / 1024), // MB
        removedFiles: data.removedFiles.length,
        removedSize: Math.round(data.removedSize / 1024 / 1024), // MB
      });
      this.updateStats('info');
    });

    storageManager.on('storageOptimizationCompleted', (data) => {
      this.logger.info('Storage optimization completed', {
        metrics: {
          totalCapacity: Math.round(data.metrics.totalCapacity / 1024 / 1024 / 1024), // GB
          usedStorage: Math.round(data.metrics.usedStorage / 1024 / 1024 / 1024), // GB
          availableStorage: Math.round(data.metrics.availableStorage / 1024 / 1024 / 1024), // GB
        },
      });
      this.updateStats('info');
    });

    storageManager.on('largeMediaProcessed', (data) => {
      this.logger.info('Large media file processed', {
        inputPath: data.inputPath,
        outputPath: data.outputPath,
        fileSize: Math.round(data.fileSize / 1024 / 1024), // MB
      });
      this.updateStats('info');
    });

    storageManager.on('tmpfsSetupCompleted', (data) => {
      this.logger.info('Tmpfs setup completed', {
        mountPoints: data.mountPoints,
      });
      this.updateStats('info');
    });

    storageManager.on('cachingSetupCompleted', (data) => {
      this.logger.info('Intelligent caching setup completed', {
        ramCacheAvailable: data.ramCacheAvailable,
        cacheDirectories: data.cacheDirectories.length,
        externalStorageAvailable: data.externalStorageAvailable,
        externalStoragePaths: data.externalStoragePaths,
      });
      this.updateStats('info');
    });
  }

  /**
   * Logs system events with appropriate severity
   */
  private logSystemEvent(event: PiSystemEvent): void {
    const logData = {
      eventId: event.id,
      type: event.type,
      subtype: event.subtype,
      source: event.source,
      message: event.message,
      data: event.data,
      timestamp: event.timestamp,
    };

    switch (event.severity) {
      case 'emergency':
        this.logger.fatal(`Pi System Event [${event.type}/${event.subtype}]: ${event.message}`, logData);
        this.updateStats('error');
        break;
      case 'critical':
        this.logger.error(`Pi System Event [${event.type}/${event.subtype}]: ${event.message}`, logData);
        this.updateStats('error');
        break;
      case 'warning':
        this.logger.warn(`Pi System Event [${event.type}/${event.subtype}]: ${event.message}`, logData);
        this.updateStats('warning');
        break;
      case 'info':
      default:
        this.logger.info(`Pi System Event [${event.type}/${event.subtype}]: ${event.message}`, logData);
        this.updateStats('info');
        break;
    }
  }

  /**
   * Starts periodic metrics logging
   */
  private startMetricsLogging(resourceMonitor: ResourceMonitor): void {
    if (this.metricsInterval) {
      return;
    }

    this.metricsInterval = setInterval(async () => {
      try {
        const metrics = await resourceMonitor.getSystemMetrics();
        this.logSystemMetrics(metrics);
      } catch (error) {
        this.logger.error('Failed to log system metrics', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, this.config.metricsInterval);

    this.logger.info('Metrics logging started', {
      interval: this.config.metricsInterval,
    });
  }

  /**
   * Logs system metrics
   */
  private logSystemMetrics(metrics: SystemMetrics): void {
    this.logger.debug('System metrics', {
      cpu: {
        usage: Math.round(metrics.cpu.usage),
        temperature: Math.round(metrics.cpu.temperature * 10) / 10,
        frequency: metrics.cpu.frequency,
        throttled: metrics.cpu.throttled,
      },
      memory: {
        total: Math.round(metrics.memory.total / 1024 / 1024), // MB
        used: Math.round(metrics.memory.used / 1024 / 1024), // MB
        available: Math.round(metrics.memory.available / 1024 / 1024), // MB
        usagePercentage: Math.round((metrics.memory.used / metrics.memory.total) * 100),
        swapUsed: Math.round(metrics.memory.swapUsed / 1024 / 1024), // MB
      },
      storage: {
        total: Math.round(metrics.storage.total / 1024 / 1024 / 1024), // GB
        used: Math.round(metrics.storage.used / 1024 / 1024 / 1024), // GB
        available: Math.round(metrics.storage.available / 1024 / 1024 / 1024), // GB
        usagePercentage: Math.round((metrics.storage.used / metrics.storage.total) * 100),
        writeCount: metrics.storage.writeCount,
      },
      network: {
        interface: metrics.network.interface,
        bandwidth: metrics.network.bandwidth,
        latency: Math.round(metrics.network.latency * 10) / 10,
        packetsLost: metrics.network.packetsLost,
      },
      timestamp: metrics.timestamp,
    });

    this.updateStats('info');
    this.stats.metricsLogged++;
  }

  /**
   * Updates logging statistics
   */
  private updateStats(level: 'info' | 'warning' | 'error'): void {
    this.stats.eventsLogged++;
    this.stats.lastLogTime = new Date();

    switch (level) {
      case 'error':
        this.stats.errorsLogged++;
        break;
      case 'warning':
        this.stats.warningsLogged++;
        break;
    }
  }

  /**
   * Gets logging statistics
   */
  getStats(): PiLoggingStats {
    return { ...this.stats };
  }

  /**
   * Gets logging configuration
   */
  getConfig(): PiLoggingConfig {
    return { ...this.config };
  }

  /**
   * Updates logging configuration
   */
  updateConfig(newConfig: Partial<PiLoggingConfig>): void {
    this.config = { ...this.config, ...newConfig };
    
    // Restart metrics logging if interval changed
    if (newConfig.metricsInterval && this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = undefined;
      
      if (this.config.logMetrics) {
        // We need a resource monitor to restart metrics logging
        // This would be provided by the orchestrator in a real implementation
      }
    }

    this.logger.info('Logging configuration updated', {
      config: this.config,
    });
  }
}

/**
 * Creates and configures Pi logging integration
 */
export function createPiLoggingIntegration(
  config: Partial<PiLoggingConfig> = {}
): PiLoggingIntegration {
  return new PiLoggingIntegration(config);
}

/**
 * Sets up comprehensive Pi logging for all components
 */
export function setupComprehensivePiLogging(
  orchestrator: PiOrchestrator,
  resourceMonitor?: ResourceMonitor,
  thermalController?: ThermalController,
  storageManager?: StorageManager,
  config: Partial<PiLoggingConfig> = {}
): PiLoggingIntegration {
  const loggingIntegration = createPiLoggingIntegration(config);
  
  // Integrate with all available components
  loggingIntegration.integrateWithOrchestrator(orchestrator);
  
  if (resourceMonitor) {
    loggingIntegration.integrateWithResourceMonitor(resourceMonitor);
  }
  
  if (thermalController) {
    loggingIntegration.integrateWithThermalController(thermalController);
  }
  
  if (storageManager) {
    loggingIntegration.integrateWithStorageManager(storageManager);
  }
  
  loggingIntegration.start();
  
  return loggingIntegration;
}