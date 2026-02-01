/**
 * Gateway Pi Agent Integration
 * 
 * Integrates Pi AI agent optimization with OpenClaw Gateway service.
 * Provides resource-aware AI agent scheduling, dynamic scaling based on
 * thermal/power constraints, and Pi-specific AI processing optimizations
 * through the Gateway.
 * 
 * Requirements: 5.3 - Dynamic scaling for AI processing based on thermal/power constraints
 */

import { createSubsystemLogger } from '../logging/subsystem.js';
import { PiAgentIntegration } from '../pi/agent-integration.js';
import { ResourceMonitor } from '../pi/resource-monitor/resource-monitor.js';
import { ThermalController } from '../pi/thermal-controller/thermal-controller.js';
import type { PiConfiguration } from '../pi/types/pi-configuration.js';
import type { AgentExecutionRequest } from '../pi/agent-integration.js';

const log = createSubsystemLogger('gateway/agent-pi-integration');

export interface GatewayAgentPiIntegrationOptions {
  /** Enable Pi AI agent optimization */
  enabled?: boolean;
  /** Resource-aware scheduling settings */
  resourceAwareScheduling?: {
    enabled?: boolean;
    maxConcurrentAgents?: number;
    memoryThresholdPercent?: number;
    cpuThresholdPercent?: number;
  };
  /** Thermal-aware processing settings */
  thermalAwareProcessing?: {
    enabled?: boolean;
    temperatureThresholds?: {
      reduceAgents?: number;
      pauseAgents?: number;
    };
    cooldownPeriodMs?: number;
  };
  /** Model optimization settings */
  modelOptimizations?: {
    enabled?: boolean;
    preferLightweightModels?: boolean;
    reduceContextWindow?: boolean;
    batchRequests?: boolean;
  };
}

export interface GatewayAgentPiIntegrationState {
  enabled: boolean;
  integration: PiAgentIntegration | null;
  lastMetrics?: ReturnType<PiAgentIntegration['getMetrics']>;
  lastQueueStatus?: ReturnType<PiAgentIntegration['getQueueStatus']>;
}

/**
 * Initializes Pi AI agent integration for Gateway
 */
export async function initializeGatewayAgentPiIntegration(
  piConfig: PiConfiguration,
  resourceMonitor?: ResourceMonitor,
  thermalController?: ThermalController,
  options: GatewayAgentPiIntegrationOptions = {}
): Promise<GatewayAgentPiIntegrationState> {
  const {
    enabled = true,
    resourceAwareScheduling = {},
    thermalAwareProcessing = {},
    modelOptimizations = {},
  } = options;

  log.info('Initializing Gateway Pi AI agent integration...', {
    enabled,
    piModel: piConfig.model,
    memoryLimit: piConfig.memory.limit,
  });

  if (!enabled) {
    log.info('Pi AI agent integration disabled');
    return {
      enabled: false,
      integration: null,
    };
  }

  try {
    // Create Pi AI agent integration instance
    const integration = new PiAgentIntegration(piConfig, resourceMonitor, thermalController, {
      enabled: true,
      resourceAwareScheduling: {
        enabled: resourceAwareScheduling.enabled !== false,
        maxConcurrentAgents: resourceAwareScheduling.maxConcurrentAgents || (piConfig.memory.total <= 1024 ? 1 : 2),
        memoryThresholdPercent: resourceAwareScheduling.memoryThresholdPercent || 80,
        cpuThresholdPercent: resourceAwareScheduling.cpuThresholdPercent || 85,
      },
      thermalAwareProcessing: {
        enabled: thermalAwareProcessing.enabled !== false,
        temperatureThresholds: {
          reduceAgents: thermalAwareProcessing.temperatureThresholds?.reduceAgents || 70,
          pauseAgents: thermalAwareProcessing.temperatureThresholds?.pauseAgents || 80,
        },
        cooldownPeriodMs: thermalAwareProcessing.cooldownPeriodMs || 60000,
      },
      modelOptimizations: {
        enabled: modelOptimizations.enabled !== false,
        preferLightweightModels: modelOptimizations.preferLightweightModels !== false,
        reduceContextWindow: modelOptimizations.reduceContextWindow !== false,
        batchRequests: modelOptimizations.batchRequests !== false,
      },
      queueManagement: {
        enabled: true,
        maxQueueSize: 50,
        priorityLevels: 10,
        timeoutMs: 300000, // 5 minutes
      },
    });

    // Start the integration
    await integration.start();

    log.info('Gateway Pi AI agent integration initialized successfully');

    return {
      enabled: true,
      integration,
    };
  } catch (error) {
    log.error('Failed to initialize Gateway Pi AI agent integration:', { error: error instanceof Error ? error.message : String(error) });
    
    return {
      enabled: false,
      integration: null,
    };
  }
}

/**
 * Sets up Pi AI agent integration with Gateway WebSocket handlers and broadcasting
 */
