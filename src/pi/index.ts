/**
 * Pi Optimization Entry Point
 * 
 * Main entry point for Pi optimization integration with OpenClaw.
 * Provides initialization, configuration, and lifecycle management
 * for all Pi-specific optimization components.
 * 
 * Task 16.1: Wire all components together - Main integration point
 */

import { createSubsystemLogger } from '../logging/subsystem.js';
import { PiOrchestrator } from './pi-orchestrator.js';
import { isRaspberryPi } from './hardware/pi-detection.js';
import type { PiOrchestratorConfig, PiOrchestratorStatus, PiSystemEvent } from './pi-orchestrator.js';

const log = createSubsystemLogger('pi/index');

// Global Pi orchestrator instance
let piOrchestrator: PiOrchestrator | null = null;
let isInitialized = false;

/**
 * Default Pi optimization configuration
 */
const DEFAULT_PI_CONFIG: PiOrchestratorConfig = {
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
};

/**
 * Initializes Pi optimization for OpenClaw
 */
export async function initializePiOptimization(
  config: Partial<PiOrchestratorConfig> = {}
): Promise<boolean> {
  if (isInitialized) {
    log.warn('Pi optimization already initialized');
    return !!piOrchestrator;
  }

  try {
    log.info('Initializing Pi optimization...');

    // Merge configuration with defaults
    const finalConfig: PiOrchestratorConfig = {
      ...DEFAULT_PI_CONFIG,
      ...config,
      components: {
        ...DEFAULT_PI_CONFIG.components,
        ...config.components,
      },
      eventHandling: {
        ...DEFAULT_PI_CONFIG.eventHandling,
        ...config.eventHandling,
      },
    };

    // Check if Pi optimization should be enabled
    const shouldEnable = finalConfig.enabled && (
      finalConfig.forceEnable || 
      (finalConfig.autoDetect && isRaspberryPi())
    );

    if (!shouldEnable) {
      log.info('Pi optimization disabled or not applicable');
      isInitialized = true;
      return false;
    }

    // Create and start orchestrator
    piOrchestrator = new PiOrchestrator(finalConfig);
    
    // Set up global event handlers
    setupGlobalEventHandlers(piOrchestrator);
    
    // Start the orchestrator
    await piOrchestrator.start();

    isInitialized = true;
    log.info('Pi optimization initialized successfully');
    return true;
  } catch (error) {
    log.error('Failed to initialize Pi optimization:', {
      error: error instanceof Error ? error.message : String(error),
    });
    
    // Clean up on failure
    if (piOrchestrator) {
      try {
        await piOrchestrator.stop();
      } catch (stopError) {
        log.error('Error stopping orchestrator after initialization failure:', stopError);
      }
      piOrchestrator = null;
    }
    
    isInitialized = true; // Mark as initialized even on failure to prevent retries
    return false;
  }
}

/**
 * Shuts down Pi optimization
 */
export async function shutdownPiOptimization(): Promise<void> {
  if (!piOrchestrator) {
    return;
  }

  try {
    log.info('Shutting down Pi optimization...');
    await piOrchestrator.stop();
    piOrchestrator = null;
    log.info('Pi optimization shutdown completed');
  } catch (error) {
    log.error('Error during Pi optimization shutdown:', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Gets Pi optimization status
 */
export function getPiOptimizationStatus(): PiOrchestratorStatus | null {
  return piOrchestrator ? piOrchestrator.getStatus() : null;
}

/**
 * Gets recent Pi system events
 */
export function getRecentPiEvents(limit: number = 50): PiSystemEvent[] {
  return piOrchestrator ? piOrchestrator.getRecentEvents(limit) : [];
}

/**
 * Triggers immediate Pi optimization
 */
export async function triggerPiOptimization(): Promise<void> {
  if (!piOrchestrator) {
    throw new Error('Pi optimization not initialized');
  }

  await piOrchestrator.triggerOptimization();
}

/**
 * Gets Pi configuration
 */
export function getPiConfiguration() {
  return piOrchestrator ? piOrchestrator.getPiConfiguration() : null;
}

/**
 * Checks if Pi optimization is available and active
 */
export function isPiOptimizationActive(): boolean {
  return !!piOrchestrator && piOrchestrator.getStatus().enabled;
}

/**
 * Checks if running on Raspberry Pi hardware
 */
export function isRunningOnPi(): boolean {
  return isRaspberryPi();
}

/**
 * Sets up global event handlers for the orchestrator
 */
function setupGlobalEventHandlers(orchestrator: PiOrchestrator): void {
  // System events
  orchestrator.on('systemEvent', (event: PiSystemEvent) => {
    // Log critical and emergency events to global logger
    if (event.severity === 'critical' || event.severity === 'emergency') {
      log.error(`Pi System Event [${event.type}/${event.subtype}]: ${event.message}`, {
        eventId: event.id,
        source: event.source,
        data: event.data,
      });
    }
  });

  // System emergency events
  orchestrator.on('systemEmergency', (emergency) => {
    log.fatal('Pi System Emergency detected', {
      type: emergency.type,
      data: emergency.data,
      timestamp: emergency.timestamp,
    });
    
    // Emit global emergency event for OpenClaw core to handle
    process.emit('piSystemEmergency', emergency);
  });

  // Resource events
  orchestrator.on('resourceEvent', (event: PiSystemEvent) => {
    if (event.severity === 'critical') {
      log.warn(`Pi Resource Alert: ${event.message}`, {
        eventId: event.id,
        data: event.data,
      });
    }
  });

  // Thermal events
  orchestrator.on('thermalEvent', (event: PiSystemEvent) => {
    if (event.severity === 'critical' || event.severity === 'emergency') {
      log.error(`Pi Thermal Alert: ${event.message}`, {
        eventId: event.id,
        data: event.data,
      });
    }
  });

  // Storage events
  orchestrator.on('storageEvent', (event: PiSystemEvent) => {
    if (event.subtype === 'cleanup_completed' || event.subtype === 'optimization_completed') {
      log.info(`Pi Storage: ${event.message}`, {
        eventId: event.id,
      });
    }
  });

  log.info('Global Pi event handlers configured');
}

/**
 * Process exit handler for graceful shutdown
 */
process.on('SIGTERM', async () => {
  log.info('Received SIGTERM, shutting down Pi optimization...');
  await shutdownPiOptimization();
});

process.on('SIGINT', async () => {
  log.info('Received SIGINT, shutting down Pi optimization...');
  await shutdownPiOptimization();
});

// Export types for external use
export type {
  PiOrchestratorConfig,
  PiOrchestratorStatus,
  PiSystemEvent,
} from './pi-orchestrator.js';

export type {
  PiConfiguration,
} from './types/pi-configuration.js';

export type {
  SystemMetrics,
} from './types/index.js';

// Export individual components for advanced usage
export { PiOrchestrator } from './pi-orchestrator.js';
export { ResourceMonitor } from './resource-monitor/resource-monitor.js';
export { ThermalController } from './thermal-controller/thermal-controller.js';
export { StorageManager } from './storage-manager/storage-manager.js';
export { PiGatewayIntegration } from './gateway-integration.js';

// Export hardware detection utilities
export {
  isRaspberryPi,
  detectPiHardware,
  createOptimizedPiConfiguration,
} from './hardware/pi-detection.js';