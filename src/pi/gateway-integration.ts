/**
 * Pi Optimization Gateway Integration
 * 
 * Integrates Pi-specific optimization components with OpenClaw Gateway service.
 * Provides resource monitoring, thermal management, and storage optimization
 * for the Gateway WebSocket service and dashboard.
 * 
 * Requirements: 9.3 - Pi-specific performance monitoring to Gateway dashboard
 */

import { EventEmitter } from 'node:events';
import { createSubsystemLogger } from '../logging/subsystem.js';
import { ResourceMonitor } from './resource-monitor/resource-monitor.js';
import { ThermalController } from './thermal-controller/thermal-controller.js';
import { StorageManager } from './storage-manager/storage-manager.js';
import type { PiConfiguration } from './types/pi-configuration.js';
import type { ThermalPolicy } from './types/thermal-policy.js';
import type { SystemMetrics } from './types/index.js';

export interface PiGatewayIntegrationConfig {
  /** Enable Pi optimization integration */
  enabled: boolean;
  /** Resource monitoring configuration */
  resourceMonitoring: {
    enabled: boolean;
    interval: number; // Monitoring interval in milliseconds
    broadcastMetrics: boolean; // Broadcast metrics to Gateway dashboard
  };
  /** Thermal management configuration */
  thermalManagement: {
    enabled: boolean;
    notifyGateway: boolean; // Send thermal events to Gateway
  };
  /** Storage optimization configuration */
  storageOptimization: {
    enabled: boolean;
    monitoringEnabled: boolean;
  };
}

export interface PiGatewayMetrics {
  /** System resource metrics */
  system: SystemMetrics;
  /** Thermal status */
  thermal: {
    temperature: number;
    throttling: boolean;
    action?: string;
  };
  /** Storage metrics */
  storage: {
    usage: number;
    available: number;
    logSize: number;
    cacheSize: number;
  };
  /** Pi-specific information */
  pi: {
    model: string;
    architecture: string;
    memoryLimit: number;
    wearLevelingEnabled: boolean;
  };
  /** Last update timestamp */
  timestamp: Date;
}

export interface PiGatewayEvent {
  type: 'resource_alert' | 'thermal_event' | 'storage_cleanup' | 'optimization_applied';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  data: Record<string, unknown>;
  timestamp: Date;
}

/**
 * Pi Optimization Gateway Integration
 * 
 * Integrates Pi optimization components with OpenClaw Gateway service
 */
export class PiGatewayIntegration extends EventEmitter {
  private config: PiGatewayIntegrationConfig;
  private piConfig: PiConfiguration;
  private logger = createSubsystemLogger('pi/gateway-integration');
  
  // Pi optimization components
  private resourceMonitor?: ResourceMonitor;
  private thermalController?: ThermalController;
  private storageManager?: StorageManager;
  
  // Integration state
  private isStarted = false;
  private metricsInterval?: NodeJS.Timeout;
  private lastMetrics?: PiGatewayMetrics;
  private eventHistory: PiGatewayEvent[] = [];
  private readonly maxEventHistory = 100;

  constructor(
    piConfig: PiConfiguration,
    integrationConfig: Partial<PiGatewayIntegrationConfig> = {}
  ) {
    super();
    this.piConfig = piConfig;
    this.config = {
      enabled: true,
      resourceMonitoring: {
        enabled: true,
        interval: 5000, // 5 seconds
        broadcastMetrics: true,
      },
      thermalManagement: {
        enabled: true,
        notifyGateway: true,
      },
      storageOptimization: {
        enabled: true,
        monitoringEnabled: true,
      },
      ...integrationConfig,
    };

    this.logger.info('Pi Gateway integration initialized', {
      piModel: piConfig.model,
      architecture: piConfig.architecture,
      memoryLimit: piConfig.memory.limit,
      config: this.config,
    });
  }

