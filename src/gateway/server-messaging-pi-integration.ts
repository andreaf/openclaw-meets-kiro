/**
 * Gateway Pi Messaging Integration
 * 
 * Integrates Pi messaging optimization with OpenClaw Gateway service.
 * Provides network optimization, offline message queuing, and Pi-specific
 * optimizations for messaging channels through the Gateway.
 * 
 * Requirements: 8.4 - Offline message queuing for all channels
 */

import { createSubsystemLogger } from '../logging/subsystem.js';
import { PiMessagingIntegration } from '../pi/messaging-integration.js';
import type { PiConfiguration } from '../pi/types/pi-configuration.js';
import type { ChannelId } from '../channels/plugins/types.js';

const log = createSubsystemLogger('gateway/messaging-pi-integration');

export interface GatewayMessagingPiIntegrationOptions {
  /** Enable Pi messaging optimization */
  enabled?: boolean;
  /** Network optimization settings */
  networkOptimization?: {
    enabled?: boolean;
    connectionPooling?: boolean;
    dataCompression?: boolean;
    qosEnabled?: boolean;
  };
  /** Offline message handling settings */
  offlineMessageHandling?: {
    enabled?: boolean;
    maxQueueSize?: number;
    persistToDisk?: boolean;
    retryIntervalMs?: number;
    maxRetries?: number;
  };
}

export interface GatewayMessagingPiIntegrationState {
  enabled: boolean;
  integration: PiMessagingIntegration | null;
  lastNetworkMetrics?: ReturnType<PiMessagingIntegration['getNetworkMetrics']>;
  lastQueueStatus?: ReturnType<PiMessagingIntegration['getMessageQueueStatus']>;
}

/**
 * Initializes Pi messaging integration for Gateway
 */
export async function initializeGatewayMessagingPiIntegration(
  piConfig: PiConfiguration,
  options: GatewayMessagingPiIntegrationOptions = {}
): Promise<GatewayMessagingPiIntegrationState> {
  const {
    enabled = true,
    networkOptimization = {},
    offlineMessageHandling = {},
  } = options;

  log.info('Initializing Gateway Pi messaging integration...', {
    enabled,
    piModel: piConfig.model,
    memoryLimit: piConfig.memory.limit,
  });

  if (!enabled) {
    log.info('Pi messaging integration disabled');
    return {
      enabled: false,
      integration: null,
    };
  }

  try {
    // Create Pi messaging integration instance
    const integration = new PiMessagingIntegration(piConfig, {
      enabled: true,
      networkOptimization: {
        enabled: networkOptimization.enabled !== false,
        connectionPooling: networkOptimization.connectionPooling !== false,
        dataCompression: networkOptimization.dataCompression !== false,
        qosEnabled: networkOptimization.qosEnabled !== false,
      },
      offlineMessageHandling: {
        enabled: offlineMessageHandling.enabled !== false,
        maxQueueSize: offlineMessageHandling.maxQueueSize || 1000,
        persistToDisk: offlineMessageHandling.persistToDisk !== false,
        retryIntervalMs: offlineMessageHandling.retryIntervalMs || 30000,
        maxRetries: offlineMessageHandling.maxRetries || 5,
      },
      channelOptimizations: {
        enabled: true,
        lowBandwidthMode: piConfig.memory.total <= 1024,
        reducedPolling: true,
        batchMessages: true,
      },
    });

    // Start the integration
    await integration.start();

    log.info('Gateway Pi messaging integration initialized successfully');

    return {
      enabled: true,
      integration,
    };
  } catch (error) {
    log.error('Failed to initialize Gateway Pi messaging integration:', { error: error instanceof Error ? error.message : String(error) });
    
    return {
      enabled: false,
      integration: null,
    };
  }
}

/**
 * Sets up Pi messaging integration with Gateway WebSocket handlers and broadcasting
 */
export function setupGatewayMessagingPiIntegration(
  state: GatewayMessagingPiIntegrationState,
  broadcast: (event: string, payload: unknown, options?: { dropIfSlow?: boolean }) => void,
  registerHandlers: (handlers: Record<string, (...args: any[]) => any>) => void
): void {
  log.info('Setting up Gateway Pi messaging integration handlers', {
    enabled: state.enabled,
    hasIntegration: !!state.integration,
  });

  if (!state.integration) {
    log.info('Pi messaging integration not available');
    return;
  }

  // Register Pi messaging WebSocket handlers
  const messagingHandlers = createPiMessagingHandlers(state.integration);
  registerHandlers(messagingHandlers);

  // Set up event listeners for broadcasting
  setupPiMessagingEventBroadcasting(state.integration, broadcast);

  log.info('Gateway Pi messaging integration setup completed');
}

