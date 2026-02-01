/**
 * Pi Messaging Channel Integration
 * 
 * Integrates Pi optimization layer with OpenClaw messaging channels.
 * Provides network optimization, offline message queuing, and Pi-specific
 * optimizations for messaging channels like WhatsApp, Telegram, Discord, etc.
 * 
 * Requirements: 8.4 - Offline message queuing for all channels
 */

import { EventEmitter } from 'node:events';
import { createSubsystemLogger } from '../logging/subsystem.js';
import type { PiConfiguration } from './types/pi-configuration.js';
import type { ChannelId, ChannelPlugin } from '../channels/plugins/types.js';
import { listChannelPlugins } from '../channels/plugins/index.js';

export interface PiMessagingIntegrationConfig {
  /** Enable Pi messaging optimization */
  enabled: boolean;
  /** Network optimization settings */
  networkOptimization: {
    enabled: boolean;
    connectionPooling: boolean;
    dataCompression: boolean;
    qosEnabled: boolean;
  };
  /** Offline message handling */
  offlineMessageHandling: {
    enabled: boolean;
    maxQueueSize: number; // Maximum messages to queue
    persistToDisk: boolean;
    retryIntervalMs: number;
    maxRetries: number;
  };
  /** Pi-specific channel optimizations */
  channelOptimizations: {
    enabled: boolean;
    lowBandwidthMode: boolean;
    reducedPolling: boolean;
    batchMessages: boolean;
  };
}

export interface QueuedMessage {
  id: string;
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
  timestamp: Date;
  retryCount: number;
  lastRetryAt?: Date;
  priority: 'low' | 'normal' | 'high';
}

export interface NetworkMetrics {
  connectionCount: number;
  activeChannels: string[];
  bytesTransferred: number;
  compressionRatio: number;
  averageLatency: number;
  failedConnections: number;
  queuedMessages: number;
  lastConnectivityCheck: Date;
}

/**
 * Pi Messaging Channel Integration
 * 
 * Provides Pi-specific optimizations for messaging channels
 */
export class PiMessagingIntegration extends EventEmitter {
  private config: PiMessagingIntegrationConfig;
  private piConfig: PiConfiguration;
  private logger = createSubsystemLogger('pi/messaging-integration');
  
  // Integration state
  private isStarted = false;
  private messageQueue: QueuedMessage[] = [];
  private networkMetrics: NetworkMetrics;
  private connectivityCheckInterval?: NodeJS.Timeout;
  private messageRetryInterval?: NodeJS.Timeout;
  private channelOptimizations = new Map<ChannelId, boolean>();
  
  // Network state tracking
  private isOnline = true;
  private lastConnectivityCheck = new Date();
  private connectionPool = new Map<string, { connections: number; lastUsed: Date }>();

  constructor(
    piConfig: PiConfiguration,
    integrationConfig: Partial<PiMessagingIntegrationConfig> = {}
  ) {
    super();
    this.piConfig = piConfig;
    this.config = {
      enabled: true,
      networkOptimization: {
        enabled: true,
        connectionPooling: true,
        dataCompression: true,
        qosEnabled: true,
      },
      offlineMessageHandling: {
        enabled: true,
        maxQueueSize: 1000,
        persistToDisk: true,
        retryIntervalMs: 30000, // 30 seconds
        maxRetries: 5,
      },
      channelOptimizations: {
        enabled: true,
        lowBandwidthMode: this.piConfig.memory.total <= 1024, // Enable for low-memory Pi models
        reducedPolling: true,
        batchMessages: true,
      },
      ...integrationConfig,
    };

    this.networkMetrics = {
      connectionCount: 0,
      activeChannels: [],
      bytesTransferred: 0,
      compressionRatio: 1.0,
      averageLatency: 0,
      failedConnections: 0,
      queuedMessages: 0,
      lastConnectivityCheck: new Date(),
    };

    this.logger.info('Pi messaging integration initialized', {
      piModel: piConfig.model,
      lowBandwidthMode: this.config.channelOptimizations.lowBandwidthMode,
      offlineHandling: this.config.offlineMessageHandling.enabled,
      networkOptimization: this.config.networkOptimization.enabled,
    });
  }