  /**
   * Starts Pi optimization integration with Gateway
   */
  async start(): Promise<void> {
    if (this.isStarted) {
      this.logger.warn('Pi Gateway integration already started');
      return;
    }

    if (!this.config.enabled) {
      this.logger.info('Pi Gateway integration disabled');
      return;
    }

    try {
      this.logger.info('Starting Pi Gateway integration...');

      // Initialize Pi optimization components
      await this.initializeComponents();

      // Start monitoring and integration
      await this.startMonitoring();

      this.isStarted = true;
      this.emit('started', { timestamp: new Date() });
      this.logger.info('Pi Gateway integration started successfully');
    } catch (error) {
      this.logger.error('Failed to start Pi Gateway integration:', { error: error instanceof Error ? error.message : String(error) });
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Stops Pi optimization integration
   */
  async stop(): Promise<void> {
    if (!this.isStarted) {
      return;
    }

    try {
      this.logger.info('Stopping Pi Gateway integration...');

      // Stop monitoring
      if (this.metricsInterval) {
        clearInterval(this.metricsInterval);
        this.metricsInterval = undefined;
      }

      // Stop Pi optimization components
      if (this.resourceMonitor) {
        this.resourceMonitor.stopMonitoring();
      }

      if (this.thermalController) {
        this.thermalController.stopMonitoring();
      }

      if (this.storageManager) {
        this.storageManager.stopMonitoring();
      }

      this.isStarted = false;
      this.emit('stopped', { timestamp: new Date() });
      this.logger.info('Pi Gateway integration stopped');
    } catch (error) {
      this.logger.error('Error stopping Pi Gateway integration:', { error: error instanceof Error ? error.message : String(error) });
      this.emit('error', error);
    }
  }

  /**
   * Gets current Pi metrics for Gateway dashboard
   */
  async getCurrentMetrics(): Promise<PiGatewayMetrics> {
    if (!this.isStarted) {
      throw new Error('Pi Gateway integration not started');
    }

    try {
      // Get system metrics from resource monitor
      const systemMetrics = this.resourceMonitor 
        ? await this.resourceMonitor.getSystemMetrics()
        : this.getDefaultSystemMetrics();

      // Get thermal status
      const thermalStatus = this.thermalController
        ? this.thermalController.getThermalStatus()
        : { currentTemperature: 0, activeThrottling: false, lastUpdate: new Date() };

      // Get storage metrics
      const storageMetrics = this.storageManager
        ? await this.storageManager.getStorageMetrics()
        : this.getDefaultStorageMetrics();

      const metrics: PiGatewayMetrics = {
        system: systemMetrics,
        thermal: {
          temperature: thermalStatus.currentTemperature,
          throttling: thermalStatus.activeThrottling,
          action: thermalStatus.currentAction,
        },
        storage: {
          usage: storageMetrics.usedStorage,
          available: storageMetrics.availableStorage,
          logSize: storageMetrics.currentLogSize,
          cacheSize: storageMetrics.cacheUsage,
        },
        pi: {
          model: this.piConfig.model,
          architecture: this.piConfig.architecture,
          memoryLimit: this.piConfig.memory.limit,
          wearLevelingEnabled: this.piConfig.storage.wearLeveling,
        },
        timestamp: new Date(),
      };

      this.lastMetrics = metrics;
      return metrics;
    } catch (error) {
      this.logger.error('Failed to get current metrics:', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Gets recent Pi optimization events for Gateway dashboard
   */
  getRecentEvents(limit: number = 20): PiGatewayEvent[] {
    return this.eventHistory.slice(-limit);
  }

  /**
   * Gets Pi configuration information
   */
  getPiConfiguration(): PiConfiguration {
    return { ...this.piConfig };
  }

  /**
   * Gets integration status
   */
  getStatus(): {
    started: boolean;
    componentsActive: {
      resourceMonitor: boolean;
      thermalController: boolean;
      storageManager: boolean;
    };
    lastMetricsUpdate?: Date;
    eventCount: number;
  } {
    return {
      started: this.isStarted,
      componentsActive: {
        resourceMonitor: !!this.resourceMonitor,
        thermalController: !!this.thermalController,
        storageManager: !!this.storageManager,
      },
      lastMetricsUpdate: this.lastMetrics?.timestamp,
      eventCount: this.eventHistory.length,
    };
  }

  /**
   * Triggers immediate optimization (for Gateway admin actions)
   */
  async triggerOptimization(): Promise<void> {
    if (!this.isStarted) {
      throw new Error('Pi Gateway integration not started');
    }

    try {
      this.logger.info('Triggering immediate Pi optimization...');

      // Trigger storage optimization
      if (this.storageManager) {
        await this.storageManager.optimizeStorageNow();
      }

      // Force garbage collection if memory pressure is high
      if (this.resourceMonitor) {
        const metrics = await this.resourceMonitor.getSystemMetrics();
        const memoryUsage = metrics.memory.used / metrics.memory.total;
        
        if (memoryUsage > 0.8) {
          this.resourceMonitor.forceGarbageCollection();
        }
      }

      this.addEvent({
        type: 'optimization_applied',
        severity: 'info',
        message: 'Manual optimization triggered from Gateway',
        data: { trigger: 'manual', timestamp: new Date() },
        timestamp: new Date(),
      });

      this.logger.info('Pi optimization completed');
    } catch (error) {
      this.logger.error('Failed to trigger optimization:', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Initializes Pi optimization components
   */
  private async initializeComponents(): Promise<void> {
    // Initialize Resource Monitor
    if (this.config.resourceMonitoring.enabled) {
      this.resourceMonitor = new ResourceMonitor(this.piConfig);
      this.setupResourceMonitorEvents();
      this.logger.info('Resource monitor initialized');
    }

    // Initialize Thermal Controller
    if (this.config.thermalManagement.enabled) {
      const thermalPolicy: ThermalPolicy = {
        monitoring: {
          interval: 5, // 5 seconds
          source: '/sys/class/thermal/thermal_zone0/temp',
        },
        thresholds: [
          { temperature: 70, action: 'reduce_25', recovery: 65 },
          { temperature: 75, action: 'reduce_50', recovery: 70 },
          { temperature: 80, action: 'pause_services', recovery: 75 },
        ],
      };

      this.thermalController = new ThermalController(thermalPolicy);
      this.setupThermalControllerEvents();
      this.logger.info('Thermal controller initialized');
    }

    // Initialize Storage Manager
    if (this.config.storageOptimization.enabled) {
      this.storageManager = new StorageManager(this.piConfig);
      this.setupStorageManagerEvents();
      
      // Setup initial storage optimization
      await this.storageManager.setupTmpfs();
      await this.storageManager.setupIntelligentCaching();
      
      this.logger.info('Storage manager initialized');
    }
  }

  /**
   * Starts monitoring and metrics collection
   */
  private async startMonitoring(): Promise<void> {
    // Start component monitoring
    if (this.resourceMonitor) {
      this.resourceMonitor.startMonitoring(this.config.resourceMonitoring.interval);
    }

    if (this.thermalController) {
      this.thermalController.startMonitoring();
    }

    if (this.storageManager && this.config.storageOptimization.monitoringEnabled) {
      this.storageManager.startMonitoring(60000); // 1 minute interval
    }

    // Start metrics broadcasting for Gateway dashboard
    if (this.config.resourceMonitoring.broadcastMetrics) {
      this.metricsInterval = setInterval(async () => {
        try {
          const metrics = await this.getCurrentMetrics();
          this.emit('metrics', metrics);
        } catch (error) {
          this.logger.error('Failed to broadcast metrics:', { error: error instanceof Error ? error.message : String(error) });
        }
      }, this.config.resourceMonitoring.interval);
    }
  }

  /**
   * Sets up Resource Monitor event handlers
   */
  private setupResourceMonitorEvents(): void {
    if (!this.resourceMonitor) return;

    this.resourceMonitor.on('memoryPressure', (data) => {
      this.addEvent({
        type: 'resource_alert',
        severity: 'warning',
        message: `Memory pressure detected: ${Math.round(data.usage * 100)}% usage`,
        data,
        timestamp: new Date(),
      });
    });

    this.resourceMonitor.on('highCPUUsage', (data) => {
      this.addEvent({
        type: 'resource_alert',
        severity: 'warning',
        message: `High CPU usage: ${Math.round(data.usage * 100)}%`,
        data,
        timestamp: new Date(),
      });
    });

    this.resourceMonitor.on('storageCleanupTriggered', (data) => {
      this.addEvent({
        type: 'storage_cleanup',
        severity: 'info',
        message: 'Storage cleanup triggered due to high usage',
        data,
        timestamp: new Date(),
      });
    });
  }

  /**
   * Sets up Thermal Controller event handlers
   */
  private setupThermalControllerEvents(): void {
    if (!this.thermalController) return;

    this.thermalController.on('thermalThrottling', (data) => {
      this.addEvent({
        type: 'thermal_event',
        severity: data.action === 'pause_services' ? 'critical' : 'warning',
        message: `Thermal throttling: ${data.action} at ${data.temperature}°C`,
        data,
        timestamp: new Date(),
      });
    });

    this.thermalController.on('thermalRecovery', (data) => {
      this.addEvent({
        type: 'thermal_event',
        severity: 'info',
        message: `Thermal recovery: temperature dropped to ${data.temperature}°C`,
        data,
        timestamp: new Date(),
      });
    });

    this.thermalController.on('emergencyShutdown', (data) => {
      this.addEvent({
        type: 'thermal_event',
        severity: 'critical',
        message: `Emergency thermal shutdown at ${data.temperature}°C`,
        data,
        timestamp: new Date(),
      });
    });
  }

  /**
   * Sets up Storage Manager event handlers
   */
  private setupStorageManagerEvents(): void {
    if (!this.storageManager) return;

    this.storageManager.on('cleanupCompleted', (data) => {
      this.addEvent({
        type: 'storage_cleanup',
        severity: 'info',
        message: `Storage cleanup completed: ${data.cleanedFiles} files removed`,
        data,
        timestamp: new Date(),
      });
    });

    this.storageManager.on('logRotationCompleted', (data) => {
      this.addEvent({
        type: 'storage_cleanup',
        severity: 'info',
        message: `Log rotation completed: ${data.removedFiles} files rotated`,
        data,
        timestamp: new Date(),
      });
    });

    this.storageManager.on('storageOptimizationCompleted', (data) => {
      this.addEvent({
        type: 'optimization_applied',
        severity: 'info',
        message: 'Storage optimization completed successfully',
        data,
        timestamp: new Date(),
      });
    });
  }

  /**
   * Adds an event to the history
   */
  private addEvent(event: PiGatewayEvent): void {
    this.eventHistory.push(event);
    
    // Limit event history size
    if (this.eventHistory.length > this.maxEventHistory) {
      this.eventHistory = this.eventHistory.slice(-this.maxEventHistory);
    }

    // Emit event for Gateway to handle
    this.emit('piEvent', event);
  }

  /**
   * Gets default system metrics when resource monitor is not available
   */
  private getDefaultSystemMetrics(): SystemMetrics {
    return {
      timestamp: new Date(),
      cpu: {
        usage: 0,
        temperature: 0,
        frequency: 0,
        throttled: false,
      },
      memory: {
        total: this.piConfig.memory.total * 1024 * 1024, // Convert MB to bytes
        used: 0,
        available: this.piConfig.memory.total * 1024 * 1024,
        swapUsed: 0,
      },
      storage: {
        total: 0,
        used: 0,
        available: 0,
        writeCount: 0,
      },
      network: {
        interface: 'wifi' as const,
        bandwidth: 0,
        latency: 0,
        packetsLost: 0,
      },
    };
  }

  /**
   * Gets default storage metrics when storage manager is not available
   */
  private getDefaultStorageMetrics() {
    return {
      totalCapacity: 0,
      usedStorage: 0,
      availableStorage: 0,
      currentLogSize: 0,
      writeOperations: 0,
      tmpfsUsage: 0,
      cacheUsage: 0,
      externalStorageAvailable: false,
    };
  }
}