export function setupGatewayAgentPiIntegration(
  state: GatewayAgentPiIntegrationState,
  broadcast: (event: string, payload: unknown, options?: { dropIfSlow?: boolean }) => void,
  registerHandlers: (handlers: Record<string, (...args: any[]) => any>) => void
): void {
  log.info('Setting up Gateway Pi AI agent integration handlers', {
    enabled: state.enabled,
    hasIntegration: !!state.integration,
  });

  if (!state.integration) {
    log.info('Pi AI agent integration not available');
    return;
  }

  // Register Pi AI agent WebSocket handlers
  const agentHandlers = createPiAgentHandlers(state.integration);
  registerHandlers(agentHandlers);

  // Set up event listeners for broadcasting
  setupPiAgentEventBroadcasting(state.integration, broadcast);

  log.info('Gateway Pi AI agent integration setup completed');
}

/**
 * Creates Pi AI agent handlers for Gateway WebSocket methods
 */
function createPiAgentHandlers(
  integration: PiAgentIntegration
): Record<string, (...args: any[]) => any> {
  return {
    /**
     * Gets current AI agent resource metrics
     */
    'pi.agent.getMetrics': async (): Promise<ReturnType<PiAgentIntegration['getMetrics']>> => {
      log.debug('Getting Pi AI agent metrics');
      
      try {
        const metrics = integration.getMetrics();
        
        log.debug('Pi AI agent metrics retrieved', {
          activeAgents: metrics.activeAgents,
          queuedAgents: metrics.queuedAgents,
          totalAgentsProcessed: metrics.totalAgentsProcessed,
        });
        
        return metrics;
      } catch (error) {
        log.error('Failed to get Pi AI agent metrics:', { error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    },

    /**
     * Gets AI agent queue status
     */
    'pi.agent.getQueueStatus': async (): Promise<ReturnType<PiAgentIntegration['getQueueStatus']>> => {
      log.debug('Getting Pi AI agent queue status');
      
      try {
        const status = integration.getQueueStatus();
        
        log.debug('Pi AI agent queue status retrieved', {
          queueSize: status.queueSize,
          activeAgents: status.activeAgents,
          averageWaitTimeMs: status.averageWaitTimeMs,
        });
        
        return status;
      } catch (error) {
        log.error('Failed to get Pi AI agent queue status:', { error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    },

    /**
     * Queues an AI agent execution request
     */
    'pi.agent.queueExecution': async (params: {
      sessionKey: string;
      agentId: string;
      model: string;
      provider: string;
      priority?: number;
      estimatedTokens: number;
      estimatedDurationMs: number;
      thermalSensitive?: boolean;
      memoryIntensive?: boolean;
    }): Promise<{ success: boolean; agentId?: string; message: string }> => {
      const {
        priority = 5,
        thermalSensitive = false,
        memoryIntensive = false,
        ...requestData
      } = params;
      
      log.debug('Queuing AI agent execution', {
        sessionKey: requestData.sessionKey,
        agentId: requestData.agentId,
        model: requestData.model,
        priority,
      });
      
      try {
        const agentId = await integration.queueAgentExecution({
          ...requestData,
          priority,
          thermalSensitive,
          memoryIntensive,
        });
        
        const message = `AI agent execution queued successfully with ID: ${agentId}`;
        log.info(message, { agentId, sessionKey: requestData.sessionKey });
        
        return {
          success: true,
          agentId,
          message,
        };
      } catch (error) {
        const message = `Failed to queue AI agent execution: ${error instanceof Error ? error.message : 'Unknown error'}`;
        log.error(message, { error: error instanceof Error ? error.message : String(error) });
        
        return {
          success: false,
          message,
        };
      }
    },

    /**
     * Gets optimization recommendations for an agent request
     */
    'pi.agent.getOptimizationRecommendations': async (params: {
      sessionKey: string;
      agentId: string;
      model: string;
      provider: string;
      estimatedTokens: number;
      estimatedDurationMs: number;
      thermalSensitive?: boolean;
      memoryIntensive?: boolean;
    }): Promise<ReturnType<PiAgentIntegration['getOptimizationRecommendations']>> => {
      log.debug('Getting AI agent optimization recommendations', {
        sessionKey: params.sessionKey,
        model: params.model,
        estimatedTokens: params.estimatedTokens,
      });
      
      try {
        // Create a mock agent request for recommendations
        const mockRequest: AgentExecutionRequest = {
          id: 'temp-id',
          queuedAt: new Date(),
          status: 'queued',
          priority: 5,
          thermalSensitive: params.thermalSensitive || false,
          memoryIntensive: params.memoryIntensive || false,
          ...params,
        };
        
        const recommendations = integration.getOptimizationRecommendations(mockRequest);
        
        log.debug('AI agent optimization recommendations retrieved', {
          recommendationCount: recommendations.length,
          types: recommendations.map(r => r.type),
        });
        
        return recommendations;
      } catch (error) {
        log.error('Failed to get AI agent optimization recommendations:', { error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    },

    /**
     * Cancels a queued AI agent execution
     */
    'pi.agent.cancelExecution': async (params: {
      agentId: string;
      reason?: string;
    }): Promise<{ success: boolean; message: string }> => {
      const { agentId, reason = 'User cancelled' } = params;
      log.debug('Cancelling AI agent execution', { agentId, reason });
      
      try {
        const cancelled = integration.cancelAgentExecution(agentId, reason);
        
        if (cancelled) {
          const message = `AI agent execution cancelled successfully: ${agentId}`;
          log.info(message, { agentId, reason });
          
          return {
            success: true,
            message,
          };
        } else {
          const message = `AI agent execution not found or already completed: ${agentId}`;
          log.warn(message, { agentId });
          
          return {
            success: false,
            message,
          };
        }
      } catch (error) {
        const message = `Failed to cancel AI agent execution: ${error instanceof Error ? error.message : 'Unknown error'}`;
        log.error(message, { agentId, error: error instanceof Error ? error.message : String(error) });
        
        return {
          success: false,
          message,
        };
      }
    },
  };
}

/**
 * Sets up Pi AI agent event broadcasting to Gateway clients
 */
function setupPiAgentEventBroadcasting(
  integration: PiAgentIntegration,
  broadcast: (event: string, payload: unknown, options?: { dropIfSlow?: boolean }) => void
): void {
  // Broadcast AI agent events to connected clients
  integration.on('agentQueued', (event) => {
    log.debug('Broadcasting agent queued event', event);
    broadcast('pi.agent.queued', event, { dropIfSlow: true });
  });

  integration.on('agentStarted', (event) => {
    log.debug('Broadcasting agent started event', event);
    broadcast('pi.agent.started', event, { dropIfSlow: true });
  });

  integration.on('agentCompleted', (event) => {
    log.debug('Broadcasting agent completed event', event);
    broadcast('pi.agent.completed', event, { dropIfSlow: true });
  });

  integration.on('agentCancelled', (event) => {
    log.debug('Broadcasting agent cancelled event', event);
    broadcast('pi.agent.cancelled', event, { dropIfSlow: true });
  });

  integration.on('resourcePressure', (event) => {
    log.debug('Broadcasting resource pressure event', event);
    broadcast('pi.agent.resourcePressure', event, { dropIfSlow: true });
  });

  integration.on('thermalThrottling', (event) => {
    log.warn('Broadcasting thermal throttling event', event);
    broadcast('pi.agent.thermalThrottling', event, { dropIfSlow: true });
  });

  integration.on('thermalRecovery', (event) => {
    log.info('Broadcasting thermal recovery event', event);
    broadcast('pi.agent.thermalRecovery', event, { dropIfSlow: true });
  });

  integration.on('started', () => {
    log.info('Pi AI agent integration started, broadcasting status change');
    broadcast('pi.agent.statusChanged', {
      started: true,
      timestamp: new Date(),
    }, { dropIfSlow: true });
  });

  integration.on('stopped', () => {
    log.info('Pi AI agent integration stopped, broadcasting status change');
    broadcast('pi.agent.statusChanged', {
      started: false,
      timestamp: new Date(),
    }, { dropIfSlow: true });
  });

  integration.on('error', (error) => {
    log.error('Pi AI agent integration error:', { error: error instanceof Error ? error.message : String(error) });
    broadcast('pi.agent.error', {
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date(),
    }, { dropIfSlow: true });
  });
}

/**
 * Stops Pi AI agent integration and cleans up resources
 */
export async function stopGatewayAgentPiIntegration(
  state: GatewayAgentPiIntegrationState
): Promise<void> {
  if (!state.integration) {
    return;
  }

  try {
    log.info('Stopping Gateway Pi AI agent integration...');
    await state.integration.stop();
    log.info('Gateway Pi AI agent integration stopped');
  } catch (error) {
    log.error('Error stopping Gateway Pi AI agent integration:', { error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Gets Pi AI agent integration health status
 */
export function getPiAgentIntegrationHealth(
  state: GatewayAgentPiIntegrationState
): {
  enabled: boolean;
  integrationActive: boolean;
  metrics?: ReturnType<PiAgentIntegration['getMetrics']>;
  queueStatus?: ReturnType<PiAgentIntegration['getQueueStatus']>;
} {
  return {
    enabled: state.enabled,
    integrationActive: !!state.integration,
    metrics: state.integration?.getMetrics(),
    queueStatus: state.integration?.getQueueStatus(),
  };
}

/**
 * Pi AI agent integration event types for Gateway
 */
export const GATEWAY_PI_AGENT_EVENTS = {
  AGENT_QUEUED: 'pi.agent.queued',
  AGENT_STARTED: 'pi.agent.started',
  AGENT_COMPLETED: 'pi.agent.completed',
  AGENT_CANCELLED: 'pi.agent.cancelled',
  RESOURCE_PRESSURE: 'pi.agent.resourcePressure',
  THERMAL_THROTTLING: 'pi.agent.thermalThrottling',
  THERMAL_RECOVERY: 'pi.agent.thermalRecovery',
  STATUS_CHANGED: 'pi.agent.statusChanged',
  ERROR: 'pi.agent.error',
} as const;