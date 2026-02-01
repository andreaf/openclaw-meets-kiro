/**
 * Pi Metrics Gateway Methods
 * 
 * WebSocket methods for Pi optimization metrics and controls in Gateway dashboard.
 * Provides real-time Pi performance monitoring and optimization controls.
 * 
 * Requirements: 9.3 - Pi-specific performance monitoring to Gateway dashboard
 */

import type { PiGatewayIntegration, PiGatewayMetrics, PiGatewayEvent } from '../../pi/gateway-integration.js';
import type { PiConfiguration } from '../../pi/types/pi-configuration.js';
import { createSubsystemLogger } from '../../logging/subsystem.js';

const log = createSubsystemLogger('gateway/pi-metrics');

export interface PiMetricsHandlers extends Record<string, (...args: any[]) => any> {
  'pi.getMetrics': () => Promise<PiGatewayMetrics>;
  'pi.getConfiguration': () => Promise<PiConfiguration>;
  'pi.getStatus': () => Promise<{
    enabled: boolean;
    started: boolean;
    componentsActive: {
      resourceMonitor: boolean;
      thermalController: boolean;
      storageManager: boolean;
    };
    lastMetricsUpdate?: Date;
    eventCount: number;
  }>;
  'pi.getRecentEvents': (params: { limit?: number }) => Promise<PiGatewayEvent[]>;
  'pi.triggerOptimization': () => Promise<{ success: boolean; message: string }>;
  'pi.getResourceHistory': (params: { 
    duration?: number; // Duration in minutes
    metric?: 'cpu' | 'memory' | 'storage' | 'thermal';
  }) => Promise<{
    timestamps: Date[];
    values: number[];
    metric: string;
    unit: string;
  }>;
}

/**
 * Creates Pi metrics handlers for Gateway WebSocket methods
 */
