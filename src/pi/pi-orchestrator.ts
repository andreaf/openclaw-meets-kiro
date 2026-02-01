/**
 * Pi Optimization Orchestrator
 * 
 * Wires all Pi optimization components together with OpenClaw core.
 * Implements component communication, event handling, and comprehensive
 * logging and monitoring across all components.
 * 
 * Task 16.1: Wire all components together
 * Requirements: All requirements - comprehensive system integration
 */

import { EventEmitter } from 'node:events';
import { createSubsystemLogger } from '../logging/subsystem.js';
import { ResourceMonitor } from './resource-monitor/resource-monitor.js';
import { ThermalController } from './thermal-controller/thermal-controller.js';
import { StorageManager } from './storage-manager/storage-manager.js';
import { PiGatewayIntegration } from './gateway-integration.js';
import { detectPiHardware, createOptimizedPiConfiguration, isRaspberryPi } from './hardware/pi-detection.js';
import { setupComprehensivePiLogging, type PiLoggingIntegration } from './logging-integration.js';
import type { PiConfiguration } from './types/pi-configuration.js';
import type { ThermalPolicy } from './types/thermal-policy.js';
import type { SystemMetrics } from './types/index.js';

export interface PiOrchestratorConfig {
  /** Enable Pi optimization orchestration */
  enabled: boolean;
  /** Auto-detect Pi hardware */
  autoDetect: boolean;
  /** Force enable on non-Pi systems (for testing) */
  forceEnable: boolean;
  /** Component configuration */
  components: {
    resourceMonitor: {
      enabled: boolean;
      interval: number; // milliseconds
      adaptiveScaling: boolean;
    };
    thermalController: {
      enabled: boolean;
      interval: number; // seconds
      emergencyShutdown: boolean;
    };
    storageManager: {
      enabled: boolean;
      monitoringInterval: number; // milliseconds
      autoOptimization: boolean;
    };
    gatewayIntegration: {
      enabled: boolean;
      broadcastMetrics: boolean;
    };
  };
  /** Event handling configuration */
  eventHandling: {
    logAllEvents: boolean;
    maxEventHistory: number;
    eventPersistence: boolean;
  };
}

export interface PiOrchestratorStatus {
  enabled: boolean;
  piDetected: boolean;
  componentsActive: {
    resourceMonitor: boolean;
    thermalController: boolean;
    storageManager: boolean;
    gatewayIntegration: boolean;
  };
  lastHealthCheck: Date;
  eventCount: number;
  uptime: number; // milliseconds
}

export interface PiSystemEvent {
  id: string;
  type: 'resource' | 'thermal' | 'storage' | 'integration' | 'system';
  subtype: string;
  severity: 'info' | 'warning' | 'critical' | 'emergency';
  message: string;
  source: string;
  data: Record<string, unknown>;
  timestamp: Date;
  handled: boolean;
}

/**
 * Pi Optimization Orchestrator
 * 
 * Central coordinator for all Pi optimization components
 */
export class PiOrchestrator extends EventEmitter {
  private config: PiOrchestratorConfig;
  private piConfig?: PiConfiguration;
  private logger = createSubsystemLogger('pi/orchestrator');
  
  // Core components
  private resourceMonitor?: ResourceMonitor;
  private thermalController?: ThermalController;
  private storageManager?: StorageManager;
  private gatewayIntegration?: PiGatewayIntegration;
  
  // Logging integration
  private loggingIntegration?: PiLoggingIntegration;
  
  // Orchestration state
  private isStarted = false;
  private startTime?: Date;
  private healthCheckInterval?: NodeJS.Timeout;
  private eventHistory: PiSystemEvent[] = [];
  private eventCounter = 0;
  
  // Component communication channels
  private componentEventBus = new EventEmitter();