/**
 * Creates Pi messaging handlers for Gateway WebSocket methods
 */
function createPiMessagingHandlers(
  integration: PiMessagingIntegration
): Record<string, (...args: any[]) => any> {
  return {
    /**
     * Gets current network metrics for messaging channels
     */
    'pi.messaging.getNetworkMetrics': async (): Promise<ReturnType<PiMessagingIntegration['getNetworkMetrics']>> => {
      log.debug('Getting Pi messaging network metrics');
      
      try {
        const metrics = integration.getNetworkMetrics();
        
        log.debug('Pi messaging network metrics retrieved', {
          connectionCount: metrics.connectionCount,
          activeChannels: metrics.activeChannels.length,
          queuedMessages: metrics.queuedMessages,
        });
        
        return metrics;
      } catch (error) {
        log.error('Failed to get Pi messaging network metrics:', { error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    },

    /**
     * Gets current message queue status
     */
    'pi.messaging.getQueueStatus': async (): Promise<ReturnType<PiMessagingIntegration['getMessageQueueStatus']>> => {
      log.debug('Getting Pi messaging queue status');
      
      try {
        const status = integration.getMessageQueueStatus();
        
        log.debug('Pi messaging queue status retrieved', {
          queueSize: status.queueSize,
          channelCount: Object.keys(status.channelCounts).length,
        });
        
        return status;
      } catch (error) {
        log.error('Failed to get Pi messaging queue status:', { error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    },

    /**
     * Manually retry queued messages
     */
    'pi.messaging.retryQueuedMessages': async (): Promise<{ success: boolean; processed: number; failed: number; message: string }> => {
      log.info('Manually retrying queued messages from Gateway');
      
      try {
        const result = await integration.retryQueuedMessages();
        
        const message = `Processed ${result.processed} messages, ${result.failed} failed`;
        log.info(message, result);
        
        return {
          success: true,
          ...result,
          message,
        };
      } catch (error) {
        const message = `Failed to retry queued messages: ${error instanceof Error ? error.message : 'Unknown error'}`;
        log.error(message, { error: error instanceof Error ? error.message : String(error) });
        
        return {
          success: false,
          processed: 0,
          failed: 0,
          message,
        };
      }
    },

    /**
     * Optimizes connection for a specific channel
     */
    'pi.messaging.optimizeChannel': async (params: {
      channelId: ChannelId;
      connectionInfo: {
        host: string;
        port?: number;
        protocol: 'http' | 'https' | 'ws' | 'wss';
      };
    }): Promise<{
      success: boolean;
      optimizedConfig: Record<string, unknown>;
      compressionEnabled: boolean;
      poolingEnabled: boolean;
    }> => {
      const { channelId, connectionInfo } = params;
      log.debug('Optimizing channel connection', { channelId, connectionInfo });
      
      try {
        const result = integration.optimizeChannelConnection(channelId, connectionInfo);
        
        log.debug('Channel connection optimized', {
          channelId,
          compressionEnabled: result.compressionEnabled,
          poolingEnabled: result.poolingEnabled,
        });
        
        return {
          success: true,
          ...result,
        };
      } catch (error) {
        log.error('Failed to optimize channel connection:', { error: error instanceof Error ? error.message : String(error) });
        
        return {
          success: false,
          optimizedConfig: {},
          compressionEnabled: false,
          poolingEnabled: false,
        };
      }
    },

    /**
     * Queues a message for offline delivery
     */
    'pi.messaging.queueMessage': async (params: {
      channelId: ChannelId;
      accountId?: string;
      type: 'text' | 'media' | 'poll' | 'action';
      payload: {
        to: string;
        text?: string;
        mediaUrl?: string;
        poll?: unknown;
        action?: unknown;
        params?: Record<string, unknown>;
      };
      priority?: 'low' | 'normal' | 'high';
    }): Promise<{ success: boolean; messageId?: string; message: string }> => {
      const { priority = 'normal', ...messageData } = params;
      log.debug('Queuing message for offline delivery', {
        channelId: messageData.channelId,
        type: messageData.type,
        priority,
      });
      
      try {
        const messageId = await integration.queueMessage({
          ...messageData,
          priority,
        });
        
        const message = `Message queued successfully with ID: ${messageId}`;
        log.info(message, { messageId, channelId: messageData.channelId });
        
        return {
          success: true,
          messageId,
          message,
        };
      } catch (error) {
        const message = `Failed to queue message: ${error instanceof Error ? error.message : 'Unknown error'}`;
        log.error(message, { error: error instanceof Error ? error.message : String(error) });
        
        return {
          success: false,
          message,
        };
      }
    },
  };
}

/**
 * Sets up Pi messaging event broadcasting to Gateway clients
 */
function setupPiMessagingEventBroadcasting(
  integration: PiMessagingIntegration,
  broadcast: (event: string, payload: unknown, options?: { dropIfSlow?: boolean }) => void
): void {
  // Broadcast messaging events to connected clients
  integration.on('messageQueued', (event) => {
    log.debug('Broadcasting message queued event', event);
    broadcast('pi.messaging.messageQueued', event, { dropIfSlow: true });
  });

  integration.on('messageProcessed', (event) => {
    log.debug('Broadcasting message processed event', event);
    broadcast('pi.messaging.messageProcessed', event, { dropIfSlow: true });
  });

  integration.on('messageExpired', (event) => {
    log.debug('Broadcasting message expired event', event);
    broadcast('pi.messaging.messageExpired', event, { dropIfSlow: true });
  });

  integration.on('connectivityRestored', (event) => {
    log.info('Broadcasting connectivity restored event', event);
    broadcast('pi.messaging.connectivityRestored', event, { dropIfSlow: true });
  });

  integration.on('connectivityLost', (event) => {
    log.warn('Broadcasting connectivity lost event', event);
    broadcast('pi.messaging.connectivityLost', event, { dropIfSlow: true });
  });

  integration.on('started', () => {
    log.info('Pi messaging integration started, broadcasting status change');
    broadcast('pi.messaging.statusChanged', {
      started: true,
      timestamp: new Date(),
    }, { dropIfSlow: true });
  });

  integration.on('stopped', () => {
    log.info('Pi messaging integration stopped, broadcasting status change');
    broadcast('pi.messaging.statusChanged', {
      started: false,
      timestamp: new Date(),
    }, { dropIfSlow: true });
  });

  integration.on('error', (error) => {
    log.error('Pi messaging integration error:', { error: error instanceof Error ? error.message : String(error) });
    broadcast('pi.messaging.error', {
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date(),
    }, { dropIfSlow: true });
  });
}

/**
 * Stops Pi messaging integration and cleans up resources
 */
export async function stopGatewayMessagingPiIntegration(
  state: GatewayMessagingPiIntegrationState
): Promise<void> {
  if (!state.integration) {
    return;
  }

  try {
    log.info('Stopping Gateway Pi messaging integration...');
    await state.integration.stop();
    log.info('Gateway Pi messaging integration stopped');
  } catch (error) {
    log.error('Error stopping Gateway Pi messaging integration:', { error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Gets Pi messaging integration health status
 */
export function getPiMessagingIntegrationHealth(
  state: GatewayMessagingPiIntegrationState
): {
  enabled: boolean;
  integrationActive: boolean;
  networkMetrics?: ReturnType<PiMessagingIntegration['getNetworkMetrics']>;
  queueStatus?: ReturnType<PiMessagingIntegration['getMessageQueueStatus']>;
} {
  return {
    enabled: state.enabled,
    integrationActive: !!state.integration,
    networkMetrics: state.integration?.getNetworkMetrics(),
    queueStatus: state.integration?.getMessageQueueStatus(),
  };
}

/**
 * Pi messaging integration event types for Gateway
 */
export const GATEWAY_PI_MESSAGING_EVENTS = {
  MESSAGE_QUEUED: 'pi.messaging.messageQueued',
  MESSAGE_PROCESSED: 'pi.messaging.messageProcessed',
  MESSAGE_EXPIRED: 'pi.messaging.messageExpired',
  CONNECTIVITY_RESTORED: 'pi.messaging.connectivityRestored',
  CONNECTIVITY_LOST: 'pi.messaging.connectivityLost',
  STATUS_CHANGED: 'pi.messaging.statusChanged',
  ERROR: 'pi.messaging.error',
} as const;