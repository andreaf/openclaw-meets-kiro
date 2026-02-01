/**
 * Gateway Pi Integration
 * 
 * Integrates Pi optimization layer with OpenClaw Gateway service.
 * Handles initialization, monitoring, and WebSocket method registration.
 * 
 * Requirements: 9.3 - Pi-specific performance monitoring to Gateway dashboard
 */

import { createSubsystemLogger } from '../logging/subsystem.js';
import { PiGatewayIntegration } from '../pi/gateway-integration.js';
import { detectPiHardware, createOptimizedPiConfiguration, isRaspberryPi } from '../pi/hardware/pi-detection.js';
import { createPiMetricsHandlers, broadcastPiMetrics, broadcastPiEvent, PI_METRICS_EVENTS } from './server-methods/pi-metrics.js';
import type { PiGatewayMetrics, PiGatewayEvent } from '../pi/gateway-integration.js';

const log = createSubsystemLogger('gateway/pi-integration');

export interface GatewayPiIntegrationOptions {
  /** Enable Pi optimization integration */
  enabled?: boolean;
  /** Auto-detect Pi hardware and enable optimization */
  autoDetect?: boolean;
  /** Force enable Pi optimization even on non-Pi systems (for testing) */
  forceEnable?: boolean;
}

export interface GatewayPiIntegrationState {
  enabled: boolean;
  piDetected: boolean;
  integration: PiGatewayIntegration | null;
  lastMetrics?: PiGatewayMetrics;
  metricsInterval?: NodeJS.Timeout;
}

/**
 * Initializes Pi optimization integration for Gateway
 */
export async function initializeGatewayPiIntegration(
  options: GatewayPiIntegrationOptions = {}
): Promise<GatewayPiIntegrationState> {
  const {
    enabled = true,
    autoDetect = true,
    forceEnable = false,
  } = options;

  log.info('Initializing Gateway Pi integration...', {
    enabled,
    autoDetect,
    forceEnable,
  });

  // Check if Pi optimization should be enabled
  const piDetected = autoDetect ? isRaspberryPi() : false;
  const shouldEnable = enabled && (piDetected || forceEnable);

  if (!shouldEnable) {
    log.info('Pi optimization integration disabled', {
      enabled,
      piDetected,
      forceEnable,
    });
    
    return {
      enabled: false,
      piDetected,
      integration: null,
    };
  }

  try {
    // Detect Pi hardware and create configuration
    const hardwareInfo = await detectPiHardware();
    const piConfig = createOptimizedPiConfiguration(hardwareInfo);

    log.info('Pi hardware detected and configured', {
      model: piConfig.model,
      architecture: piConfig.architecture,
      memoryLimit: piConfig.memory.limit,
      wearLeveling: piConfig.storage.wearLeveling,
    });

    // Create Pi integration instance
    const integration = new PiGatewayIntegration(piConfig, {
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
    });

    // Start the integration
    await integration.start();

    log.info('Gateway Pi integration initialized successfully');

    return {
      enabled: true,
      piDetected,
      integration,
    };
  } catch (error) {
    log.error('Failed to initialize Gateway Pi integration:', { error: error instanceof Error ? error.message : String(error) });
    
    return {
      enabled: false,
      piDetected,
      integration: null,
    };
  }
}

/**
 * Sets up Pi integration with Gateway WebSocket handlers and broadcasting
 */
export function setupGatewayPiIntegration(
  state: GatewayPiIntegrationState,
  broadcast: (event: string, payload: unknown, options?: { dropIfSlow?: boolean }) => void,
  registerHandlers: (handlers: Record<string, (...args: any[]) => any>) => void
): void {
  log.info('Setting up Gateway Pi integration handlers', {
    enabled: state.enabled,
    hasIntegration: !!state.integration,
  });

  // Register Pi metrics WebSocket handlers
  const piHandlers = createPiMetricsHandlers(state.integration);
  registerHandlers(piHandlers);

  if (!state.integration) {
    log.info('Pi integration not available, handlers registered with null integration');
    return;
  }

  // Set up event listeners for broadcasting
  setupPiEventBroadcasting(state.integration, broadcast);

  // Start metrics broadcasting
  startPiMetricsBroadcasting(state, broadcast);

  log.info('Gateway Pi integration setup completed');
}

/**
 * Sets up Pi event broadcasting to Gateway clients
 */