  constructor(config: Partial<PiOrchestratorConfig> = {}) {
    super();
    
    this.config = {
      enabled: true,
      autoDetect: true,
      forceEnable: false,
      components: {
        resourceMonitor: {
          enabled: true,
          interval: 5000, // 5 seconds
          adaptiveScaling: true,
        },
        thermalController: {
          enabled: true,
          interval: 5, // 5 seconds
          emergencyShutdown: true,
        },
        storageManager: {
          enabled: true,
          monitoringInterval: 60000, // 1 minute
          autoOptimization: true,
        },
        gatewayIntegration: {
          enabled: true,
          broadcastMetrics: true,
        },
      },
      eventHandling: {
        logAllEvents: true,
        maxEventHistory: 500,
        eventPersistence: false,
      },
      ...config,
    };

    this.logger.info('Pi Orchestrator initialized', {
      config: this.config,
    });
  }

  /**
   * Starts the Pi optimization orchestration
   */
  async start(): Promise<void> {
    if (this.isStarted) {
      this.logger.warn('Pi Orchestrator already started');
      return;
    }

    if (!this.config.enabled) {
      this.logger.info('Pi Orchestrator disabled');
      return;
    }

    try {
      this.logger.info('Starting Pi Orchestrator...');
      this.startTime = new Date();

      // Detect Pi hardware if enabled
      const shouldEnable = await this.checkPiAvailability();
      if (!shouldEnable) {
        this.logger.info('Pi hardware not detected, orchestrator disabled');
        return;
      }

      // Initialize Pi configuration
      await this.initializePiConfiguration();

      // Initialize and wire components
      await this.initializeComponents();
      this.wireComponentCommunication();

      // Start components
      await this.startComponents();

      // Setup comprehensive logging integration
      this.setupLoggingIntegration();

      // Start health monitoring
      this.startHealthMonitoring();

      this.isStarted = true;
      this.emitSystemEvent({
        type: 'system',
        subtype: 'orchestrator_started',
        severity: 'info',
        message: 'Pi Orchestrator started successfully',
        source: 'orchestrator',
        data: {
          piModel: this.piConfig?.model,
          componentsActive: this.getComponentStatus(),
        },
      });

      this.logger.info('Pi Orchestrator started successfully', {
        piModel: this.piConfig?.model,
        componentsActive: this.getComponentStatus(),
      });
    } catch (error) {
      this.logger.error('Failed to start Pi Orchestrator:', {
        error: error instanceof Error ? error.message : String(error),
      });
      
      this.emitSystemEvent({
        type: 'system',
        subtype: 'orchestrator_error',
        severity: 'critical',
        message: `Failed to start Pi Orchestrator: ${error instanceof Error ? error.message : 'Unknown error'}`,
        source: 'orchestrator',
        data: { error: error instanceof Error ? error.message : error },
      });
      
      throw error;
    }
  }