export function createPiMetricsHandlers(
  piIntegration: PiGatewayIntegration | null
): PiMetricsHandlers {
  
  // Helper to check if Pi integration is available
  const ensurePiIntegration = (): PiGatewayIntegration => {
    if (!piIntegration) {
      throw new Error('Pi optimization integration not available');
    }
    return piIntegration;
  };

  return {
    /**
     * Gets current Pi metrics for dashboard display
     */
    'pi.getMetrics': async (): Promise<PiGatewayMetrics> => {
      log.debug('Getting Pi metrics');
      
      try {
        const integration = ensurePiIntegration();
        const metrics = await integration.getCurrentMetrics();
        
        log.debug('Pi metrics retrieved successfully', {
          temperature: metrics.thermal.temperature,
          memoryUsage: Math.round((metrics.system.memory.used / metrics.system.memory.total) * 100),
          cpuUsage: Math.round(metrics.system.cpu.usage * 100),
        });
        
        return metrics;
      } catch (error) {
        log.error('Failed to get Pi metrics:', { error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    },

    /**
     * Gets Pi hardware configuration
     */
    'pi.getConfiguration': async (): Promise<PiConfiguration> => {
      log.debug('Getting Pi configuration');
      
      try {
        const integration = ensurePiIntegration();
        const config = integration.getPiConfiguration();
        
        log.debug('Pi configuration retrieved', {
          model: config.model,
          architecture: config.architecture,
          memoryLimit: config.memory.limit,
        });
        
        return config;
      } catch (error) {
        log.error('Failed to get Pi configuration:', { error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    },

    /**
     * Gets Pi integration status
     */
    'pi.getStatus': async () => {
      log.debug('Getting Pi integration status');
      
      try {
        if (!piIntegration) {
          return {
            enabled: false,
            started: false,
            componentsActive: {
              resourceMonitor: false,
              thermalController: false,
              storageManager: false,
            },
            eventCount: 0,
          };
        }
        
        const status = piIntegration.getStatus();
        
        log.debug('Pi integration status retrieved', {
          started: status.started,
          componentsActive: status.componentsActive,
        });
        
        return {
          enabled: true,
          ...status,
        };
      } catch (error) {
        log.error('Failed to get Pi integration status:', { error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    },

    /**
     * Gets recent Pi optimization events
     */
    'pi.getRecentEvents': async (params): Promise<PiGatewayEvent[]> => {
      const { limit = 20 } = params;
      log.debug('Getting recent Pi events', { limit });
      
      try {
        const integration = ensurePiIntegration();
        const events = integration.getRecentEvents(limit);
        
        log.debug('Pi events retrieved', { count: events.length });
        
        return events;
      } catch (error) {
        log.error('Failed to get Pi events:', { error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    },

    /**
     * Triggers immediate Pi optimization
     */
    'pi.triggerOptimization': async (): Promise<{ success: boolean; message: string }> => {
      log.info('Triggering Pi optimization from Gateway');
      
      try {
        const integration = ensurePiIntegration();
        await integration.triggerOptimization();
        
        const message = 'Pi optimization completed successfully';
        log.info(message);
        
        return {
          success: true,
          message,
        };
      } catch (error) {
        const message = `Failed to trigger Pi optimization: ${error instanceof Error ? error.message : 'Unknown error'}`;
        log.error(message, { error: error instanceof Error ? error.message : String(error) });
        
        return {
          success: false,
          message,
        };
      }
    },

    /**
     * Gets historical resource data for charts
     */
    'pi.getResourceHistory': async (params) => {
      const { duration = 60, metric = 'cpu' } = params; // Default 60 minutes
      log.debug('Getting Pi resource history', { duration, metric });
      
      try {
        const integration = ensurePiIntegration();
        
        // For now, return mock historical data
        // In a real implementation, this would query stored metrics
        const now = new Date();
        const timestamps: Date[] = [];
        const values: number[] = [];
        
        // Generate sample data points for the requested duration
        const intervalMinutes = Math.max(1, Math.floor(duration / 60)); // Max 60 data points
        
        for (let i = duration; i >= 0; i -= intervalMinutes) {
          const timestamp = new Date(now.getTime() - i * 60 * 1000);
          timestamps.push(timestamp);
          
          // Generate realistic sample values based on metric type
          let value: number;
          switch (metric) {
            case 'cpu':
              value = Math.random() * 80 + 10; // 10-90% CPU usage
              break;
            case 'memory':
              value = Math.random() * 60 + 30; // 30-90% memory usage
              break;
            case 'thermal':
              value = Math.random() * 20 + 45; // 45-65°C temperature
              break;
            case 'storage':
              value = Math.random() * 40 + 40; // 40-80% storage usage
              break;
            default:
              value = Math.random() * 100;
          }
          values.push(Math.round(value * 100) / 100); // Round to 2 decimal places
        }
        
        const unit = metric === 'thermal' ? '°C' : '%';
        
        log.debug('Pi resource history generated', {
          metric,
          dataPoints: timestamps.length,
          unit,
        });
        
        return {
          timestamps,
          values,
          metric,
          unit,
        };
      } catch (error) {
        log.error('Failed to get Pi resource history:', { error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    },
  };
}

/**
 * Pi metrics event types for WebSocket broadcasting
 */
export const PI_METRICS_EVENTS = {
  METRICS_UPDATE: 'pi.metrics.update',
  EVENT_OCCURRED: 'pi.event.occurred',
  STATUS_CHANGED: 'pi.status.changed',
  OPTIMIZATION_COMPLETED: 'pi.optimization.completed',
} as const;

/**
 * Broadcasts Pi metrics to connected Gateway clients
 */
export function broadcastPiMetrics(
  broadcast: (event: string, payload: unknown, options?: { dropIfSlow?: boolean }) => void,
  metrics: PiGatewayMetrics
): void {
  broadcast(PI_METRICS_EVENTS.METRICS_UPDATE, metrics, { dropIfSlow: true });
}

/**
 * Broadcasts Pi events to connected Gateway clients
 */
export function broadcastPiEvent(
  broadcast: (event: string, payload: unknown, options?: { dropIfSlow?: boolean }) => void,
  event: PiGatewayEvent
): void {
  broadcast(PI_METRICS_EVENTS.EVENT_OCCURRED, event, { dropIfSlow: true });
}

/**
 * Broadcasts Pi status changes to connected Gateway clients
 */
export function broadcastPiStatusChange(
  broadcast: (event: string, payload: unknown, options?: { dropIfSlow?: boolean }) => void,
  status: { started: boolean; componentsActive: Record<string, boolean> }
): void {
  broadcast(PI_METRICS_EVENTS.STATUS_CHANGED, status, { dropIfSlow: true });
}