  /**
   * Starts Pi messaging integration
   */
  async start(): Promise<void> {
    if (this.isStarted) {
      this.logger.warn('Pi messaging integration already started');
      return;
    }

    if (!this.config.enabled) {
      this.logger.info('Pi messaging integration disabled');
      return;
    }

    try {
      this.logger.info('Starting Pi messaging integration...');

      // Initialize channel optimizations
      await this.initializeChannelOptimizations();

      // Start connectivity monitoring
      if (this.config.networkOptimization.enabled) {
        this.startConnectivityMonitoring();
      }

      // Start message retry processing
      if (this.config.offlineMessageHandling.enabled) {
        this.startMessageRetryProcessing();
      }

      // Load persisted message queue
      if (this.config.offlineMessageHandling.persistToDisk) {
        await this.loadPersistedMessageQueue();
      }

      this.isStarted = true;
      this.emit('started', { timestamp: new Date() });
      this.logger.info('Pi messaging integration started successfully');
    } catch (error) {
      this.logger.error('Failed to start Pi messaging integration:', { error: error instanceof Error ? error.message : String(error) });
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Stops Pi messaging integration
   */
  async stop(): Promise<void> {
    if (!this.isStarted) {
      return;
    }

    try {
      this.logger.info('Stopping Pi messaging integration...');

      // Stop monitoring intervals
      if (this.connectivityCheckInterval) {
        clearInterval(this.connectivityCheckInterval);
        this.connectivityCheckInterval = undefined;
      }

      if (this.messageRetryInterval) {
        clearInterval(this.messageRetryInterval);
        this.messageRetryInterval = undefined;
      }

      // Persist message queue
      if (this.config.offlineMessageHandling.persistToDisk && this.messageQueue.length > 0) {
        await this.persistMessageQueue();
      }

      this.isStarted = false;
      this.emit('stopped', { timestamp: new Date() });
      this.logger.info('Pi messaging integration stopped');
    } catch (error) {
      this.logger.error('Error stopping Pi messaging integration:', { error: error instanceof Error ? error.message : String(error) });
      this.emit('error', error);
    }
  }

  /**
   * Queues a message for offline delivery
   */
  async queueMessage(message: Omit<QueuedMessage, 'id' | 'timestamp' | 'retryCount'>): Promise<string> {
    if (!this.config.offlineMessageHandling.enabled) {
      throw new Error('Offline message handling is disabled');
    }

    if (this.messageQueue.length >= this.config.offlineMessageHandling.maxQueueSize) {
      // Remove oldest low-priority messages to make room
      this.messageQueue = this.messageQueue
        .filter(msg => msg.priority !== 'low')
        .slice(-(this.config.offlineMessageHandling.maxQueueSize - 1));
    }

    const queuedMessage: QueuedMessage = {
      id: this.generateMessageId(),
      timestamp: new Date(),
      retryCount: 0,
      ...message,
    };

    this.messageQueue.push(queuedMessage);
    this.networkMetrics.queuedMessages = this.messageQueue.length;

    this.logger.debug('Message queued for offline delivery', {
      messageId: queuedMessage.id,
      channelId: queuedMessage.channelId,
      priority: queuedMessage.priority,
      queueSize: this.messageQueue.length,
    });

    this.emit('messageQueued', {
      messageId: queuedMessage.id,
      channelId: queuedMessage.channelId,
      queueSize: this.messageQueue.length,
    });

    // Persist queue if enabled
    if (this.config.offlineMessageHandling.persistToDisk) {
      await this.persistMessageQueue();
    }

    return queuedMessage.id;
  }

  /**
   * Optimizes network connection for a channel
   */
  optimizeChannelConnection(channelId: ChannelId, connectionInfo: {
    host: string;
    port?: number;
    protocol: 'http' | 'https' | 'ws' | 'wss';
  }): {
    optimizedConfig: Record<string, unknown>;
    compressionEnabled: boolean;
    poolingEnabled: boolean;
  } {
    if (!this.config.networkOptimization.enabled) {
      return {
        optimizedConfig: {},
        compressionEnabled: false,
        poolingEnabled: false,
      };
    }

    const connectionKey = `${connectionInfo.protocol}://${connectionInfo.host}:${connectionInfo.port || 443}`;
    
    // Update connection pool tracking
    const poolEntry = this.connectionPool.get(connectionKey) || { connections: 0, lastUsed: new Date() };
    poolEntry.connections += 1;
    poolEntry.lastUsed = new Date();
    this.connectionPool.set(connectionKey, poolEntry);

    const optimizedConfig: Record<string, unknown> = {};

    // Enable connection pooling
    if (this.config.networkOptimization.connectionPooling) {
      optimizedConfig.keepAlive = true;
      optimizedConfig.keepAliveMsecs = 30000; // 30 seconds
      optimizedConfig.maxSockets = this.piConfig.memory.total <= 1024 ? 5 : 10; // Limit for low-memory Pi
    }

    // Enable compression
    if (this.config.networkOptimization.dataCompression) {
      optimizedConfig.compression = true;
      optimizedConfig.compressionLevel = 6; // Balanced compression
    }

    // QoS settings for Pi
    if (this.config.networkOptimization.qosEnabled) {
      optimizedConfig.timeout = this.piConfig.memory.total <= 1024 ? 60000 : 30000; // Longer timeout for low-memory Pi
      optimizedConfig.retries = 3;
      optimizedConfig.retryDelay = 1000;
    }

    // Low bandwidth optimizations
    if (this.config.channelOptimizations.lowBandwidthMode) {
      optimizedConfig.maxConcurrentRequests = 2;
      optimizedConfig.requestDelay = 100; // Small delay between requests
    }

    this.logger.debug('Channel connection optimized', {
      channelId,
      connectionKey,
      poolConnections: poolEntry.connections,
      lowBandwidthMode: this.config.channelOptimizations.lowBandwidthMode,
    });

    return {
      optimizedConfig,
      compressionEnabled: this.config.networkOptimization.dataCompression,
      poolingEnabled: this.config.networkOptimization.connectionPooling,
    };
  }

  /**
   * Gets current network metrics
   */
  getNetworkMetrics(): NetworkMetrics {
    return { ...this.networkMetrics };
  }

  /**
   * Gets current message queue status
   */
  getMessageQueueStatus(): {
    queueSize: number;
    oldestMessage?: Date;
    priorityCounts: Record<string, number>;
    channelCounts: Record<string, number>;
  } {
    const priorityCounts = { low: 0, normal: 0, high: 0 };
    const channelCounts: Record<string, number> = {};

    for (const message of this.messageQueue) {
      priorityCounts[message.priority]++;
      channelCounts[message.channelId] = (channelCounts[message.channelId] || 0) + 1;
    }

    return {
      queueSize: this.messageQueue.length,
      oldestMessage: this.messageQueue.length > 0 ? this.messageQueue[0].timestamp : undefined,
      priorityCounts,
      channelCounts,
    };
  }

  /**
   * Forces immediate retry of queued messages
   */
  async retryQueuedMessages(): Promise<{ processed: number; failed: number }> {
    if (!this.isOnline || this.messageQueue.length === 0) {
      return { processed: 0, failed: 0 };
    }

    let processed = 0;
    let failed = 0;

    // Process messages by priority
    const sortedMessages = [...this.messageQueue].toSorted((a, b) => {
      const priorityOrder = { high: 3, normal: 2, low: 1 };
      return priorityOrder[b.priority] - priorityOrder[a.priority];
    });

    for (const message of sortedMessages) {
      try {
        await this.processQueuedMessage(message);
        this.removeMessageFromQueue(message.id);
        processed++;
      } catch (error) {
        this.logger.warn('Failed to process queued message', {
          messageId: message.id,
          channelId: message.channelId,
          retryCount: message.retryCount,
          error: error instanceof Error ? error.message : String(error),
        });
        
        message.retryCount++;
        message.lastRetryAt = new Date();
        
        if (message.retryCount >= this.config.offlineMessageHandling.maxRetries) {
          this.removeMessageFromQueue(message.id);
          this.emit('messageExpired', {
            messageId: message.id,
            channelId: message.channelId,
            retryCount: message.retryCount,
          });
        }
        
        failed++;
      }
    }

    this.networkMetrics.queuedMessages = this.messageQueue.length;

    if (processed > 0 || failed > 0) {
      this.logger.info('Queued message retry completed', {
        processed,
        failed,
        remaining: this.messageQueue.length,
      });
    }

    return { processed, failed };
  }

  /**
   * Initializes channel-specific optimizations
   */
  private async initializeChannelOptimizations(): Promise<void> {
    const channels = listChannelPlugins();
    
    for (const channel of channels) {
      const shouldOptimize = this.shouldOptimizeChannel(channel);
      this.channelOptimizations.set(channel.id, shouldOptimize);
      
      if (shouldOptimize) {
        this.logger.debug('Channel optimization enabled', {
          channelId: channel.id,
          channelLabel: channel.meta.label,
        });
      }
    }

    this.networkMetrics.activeChannels = Array.from(this.channelOptimizations.keys());
  }

  /**
   * Determines if a channel should be optimized
   */
  private shouldOptimizeChannel(channel: ChannelPlugin): boolean {
    if (!this.config.channelOptimizations.enabled) {
      return false;
    }

    // Always optimize messaging channels
    const messagingChannels = ['whatsapp', 'telegram', 'discord', 'slack', 'signal'];
    if (messagingChannels.includes(channel.id)) {
      return true;
    }

    // Optimize channels with media capabilities on low-memory Pi
    if (this.config.channelOptimizations.lowBandwidthMode && channel.capabilities.media) {
      return true;
    }

    return false;
  }

  /**
   * Starts connectivity monitoring
   */
  private startConnectivityMonitoring(): void {
    this.connectivityCheckInterval = setInterval(async () => {
      try {
        const wasOnline = this.isOnline;
        this.isOnline = await this.checkConnectivity();
        this.lastConnectivityCheck = new Date();
        this.networkMetrics.lastConnectivityCheck = this.lastConnectivityCheck;

        if (!wasOnline && this.isOnline) {
          this.logger.info('Connectivity restored, processing queued messages');
          this.emit('connectivityRestored', { timestamp: new Date() });
          
          // Process queued messages when connectivity is restored
          setTimeout(() => {
            this.retryQueuedMessages().catch(error => {
              this.logger.error('Error processing queued messages after connectivity restore:', { error: error instanceof Error ? error.message : String(error) });
            });
          }, 1000); // Small delay to ensure connection is stable
        } else if (wasOnline && !this.isOnline) {
          this.logger.warn('Connectivity lost, messages will be queued');
          this.emit('connectivityLost', { timestamp: new Date() });
        }
      } catch (error) {
        this.logger.error('Error during connectivity check:', { error: error instanceof Error ? error.message : String(error) });
      }
    }, 30000); // Check every 30 seconds
  }

  /**
   * Starts message retry processing
   */
  private startMessageRetryProcessing(): void {
    this.messageRetryInterval = setInterval(async () => {
      if (this.isOnline && this.messageQueue.length > 0) {
        await this.retryQueuedMessages();
      }
    }, this.config.offlineMessageHandling.retryIntervalMs);
  }

  /**
   * Checks network connectivity
   */
  private async checkConnectivity(): Promise<boolean> {
    try {
      // Simple connectivity check using DNS resolution
      const { execSync } = await import('node:child_process');
      execSync('nslookup google.com', { timeout: 5000, stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Processes a queued message
   */
  private async processQueuedMessage(message: QueuedMessage): Promise<void> {
    // This would integrate with the actual channel sending logic
    // For now, we'll simulate the process
    this.logger.debug('Processing queued message', {
      messageId: message.id,
      channelId: message.channelId,
      type: message.type,
    });

    // Simulate network delay based on Pi performance
    const delay = this.piConfig.memory.total <= 1024 ? 1000 : 500;
    await new Promise(resolve => setTimeout(resolve, delay));

    // Update metrics
    this.networkMetrics.bytesTransferred += this.estimateMessageSize(message);
    
    this.emit('messageProcessed', {
      messageId: message.id,
      channelId: message.channelId,
      processingTime: delay,
    });
  }

  /**
   * Removes a message from the queue
   */
  private removeMessageFromQueue(messageId: string): void {
    const index = this.messageQueue.findIndex(msg => msg.id === messageId);
    if (index !== -1) {
      this.messageQueue.splice(index, 1);
      this.networkMetrics.queuedMessages = this.messageQueue.length;
    }
  }

  /**
   * Estimates message size for metrics
   */
  private estimateMessageSize(message: QueuedMessage): number {
    let size = 0;
    
    if (message.payload.text) {
      size += message.payload.text.length * 2; // UTF-16 encoding
    }
    
    if (message.payload.mediaUrl) {
      size += 1024; // Estimate for media metadata
    }
    
    size += JSON.stringify(message.payload.params || {}).length;
    
    return size;
  }

  /**
   * Generates a unique message ID
   */
  private generateMessageId(): string {
    return `pi-msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Loads persisted message queue from disk
   */
  private async loadPersistedMessageQueue(): Promise<void> {
    try {
      const { readFileSync, existsSync } = await import('node:fs');
      const queuePath = '/tmp/openclaw-pi-message-queue.json';
      
      if (existsSync(queuePath)) {
        const queueData = readFileSync(queuePath, 'utf8');
        const parsedQueue = JSON.parse(queueData) as QueuedMessage[];
        
        // Validate and restore messages
        this.messageQueue = parsedQueue
          .filter(msg => msg.id && msg.channelId && msg.payload)
          .map(msg => ({
            ...msg,
            timestamp: new Date(msg.timestamp),
            lastRetryAt: msg.lastRetryAt ? new Date(msg.lastRetryAt) : undefined,
          }));
        
        this.networkMetrics.queuedMessages = this.messageQueue.length;
        
        this.logger.info('Loaded persisted message queue', {
          messageCount: this.messageQueue.length,
        });
      }
    } catch (error) {
      this.logger.warn('Failed to load persisted message queue:', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  /**
   * Persists message queue to disk
   */
  private async persistMessageQueue(): Promise<void> {
    try {
      const { writeFileSync } = await import('node:fs');
      const queuePath = '/tmp/openclaw-pi-message-queue.json';
      
      const queueData = JSON.stringify(this.messageQueue, null, 2);
      writeFileSync(queuePath, queueData, 'utf8');
      
      this.logger.debug('Message queue persisted to disk', {
        messageCount: this.messageQueue.length,
        path: queuePath,
      });
    } catch (error) {
      this.logger.warn('Failed to persist message queue:', { error: error instanceof Error ? error.message : String(error) });
    }
  }
}