  /**
   * Stops the Pi optimization orchestration
   */
  async stop(): Promise<void> {
    if (!this.isStarted) {
      return;
    }

    try {
      this.logger.info('Stopping Pi Orchestrator...');

      // Stop health monitoring
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
        this.healthCheckInterval = undefined;
      }

      // Stop logging integration
      if (this.loggingIntegration) {
        this.loggingIntegration.stop();
      }

      // Stop components in reverse order
      await this.stopComponents();

      this.isStarted = false;
      
      this.emitSystemEvent({
        type: 'system',
        subtype: 'orchestrator_stopped',
        severity: 'info',
        message: 'Pi Orchestrator stopped',
        source: 'orchestrator',
        data: {
          uptime: this.getUptime(),
          eventCount: this.eventCounter,
        },
      });

      this.logger.info('Pi Orchestrator stopped', {
        uptime: this.getUptime(),
        eventCount: this.eventCounter,
      });
    } catch (error) {
      this.logger.error('Error stopping Pi Orchestrator:', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Gets current orchestrator status
   */
  getStatus(): PiOrchestratorStatus {
    return {
      enabled: this.config.enabled,
      piDetected: !!this.piConfig,
      componentsActive: this.getComponentStatus(),
      lastHealthCheck: new Date(),
      eventCount: this.eventCounter,
      uptime: this.getUptime(),
    };
  }

  /**
   * Gets recent system events
   */
  getRecentEvents(limit: number = 50): PiSystemEvent[] {
    return this.eventHistory.slice(-limit);
  }

  /**
   * Gets Pi configuration
   */
  getPiConfiguration(): PiConfiguration | undefined {
    return this.piConfig ? { ...this.piConfig } : undefined;
  }

  /**
   * Triggers immediate system optimization
   */
  async triggerOptimization(): Promise<void> {
    if (!this.isStarted) {
      throw new Error('Pi Orchestrator not started');
    }

    try {
      this.logger.info('Triggering system-wide optimization...');

      const optimizationTasks: Promise<void>[] = [];

      // Trigger storage optimization
      if (this.storageManager) {
        optimizationTasks.push(this.storageManager.optimizeStorageNow());
      }

      // Force garbage collection if memory pressure is high
      if (this.resourceMonitor) {
        const metrics = await this.resourceMonitor.getSystemMetrics();
        const memoryUsage = metrics.memory.used / metrics.memory.total;
        
        if (memoryUsage > 0.8) {
          this.resourceMonitor.forceGarbageCollection();
        }
      }

      // Trigger thermal check
      if (this.thermalController) {
        optimizationTasks.push(this.thermalController.forceThermalCheck());
      }

      // Wait for all optimizations to complete
      await Promise.all(optimizationTasks);

      this.emitSystemEvent({
        type: 'system',
        subtype: 'optimization_completed',
        severity: 'info',
        message: 'System-wide optimization completed',
        source: 'orchestrator',
        data: { trigger: 'manual' },
      });

      this.logger.info('System-wide optimization completed');
    } catch (error) {
      this.logger.error('Failed to trigger optimization:', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Checks if Pi hardware is available
   */
  private async checkPiAvailability(): Promise<boolean> {
    if (this.config.forceEnable) {
      this.logger.info('Pi optimization force-enabled');
      return true;
    }

    if (!this.config.autoDetect) {
      this.logger.info('Pi auto-detection disabled');
      return false;
    }

    const piDetected = isRaspberryPi();
    this.logger.info('Pi hardware detection result', { piDetected });
    
    return piDetected;
  }

  /**
   * Initializes Pi configuration
   */
  private async initializePiConfiguration(): Promise<void> {
    try {
      const hardwareInfo = await detectPiHardware();
      this.piConfig = createOptimizedPiConfiguration(hardwareInfo);
      
      this.logger.info('Pi configuration initialized', {
        model: this.piConfig.model,
        architecture: this.piConfig.architecture,
        memoryLimit: this.piConfig.memory.limit,
        wearLeveling: this.piConfig.storage.wearLeveling,
      });
    } catch (error) {
      this.logger.error('Failed to initialize Pi configuration:', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Initializes all Pi optimization components
   */
  private async initializeComponents(): Promise<void> {
    if (!this.piConfig) {
      throw new Error('Pi configuration not initialized');
    }

    // Initialize Resource Monitor
    if (this.config.components.resourceMonitor.enabled) {
      this.resourceMonitor = new ResourceMonitor(this.piConfig);
      
      if (this.config.components.resourceMonitor.adaptiveScaling) {
        this.resourceMonitor.enableAdaptiveScaling();
      }
      
      this.logger.info('Resource Monitor initialized');
    }

    // Initialize Thermal Controller
    if (this.config.components.thermalController.enabled) {
      const thermalPolicy: ThermalPolicy = {
        monitoring: {
          interval: this.config.components.thermalController.interval,
          source: '/sys/class/thermal/thermal_zone0/temp',
        },
        thresholds: [
          { temperature: 70, action: 'reduce_25', recovery: 65 },
          { temperature: 75, action: 'reduce_50', recovery: 70 },
          { temperature: 80, action: 'pause_services', recovery: 75 },
        ],
      };

      this.thermalController = new ThermalController(thermalPolicy);
      this.logger.info('Thermal Controller initialized');
    }

    // Initialize Storage Manager
    if (this.config.components.storageManager.enabled) {
      this.storageManager = new StorageManager(this.piConfig);
      
      // Setup initial storage optimization
      await this.storageManager.setupTmpfs();
      await this.storageManager.setupIntelligentCaching();
      
      this.logger.info('Storage Manager initialized');
    }

    // Initialize Gateway Integration
    if (this.config.components.gatewayIntegration.enabled) {
      this.gatewayIntegration = new PiGatewayIntegration(this.piConfig, {
        enabled: true,
        resourceMonitoring: {
          enabled: this.config.components.resourceMonitor.enabled,
          interval: this.config.components.resourceMonitor.interval,
          broadcastMetrics: this.config.components.gatewayIntegration.broadcastMetrics,
        },
        thermalManagement: {
          enabled: this.config.components.thermalController.enabled,
          notifyGateway: true,
        },
        storageOptimization: {
          enabled: this.config.components.storageManager.enabled,
          monitoringEnabled: true,
        },
      });
      
      this.logger.info('Gateway Integration initialized');
    }
  }

  /**
   * Wires component communication and event handling
   */
  private wireComponentCommunication(): void {
    this.logger.info('Wiring component communication...');

    // Resource Monitor Events
    if (this.resourceMonitor) {
      this.wireResourceMonitorEvents();
    }

    // Thermal Controller Events
    if (this.thermalController) {
      this.wireThermalControllerEvents();
    }

    // Storage Manager Events
    if (this.storageManager) {
      this.wireStorageManagerEvents();
    }

    // Gateway Integration Events
    if (this.gatewayIntegration) {
      this.wireGatewayIntegrationEvents();
    }

    // Cross-component communication
    this.wireCrossComponentCommunication();

    this.logger.info('Component communication wired successfully');
  }

  /**
   * Wires Resource Monitor events
   */
  private wireResourceMonitorEvents(): void {
    if (!this.resourceMonitor) return;

    // Memory pressure events
    this.resourceMonitor.on('memoryPressure', (data) => {
      this.emitSystemEvent({
        type: 'resource',
        subtype: 'memory_pressure',
        severity: data.level === 'critical' ? 'critical' : 'warning',
        message: `Memory pressure detected: ${Math.round(data.usage * 100)}% usage (${data.level})`,
        source: 'resource-monitor',
        data,
      });

      // Trigger storage cleanup on critical memory pressure
      if (data.level === 'critical' && this.storageManager) {
        this.componentEventBus.emit('triggerStorageCleanup', { reason: 'memory_pressure', data });
      }
    });

    // CPU pressure events
    this.resourceMonitor.on('cpuPressure', (data) => {
      this.emitSystemEvent({
        type: 'resource',
        subtype: 'cpu_pressure',
        severity: 'warning',
        message: `High CPU usage detected: ${Math.round(data.usage)}%`,
        source: 'resource-monitor',
        data,
      });
    });

    // Storage pressure events
    this.resourceMonitor.on('storagePressure', (data) => {
      this.emitSystemEvent({
        type: 'resource',
        subtype: 'storage_pressure',
        severity: 'warning',
        message: `High storage usage detected: ${Math.round(data.usage * 100)}%`,
        source: 'resource-monitor',
        data,
      });

      // Trigger immediate storage cleanup
      if (this.storageManager) {
        this.componentEventBus.emit('triggerStorageCleanup', { reason: 'storage_pressure', data });
      }
    });

    // Service reduction requests
    this.resourceMonitor.on('serviceReductionRequested', (data) => {
      this.emitSystemEvent({
        type: 'resource',
        subtype: 'service_reduction',
        severity: data.level === 'aggressive' ? 'critical' : 'warning',
        message: `Service reduction requested: ${data.level} level due to ${data.reason}`,
        source: 'resource-monitor',
        data,
      });

      // Broadcast to other components
      this.componentEventBus.emit('serviceReductionRequested', data);
    });
  }

  /**
   * Wires Thermal Controller events
   */
  private wireThermalControllerEvents(): void {
    if (!this.thermalController) return;

    // Thermal throttling events
    this.thermalController.on('thermalThrottling', (data) => {
      this.emitSystemEvent({
        type: 'thermal',
        subtype: 'throttling',
        severity: data.action === 'pause_services' ? 'critical' : 'warning',
        message: `Thermal throttling activated: ${data.action} at ${data.temperature}°C`,
        source: 'thermal-controller',
        data,
      });

      // Notify resource monitor to reduce operations
      if (this.resourceMonitor) {
        this.componentEventBus.emit('thermalThrottling', data);
      }
    });

    // Thermal recovery events
    this.thermalController.on('thermalRecovery', (data) => {
      this.emitSystemEvent({
        type: 'thermal',
        subtype: 'recovery',
        severity: 'info',
        message: `Thermal recovery: temperature dropped to ${data.temperature}°C`,
        source: 'thermal-controller',
        data,
      });

      // Notify components that normal operation can resume
      this.componentEventBus.emit('thermalRecovery', data);
    });

    // Thermal emergency events
    this.thermalController.on('thermalEmergency', (data) => {
      this.emitSystemEvent({
        type: 'thermal',
        subtype: 'emergency',
        severity: 'emergency',
        message: `Thermal emergency: ${data.emergencyLevel} at ${data.temperature}°C`,
        source: 'thermal-controller',
        data,
      });

      // Trigger emergency procedures
      this.componentEventBus.emit('thermalEmergency', data);
    });
  }

  /**
   * Wires Storage Manager events
   */
  private wireStorageManagerEvents(): void {
    if (!this.storageManager) return;

    // Storage cleanup events
    this.storageManager.on('cleanupCompleted', (data) => {
      this.emitSystemEvent({
        type: 'storage',
        subtype: 'cleanup_completed',
        severity: 'info',
        message: `Storage cleanup completed: ${data.cleanedFiles} files removed (${Math.round(data.cleanedSize / 1024 / 1024)}MB)`,
        source: 'storage-manager',
        data,
      });
    });

    // Log rotation events
    this.storageManager.on('logRotationCompleted', (data) => {
      this.emitSystemEvent({
        type: 'storage',
        subtype: 'log_rotation',
        severity: 'info',
        message: `Log rotation completed: ${data.removedFiles.length} files rotated`,
        source: 'storage-manager',
        data,
      });
    });

    // Storage optimization events
    this.storageManager.on('storageOptimizationCompleted', (data) => {
      this.emitSystemEvent({
        type: 'storage',
        subtype: 'optimization_completed',
        severity: 'info',
        message: 'Storage optimization completed successfully',
        source: 'storage-manager',
        data,
      });
    });

    // Listen for cleanup triggers from other components
    this.componentEventBus.on('triggerStorageCleanup', async (triggerData) => {
      try {
        await this.storageManager!.cleanupStorage();
      } catch (error) {
        this.logger.error('Failed to trigger storage cleanup:', {
          error: error instanceof Error ? error.message : String(error),
          trigger: triggerData,
        });
      }
    });
  }

  /**
   * Wires Gateway Integration events
   */
  private wireGatewayIntegrationEvents(): void {
    if (!this.gatewayIntegration) return;

    // Gateway integration events
    this.gatewayIntegration.on('piEvent', (event) => {
      this.emitSystemEvent({
        type: 'integration',
        subtype: event.type,
        severity: event.severity,
        message: event.message,
        source: 'gateway-integration',
        data: event.data,
      });
    });

    // Gateway integration status events
    this.gatewayIntegration.on('started', () => {
      this.emitSystemEvent({
        type: 'integration',
        subtype: 'gateway_started',
        severity: 'info',
        message: 'Gateway integration started',
        source: 'gateway-integration',
        data: {},
      });
    });

    this.gatewayIntegration.on('stopped', () => {
      this.emitSystemEvent({
        type: 'integration',
        subtype: 'gateway_stopped',
        severity: 'info',
        message: 'Gateway integration stopped',
        source: 'gateway-integration',
        data: {},
      });
    });
  }

  /**
   * Wires cross-component communication
   */
  private wireCrossComponentCommunication(): void {
    // Thermal throttling affects resource monitoring
    this.componentEventBus.on('thermalThrottling', (data) => {
      if (this.resourceMonitor) {
        // Adjust resource thresholds during thermal throttling
        const reductionFactor = data.reductionLevel || 0.5;
        this.resourceMonitor.setThresholds({
          cpuUsageThreshold: 0.85 * (1 - reductionFactor),
          memoryGCThreshold: 0.8 * (1 - reductionFactor * 0.5),
        });
      }
    });

    // Thermal recovery restores normal thresholds
    this.componentEventBus.on('thermalRecovery', () => {
      if (this.resourceMonitor) {
        // Restore normal resource thresholds
        this.resourceMonitor.setThresholds({
          cpuUsageThreshold: 0.85,
          memoryGCThreshold: 0.8,
        });
      }
    });

    // Service reduction affects all components
    this.componentEventBus.on('serviceReductionRequested', (data) => {
      this.logger.info('Processing service reduction request', {
        level: data.level,
        reason: data.reason,
      });

      // Adjust component behavior based on reduction level
      if (data.level === 'aggressive') {
        // Reduce monitoring intervals
        if (this.resourceMonitor) {
          this.resourceMonitor.stopMonitoring();
          this.resourceMonitor.startMonitoring(10000); // Reduce to 10 seconds
        }
        
        // Trigger immediate storage cleanup
        if (this.storageManager) {
          this.componentEventBus.emit('triggerStorageCleanup', { reason: 'service_reduction' });
        }
      }
    });

    // Thermal emergency triggers system-wide emergency procedures
    this.componentEventBus.on('thermalEmergency', (data) => {
      this.logger.error('Processing thermal emergency', {
        temperature: data.temperature,
        emergencyLevel: data.emergencyLevel,
      });

      // Stop non-essential monitoring
      if (this.resourceMonitor) {
        this.resourceMonitor.stopMonitoring();
      }

      // Trigger aggressive storage cleanup
      if (this.storageManager) {
        this.componentEventBus.emit('triggerStorageCleanup', { reason: 'thermal_emergency' });
      }

      // Emit system-wide emergency event
      this.emit('systemEmergency', {
        type: 'thermal',
        data,
        timestamp: new Date(),
      });
    });
  }

  /**
   * Sets up comprehensive logging integration
   */
  private setupLoggingIntegration(): void {
    if (!this.config.eventHandling.logAllEvents) {
      return;
    }

    this.logger.info('Setting up comprehensive Pi logging integration...');

    this.loggingIntegration = setupComprehensivePiLogging(
      this,
      this.resourceMonitor,
      this.thermalController,
      this.storageManager,
      {
        enabled: true,
        logSystemEvents: this.config.eventHandling.logAllEvents,
        logMetrics: true,
        logLifecycle: true,
        logThermalEvents: true,
        logStorageEvents: true,
        logResourceEvents: true,
        metricsInterval: 30000, // 30 seconds
      }
    );

    this.logger.info('Comprehensive Pi logging integration setup completed');
  }

  /**
   * Starts all components
   */
  private async startComponents(): Promise<void> {
    const startTasks: Promise<void>[] = [];

    // Start Resource Monitor
    if (this.resourceMonitor) {
      this.resourceMonitor.startMonitoring(this.config.components.resourceMonitor.interval);
    }

    // Start Thermal Controller
    if (this.thermalController) {
      this.thermalController.startMonitoring();
    }

    // Start Storage Manager monitoring
    if (this.storageManager) {
      this.storageManager.startMonitoring(this.config.components.storageManager.monitoringInterval);
    }

    // Start Gateway Integration
    if (this.gatewayIntegration) {
      startTasks.push(this.gatewayIntegration.start());
    }

    // Wait for all components to start
    await Promise.all(startTasks);

    this.logger.info('All components started successfully');
  }

  /**
   * Stops all components
   */
  private async stopComponents(): Promise<void> {
    const stopTasks: Promise<void>[] = [];

    // Stop Gateway Integration first
    if (this.gatewayIntegration) {
      stopTasks.push(this.gatewayIntegration.stop());
    }

    // Stop monitoring components
    if (this.resourceMonitor) {
      this.resourceMonitor.stopMonitoring();
    }

    if (this.thermalController) {
      this.thermalController.stopMonitoring();
    }

    if (this.storageManager) {
      this.storageManager.stopMonitoring();
    }

    // Wait for all components to stop
    await Promise.all(stopTasks);

    this.logger.info('All components stopped successfully');
  }

  /**
   * Starts health monitoring
   */
  private startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, 30000); // Health check every 30 seconds

    this.logger.info('Health monitoring started');
  }

  /**
   * Performs system health check
   */
  private async performHealthCheck(): Promise<void> {
    try {
      const status = this.getStatus();
      
      // Check component health
      const unhealthyComponents = Object.entries(status.componentsActive)
        .filter(([, active]) => !active)
        .map(([component]) => component);

      if (unhealthyComponents.length > 0) {
        this.emitSystemEvent({
          type: 'system',
          subtype: 'health_check_warning',
          severity: 'warning',
          message: `Inactive components detected: ${unhealthyComponents.join(', ')}`,
          source: 'orchestrator',
          data: { unhealthyComponents, status },
        });
      }

      // Check system metrics if available
      if (this.resourceMonitor) {
        const metrics = await this.resourceMonitor.getSystemMetrics();
        const memoryUsage = metrics.memory.used / metrics.memory.total;
        const cpuUsage = metrics.cpu.usage / 100;

        if (memoryUsage > 0.95 || cpuUsage > 0.95) {
          this.emitSystemEvent({
            type: 'system',
            subtype: 'health_check_critical',
            severity: 'critical',
            message: `Critical resource usage: Memory ${Math.round(memoryUsage * 100)}%, CPU ${Math.round(cpuUsage * 100)}%`,
            source: 'orchestrator',
            data: { metrics },
          });
        }
      }
    } catch (error) {
      this.logger.error('Health check failed:', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Emits a system event
   */
  private emitSystemEvent(eventData: Omit<PiSystemEvent, 'id' | 'timestamp' | 'handled'>): void {
    const event: PiSystemEvent = {
      id: `${Date.now()}-${++this.eventCounter}`,
      timestamp: new Date(),
      handled: false,
      ...eventData,
    };

    // Add to event history
    this.eventHistory.push(event);
    
    // Maintain history size limit
    if (this.eventHistory.length > this.config.eventHandling.maxEventHistory) {
      this.eventHistory = this.eventHistory.slice(-this.config.eventHandling.maxEventHistory);
    }

    // Log event if configured
    if (this.config.eventHandling.logAllEvents) {
      this.logger.info('System event', {
        id: event.id,
        type: event.type,
        subtype: event.subtype,
        severity: event.severity,
        message: event.message,
        source: event.source,
      });
    }

    // Emit event for external listeners
    this.emit('systemEvent', event);
    this.emit(`${event.type}Event`, event);
  }

  /**
   * Gets component status
   */
  private getComponentStatus(): PiOrchestratorStatus['componentsActive'] {
    return {
      resourceMonitor: !!this.resourceMonitor,
      thermalController: !!this.thermalController,
      storageManager: !!this.storageManager,
      gatewayIntegration: !!this.gatewayIntegration,
    };
  }

  /**
   * Gets uptime in milliseconds
   */
  private getUptime(): number {
    return this.startTime ? Date.now() - this.startTime.getTime() : 0;
  }
}