function setupPiEventBroadcasting(
  integration: PiGatewayIntegration,
  broadcast: (event: string, payload: unknown, options?: { dropIfSlow?: boolean }) => void
): void {
  // Broadcast Pi events to connected clients
  integration.on('piEvent', (event: PiGatewayEvent) => {
    log.debug('Broadcasting Pi event', {
      type: event.type,
      severity: event.severity,
      message: event.message,
    });
    
    broadcastPiEvent(broadcast, event);
  });

  // Broadcast integration status changes
  integration.on('started', () => {
    log.info('Pi integration started, broadcasting status change');
    broadcast(PI_METRICS_EVENTS.STATUS_CHANGED, {
      started: true,
      timestamp: new Date(),
    }, { dropIfSlow: true });
  });

  integration.on('stopped', () => {
    log.info('Pi integration stopped, broadcasting status change');
    broadcast(PI_METRICS_EVENTS.STATUS_CHANGED, {
      started: false,
      timestamp: new Date(),
    }, { dropIfSlow: true });
  });

  integration.on('error', (error) => {
    log.error('Pi integration error:', error);
    broadcast(PI_METRICS_EVENTS.EVENT_OCCURRED, {
      type: 'integration_error',
      severity: 'critical',
      message: `Pi integration error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      data: { error: error instanceof Error ? error.message : error },
      timestamp: new Date(),
    }, { dropIfSlow: true });
  });
}

/**
 * Starts periodic Pi metrics broadcasting
 */
function startPiMetricsBroadcasting(
  state: GatewayPiIntegrationState,
  broadcast: (event: string, payload: unknown, options?: { dropIfSlow?: boolean }) => void
): void {
  if (!state.integration) {
    return;
  }

  // Listen for metrics updates from the integration
  state.integration.on('metrics', (metrics: PiGatewayMetrics) => {
    log.debug('Broadcasting Pi metrics update', {
      temperature: metrics.thermal.temperature,
      memoryUsage: Math.round((metrics.system.memory.used / metrics.system.memory.total) * 100),
      cpuUsage: Math.round(metrics.system.cpu.usage * 100),
    });
    
    state.lastMetrics = metrics;
    broadcastPiMetrics(broadcast, metrics);
  });

  log.info('Pi metrics broadcasting started');
}

/**
 * Stops Pi integration and cleans up resources
 */
export async function stopGatewayPiIntegration(state: GatewayPiIntegrationState): Promise<void> {
  if (!state.integration) {
    return;
  }

  try {
    log.info('Stopping Gateway Pi integration...');

    // Stop metrics broadcasting
    if (state.metricsInterval) {
      clearInterval(state.metricsInterval);
      state.metricsInterval = undefined;
    }

    // Stop Pi integration
    await state.integration.stop();

    log.info('Gateway Pi integration stopped');
  } catch (error) {
    log.error('Error stopping Gateway Pi integration:', { error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Gets Pi integration status for Gateway health checks
 */
export function getPiIntegrationHealth(state: GatewayPiIntegrationState): {
  enabled: boolean;
  piDetected: boolean;
  integrationActive: boolean;
  lastMetricsUpdate?: Date;
  componentsActive?: {
    resourceMonitor: boolean;
    thermalController: boolean;
    storageManager: boolean;
  };
} {
  return {
    enabled: state.enabled,
    piDetected: state.piDetected,
    integrationActive: !!state.integration,
    lastMetricsUpdate: state.lastMetrics?.timestamp,
    componentsActive: state.integration?.getStatus().componentsActive,
  };
}

/**
 * Handles Gateway shutdown for Pi integration
 */
export async function handleGatewayShutdownPiIntegration(
  state: GatewayPiIntegrationState
): Promise<void> {
  if (!state.integration) {
    return;
  }

  try {
    log.info('Handling Gateway shutdown for Pi integration...');

    // Trigger final optimization before shutdown
    await state.integration.triggerOptimization();

    // Stop the integration
    await stopGatewayPiIntegration(state);

    log.info('Pi integration shutdown completed');
  } catch (error) {
    log.error('Error during Pi integration shutdown:', { error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Pi integration event types for Gateway
 */
export const GATEWAY_PI_EVENTS = {
  INTEGRATION_STARTED: 'gateway.pi.integration.started',
  INTEGRATION_STOPPED: 'gateway.pi.integration.stopped',
  INTEGRATION_ERROR: 'gateway.pi.integration.error',
  HARDWARE_DETECTED: 'gateway.pi.hardware.detected',
  OPTIMIZATION_TRIGGERED: 'gateway.pi.optimization.triggered',
} as const;