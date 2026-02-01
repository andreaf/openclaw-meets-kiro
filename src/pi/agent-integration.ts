/**
 * Pi AI Agent Integration
 * 
 * Integrates Pi optimization layer with OpenClaw AI agents.
 * Provides resource-aware AI agent scheduling, dynamic scaling based on
 * thermal/power constraints, and Pi-specific AI processing optimizations.
 * 
 * Requirements: 5.3 - Dynamic scaling for AI processing based on thermal/power constraints
 */

import { EventEmitter } from 'node:events';
import { createSubsystemLogger } from '../logging/subsystem.js';
import { ResourceMonitor } from './resource-monitor/resource-monitor.js';
import { ThermalController } from './thermal-controller/thermal-controller.js';
import type { PiConfiguration } from './types/pi-configuration.js';

export interface PiAgentIntegrationConfig {
  /** Enable Pi AI agent optimization */
  enabled: boolean;
  /** Resource-aware scheduling settings */
  resourceAwareScheduling: {
    enabled: boolean;
    maxConcurrentAgents: number;
    memoryThresholdPercent: number; // Reduce agents when memory usage exceeds this
    cpuThresholdPercent: number; // Reduce agents when CPU usage exceeds this
  };
  /** Thermal-aware processing settings */
  thermalAwareProcessing: {
    enabled: boolean;
    temperatureThresholds: {
      reduceAgents: number; // Temperature to start reducing agents (°C)
      pauseAgents: number; // Temperature to pause all agents (°C)
    };
    cooldownPeriodMs: number; // Wait time before resuming after thermal throttling
  };
  /** Model optimization settings */
  modelOptimizations: {
    enabled: boolean;
    preferLightweightModels: boolean; // Prefer smaller models on low-resource Pi
    reduceContextWindow: boolean; // Reduce context window under resource pressure
    batchRequests: boolean; // Batch multiple requests when possible
  };
  /** Agent queue management */
  queueManagement: {
    enabled: boolean;
    maxQueueSize: number;
    priorityLevels: number;
    timeoutMs: number; // Maximum time to wait in queue
  };
}

export interface AgentExecutionRequest {
  id: string;
  sessionKey: string;
  agentId: string;
  model: string;
  provider: string;
  priority: number; // 1-10, higher = more priority
  estimatedTokens: number;
  estimatedDurationMs: number;
  thermalSensitive: boolean; // Whether this agent is sensitive to thermal throttling
  memoryIntensive: boolean; // Whether this agent requires significant memory
  queuedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
}

export interface AgentResourceMetrics {
  activeAgents: number;
  queuedAgents: number;
  totalAgentsProcessed: number;
  averageExecutionTimeMs: number;
  thermalThrottlingEvents: number;
  resourceThrottlingEvents: number;
  failedAgents: number;
  currentResourceUsage: {
    cpuPercent: number;
    memoryPercent: number;
    temperatureCelsius: number;
  };
  lastMetricsUpdate: Date;
}

export interface AgentOptimizationRecommendation {
  type: 'model_switch' | 'context_reduction' | 'delay_execution' | 'cancel_request';
  reason: string;
  originalModel?: string;
  recommendedModel?: string;
  originalContextTokens?: number;
  recommendedContextTokens?: number;
  delayMs?: number;
}

/**
 * Pi AI Agent Integration
 * 
 * Provides Pi-specific optimizations for AI agent execution
 */
export class PiAgentIntegration extends EventEmitter {
  private config: PiAgentIntegrationConfig;
  private piConfig: PiConfiguration;
  private resourceMonitor?: ResourceMonitor;
  private thermalController?: ThermalController;
  private logger = createSubsystemLogger('pi/agent-integration');
  
  // Integration state
  private isStarted = false;
  private agentQueue: AgentExecutionRequest[] = [];
  private activeAgents = new Map<string, AgentExecutionRequest>();
  private metrics: AgentResourceMetrics;
  private lastThermalThrottling?: Date;
  private isThermallySuspended = false;
  private processingInterval?: NodeJS.Timeout;
  
  // Model optimization mappings
  private lightweightModelMap = new Map<string, string>([
    ['gpt-4', 'gpt-3.5-turbo'],
    ['claude-3-opus', 'claude-3-haiku'],
    ['gemini-pro', 'gemini-pro-vision'],
  ]);

  constructor(
    piConfig: PiConfiguration,
    resourceMonitor?: ResourceMonitor,
    thermalController?: ThermalController,
    integrationConfig: Partial<PiAgentIntegrationConfig> = {}
  ) {
    super();
    this.piConfig = piConfig;
    this.resourceMonitor = resourceMonitor;
    this.thermalController = thermalController;
    this.config = {
      enabled: true,
      resourceAwareScheduling: {
        enabled: true,
        maxConcurrentAgents: piConfig.memory.total <= 1024 ? 1 : 2, // Limit concurrent agents on low-memory Pi
        memoryThresholdPercent: 80,
        cpuThresholdPercent: 85,
      },
      thermalAwareProcessing: {
        enabled: true,
        temperatureThresholds: {
          reduceAgents: 70, // Start reducing agents at 70°C
          pauseAgents: 80, // Pause all agents at 80°C
        },
        cooldownPeriodMs: 60000, // 1 minute cooldown
      },
      modelOptimizations: {
        enabled: true,
        preferLightweightModels: piConfig.memory.total <= 1024, // Prefer lightweight models on low-memory Pi
        reduceContextWindow: true,
        batchRequests: true,
      },
      queueManagement: {
        enabled: true,
        maxQueueSize: 50,
        priorityLevels: 10,
        timeoutMs: 300000, // 5 minutes
      },
      ...integrationConfig,
    };

    this.metrics = {
      activeAgents: 0,
      queuedAgents: 0,
      totalAgentsProcessed: 0,
      averageExecutionTimeMs: 0,
      thermalThrottlingEvents: 0,
      resourceThrottlingEvents: 0,
      failedAgents: 0,
      currentResourceUsage: {
        cpuPercent: 0,
        memoryPercent: 0,
        temperatureCelsius: 0,
      },
      lastMetricsUpdate: new Date(),
    };

    this.logger.info('Pi agent integration initialized', {
      piModel: piConfig.model,
      memoryLimit: piConfig.memory.limit,
      maxConcurrentAgents: this.config.resourceAwareScheduling.maxConcurrentAgents,
      thermalAwareProcessing: this.config.thermalAwareProcessing.enabled,
      modelOptimizations: this.config.modelOptimizations.enabled,
    });
  }

  /**
   * Starts Pi agent integration
   */
  async start(): Promise<void> {
    if (this.isStarted) {
      this.logger.warn('Pi agent integration already started');
      return;
    }

    if (!this.config.enabled) {
      this.logger.info('Pi agent integration disabled');
      return;
    }

    try {
      this.logger.info('Starting Pi agent integration...');

      // Set up resource monitoring integration
      if (this.resourceMonitor && this.config.resourceAwareScheduling.enabled) {
        this.setupResourceMonitoringIntegration();
      }

      // Set up thermal monitoring integration
      if (this.thermalController && this.config.thermalAwareProcessing.enabled) {
        this.setupThermalMonitoringIntegration();
      }

      // Start agent queue processing
      if (this.config.queueManagement.enabled) {
        this.startQueueProcessing();
      }

      this.isStarted = true;
      this.emit('started', { timestamp: new Date() });
      this.logger.info('Pi agent integration started successfully');
    } catch (error) {
      this.logger.error('Failed to start Pi agent integration:', { error: error instanceof Error ? error.message : String(error) });
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Stops Pi agent integration
   */
  async stop(): Promise<void> {
    if (!this.isStarted) {
      return;
    }

    try {
      this.logger.info('Stopping Pi agent integration...');

      // Stop queue processing
      if (this.processingInterval) {
        clearInterval(this.processingInterval);
        this.processingInterval = undefined;
      }

      // Cancel all queued agents
      for (const agent of this.agentQueue) {
        agent.status = 'cancelled';
        this.emit('agentCancelled', {
          agentId: agent.id,
          sessionKey: agent.sessionKey,
          reason: 'System shutdown',
        });
      }
      this.agentQueue = [];

      this.isStarted = false;
      this.emit('stopped', { timestamp: new Date() });
      this.logger.info('Pi agent integration stopped');
    } catch (error) {
      this.logger.error('Error stopping Pi agent integration:', { error: error instanceof Error ? error.message : String(error) });
      this.emit('error', error);
    }
  }

  /**
   * Queues an AI agent execution request
   */
  async queueAgentExecution(request: Omit<AgentExecutionRequest, 'id' | 'queuedAt' | 'status'>): Promise<string> {
    if (!this.config.queueManagement.enabled) {
      throw new Error('Agent queue management is disabled');
    }

    if (this.agentQueue.length >= this.config.queueManagement.maxQueueSize) {
      // Remove lowest priority queued agents to make room
      this.agentQueue.sort((a, b) => a.priority - b.priority);
      const removed = this.agentQueue.shift();
      if (removed) {
        removed.status = 'cancelled';
        this.emit('agentCancelled', {
          agentId: removed.id,
          sessionKey: removed.sessionKey,
          reason: 'Queue full',
        });
      }
    }

    const agentRequest: AgentExecutionRequest = {
      id: this.generateAgentId(),
      queuedAt: new Date(),
      status: 'queued',
      ...request,
    };

    this.agentQueue.push(agentRequest);
    this.metrics.queuedAgents = this.agentQueue.length;

    this.logger.debug('Agent execution queued', {
      agentId: agentRequest.id,
      sessionKey: agentRequest.sessionKey,
      model: agentRequest.model,
      priority: agentRequest.priority,
      queueSize: this.agentQueue.length,
    });

    this.emit('agentQueued', {
      agentId: agentRequest.id,
      sessionKey: agentRequest.sessionKey,
      queuePosition: this.agentQueue.length,
    });

    return agentRequest.id;
  }

  /**
   * Gets optimization recommendations for an agent request
   */
  getOptimizationRecommendations(request: AgentExecutionRequest): AgentOptimizationRecommendation[] {
    if (!this.config.modelOptimizations.enabled) {
      return [];
    }

    const recommendations: AgentOptimizationRecommendation[] = [];
    const currentMetrics = this.getCurrentResourceMetrics();

    // Check if we should recommend a lightweight model
    if (this.config.modelOptimizations.preferLightweightModels) {
      const lightweightModel = this.lightweightModelMap.get(request.model);
      if (lightweightModel && (
        currentMetrics.memoryPercent > this.config.resourceAwareScheduling.memoryThresholdPercent ||
        currentMetrics.temperatureCelsius > this.config.thermalAwareProcessing.temperatureThresholds.reduceAgents
      )) {
        recommendations.push({
          type: 'model_switch',
          reason: 'High resource usage detected, recommending lightweight model',
          originalModel: request.model,
          recommendedModel: lightweightModel,
        });
      }
    }

    // Check if we should reduce context window
    if (this.config.modelOptimizations.reduceContextWindow && 
        currentMetrics.memoryPercent > this.config.resourceAwareScheduling.memoryThresholdPercent) {
      const reducedTokens = Math.floor(request.estimatedTokens * 0.7); // Reduce by 30%
      recommendations.push({
        type: 'context_reduction',
        reason: 'High memory usage detected, recommending context window reduction',
        originalContextTokens: request.estimatedTokens,
        recommendedContextTokens: reducedTokens,
      });
    }

    // Check if we should delay execution
    if (this.isThermallySuspended || 
        currentMetrics.temperatureCelsius > this.config.thermalAwareProcessing.temperatureThresholds.pauseAgents) {
      recommendations.push({
        type: 'delay_execution',
        reason: 'System is thermally throttled, recommending delayed execution',
        delayMs: this.config.thermalAwareProcessing.cooldownPeriodMs,
      });
    }

    // Check if we should cancel the request
    if (this.activeAgents.size >= this.config.resourceAwareScheduling.maxConcurrentAgents &&
        currentMetrics.cpuPercent > this.config.resourceAwareScheduling.cpuThresholdPercent) {
      recommendations.push({
        type: 'cancel_request',
        reason: 'System is under high load and at maximum concurrent agent capacity',
      });
    }

    return recommendations;
  }

  /**
   * Gets current agent resource metrics
   */
  getMetrics(): AgentResourceMetrics {
    this.updateMetrics();
    return { ...this.metrics };
  }

  /**
   * Gets current agent queue status
   */
  getQueueStatus(): {
    queueSize: number;
    activeAgents: number;
    averageWaitTimeMs: number;
    priorityDistribution: Record<number, number>;
  } {
    const priorityDistribution: Record<number, number> = {};
    let totalWaitTime = 0;
    const now = new Date();

    for (const agent of this.agentQueue) {
      priorityDistribution[agent.priority] = (priorityDistribution[agent.priority] || 0) + 1;
      totalWaitTime += now.getTime() - agent.queuedAt.getTime();
    }

    return {
      queueSize: this.agentQueue.length,
      activeAgents: this.activeAgents.size,
      averageWaitTimeMs: this.agentQueue.length > 0 ? totalWaitTime / this.agentQueue.length : 0,
      priorityDistribution,
    };
  }

  /**
   * Cancels a queued agent execution
   */
  cancelAgentExecution(agentId: string, reason: string = 'User cancelled'): boolean {
    const queueIndex = this.agentQueue.findIndex(agent => agent.id === agentId);
    if (queueIndex !== -1) {
      const agent = this.agentQueue[queueIndex];
      agent.status = 'cancelled';
      this.agentQueue.splice(queueIndex, 1);
      this.metrics.queuedAgents = this.agentQueue.length;

      this.emit('agentCancelled', {
        agentId,
        sessionKey: agent.sessionKey,
        reason,
      });

      this.logger.debug('Agent execution cancelled', { agentId, reason });
      return true;
    }

    return false;
  }

  /**
   * Sets up resource monitoring integration
   */
  private setupResourceMonitoringIntegration(): void {
    if (!this.resourceMonitor) { return; }

    this.resourceMonitor.on('memoryPressure', (data) => {
      this.logger.warn('Memory pressure detected, reducing agent capacity', {
        memoryUsage: Math.round(data.usage * 100),
      });

      this.metrics.resourceThrottlingEvents++;
      this.handleResourcePressure('memory', data.usage);
    });

    this.resourceMonitor.on('highCPUUsage', (data) => {
      this.logger.warn('High CPU usage detected, reducing agent capacity', {
        cpuUsage: Math.round(data.usage * 100),
      });

      this.metrics.resourceThrottlingEvents++;
      this.handleResourcePressure('cpu', data.usage);
    });
  }

  /**
   * Sets up thermal monitoring integration
   */
  private setupThermalMonitoringIntegration(): void {
    if (!this.thermalController) { return; }

    this.thermalController.on('thermalThrottling', (data) => {
      this.logger.warn('Thermal throttling detected, adjusting agent execution', {
        temperature: data.temperature,
        action: data.action,
      });

      this.metrics.thermalThrottlingEvents++;
      this.handleThermalThrottling(data.temperature, data.action);
    });

    this.thermalController.on('thermalRecovery', (data) => {
      this.logger.info('Thermal recovery detected, resuming normal agent execution', {
        temperature: data.temperature,
      });

      this.handleThermalRecovery(data.temperature);
    });
  }

  /**
   * Starts agent queue processing
   */
  private startQueueProcessing(): void {
    this.processingInterval = setInterval(() => {
      this.processAgentQueue();
    }, 1000); // Process queue every second
  }

  /**
   * Processes the agent queue
   */
  private processAgentQueue(): void {
    if (this.isThermallySuspended) {
      return; // Don't process queue during thermal suspension
    }

    // Remove timed-out agents
    const now = new Date();
    this.agentQueue = this.agentQueue.filter(agent => {
      const waitTime = now.getTime() - agent.queuedAt.getTime();
      if (waitTime > this.config.queueManagement.timeoutMs) {
        agent.status = 'cancelled';
        this.emit('agentCancelled', {
          agentId: agent.id,
          sessionKey: agent.sessionKey,
          reason: 'Queue timeout',
        });
        return false;
      }
      return true;
    });

    // Check if we can start more agents
    const maxConcurrent = this.config.resourceAwareScheduling.maxConcurrentAgents;
    const availableSlots = maxConcurrent - this.activeAgents.size;

    if (availableSlots <= 0 || this.agentQueue.length === 0) {
      return;
    }

    // Sort queue by priority (higher priority first)
    this.agentQueue.sort((a, b) => b.priority - a.priority);

    // Start agents up to available slots
    for (let i = 0; i < Math.min(availableSlots, this.agentQueue.length); i++) {
      const agent = this.agentQueue.shift();
      if (agent) {
        this.startAgentExecution(agent);
      }
    }

    this.metrics.queuedAgents = this.agentQueue.length;
  }

  /**
   * Starts execution of an agent
   */
  private startAgentExecution(agent: AgentExecutionRequest): void {
    agent.status = 'running';
    agent.startedAt = new Date();
    this.activeAgents.set(agent.id, agent);
    this.metrics.activeAgents = this.activeAgents.size;

    this.logger.debug('Starting agent execution', {
      agentId: agent.id,
      sessionKey: agent.sessionKey,
      model: agent.model,
      estimatedDurationMs: agent.estimatedDurationMs,
    });

    this.emit('agentStarted', {
      agentId: agent.id,
      sessionKey: agent.sessionKey,
      model: agent.model,
      startedAt: agent.startedAt,
    });

    // Simulate agent completion (in real implementation, this would integrate with actual agent execution)
    setTimeout(() => {
      this.completeAgentExecution(agent.id, 'completed');
    }, agent.estimatedDurationMs);
  }

  /**
   * Completes agent execution
   */
  private completeAgentExecution(agentId: string, status: 'completed' | 'failed'): void {
    const agent = this.activeAgents.get(agentId);
    if (!agent) {
      return;
    }

    agent.status = status;
    agent.completedAt = new Date();
    this.activeAgents.delete(agentId);
    this.metrics.activeAgents = this.activeAgents.size;

    // Update metrics
    this.metrics.totalAgentsProcessed++;
    if (status === 'failed') {
      this.metrics.failedAgents++;
    }

    if (agent.startedAt && agent.completedAt) {
      const executionTime = agent.completedAt.getTime() - agent.startedAt.getTime();
      this.metrics.averageExecutionTimeMs = 
        (this.metrics.averageExecutionTimeMs * (this.metrics.totalAgentsProcessed - 1) + executionTime) / 
        this.metrics.totalAgentsProcessed;
    }

    this.logger.debug('Agent execution completed', {
      agentId,
      sessionKey: agent.sessionKey,
      status,
      executionTimeMs: agent.completedAt.getTime() - (agent.startedAt?.getTime() || agent.queuedAt.getTime()),
    });

    this.emit('agentCompleted', {
      agentId,
      sessionKey: agent.sessionKey,
      status,
      completedAt: agent.completedAt,
    });
  }

  /**
   * Handles resource pressure by reducing agent capacity
   */
  private handleResourcePressure(type: 'memory' | 'cpu', usage: number): void {
    // Cancel lowest priority queued agents if under severe pressure
    if (usage > 0.9) { // 90% usage
      const lowPriorityAgents = this.agentQueue
        .filter(agent => agent.priority <= 3)
        .toSorted((a, b) => a.priority - b.priority);

      for (const agent of lowPriorityAgents.slice(0, 2)) { // Cancel up to 2 low priority agents
        this.cancelAgentExecution(agent.id, `High ${type} usage detected`);
      }
    }

    this.emit('resourcePressure', {
      type,
      usage,
      activeAgents: this.activeAgents.size,
      queuedAgents: this.agentQueue.length,
    });
  }

  /**
   * Handles thermal throttling
   */
  private handleThermalThrottling(temperature: number, action: string): void {
    this.lastThermalThrottling = new Date();

    if (temperature >= this.config.thermalAwareProcessing.temperatureThresholds.pauseAgents) {
      // Pause all agent execution
      this.isThermallySuspended = true;
      
      // Cancel thermal-sensitive queued agents
      const thermalSensitiveAgents = this.agentQueue.filter(agent => agent.thermalSensitive);
      for (const agent of thermalSensitiveAgents) {
        this.cancelAgentExecution(agent.id, 'Thermal throttling detected');
      }
    } else if (temperature >= this.config.thermalAwareProcessing.temperatureThresholds.reduceAgents) {
      // Reduce concurrent agent capacity
      const reducedCapacity = Math.max(1, Math.floor(this.config.resourceAwareScheduling.maxConcurrentAgents / 2));
      
      // Cancel excess active agents if needed
      const excessAgents = this.activeAgents.size - reducedCapacity;
      if (excessAgents > 0) {
        const agentsToCancel = Array.from(this.activeAgents.values())
          .filter(agent => agent.thermalSensitive)
          .toSorted((a, b) => a.priority - b.priority)
          .slice(0, excessAgents);

        for (const agent of agentsToCancel) {
          this.cancelAgentExecution(agent.id, 'Thermal throttling - reducing capacity');
        }
      }
    }

    this.emit('thermalThrottling', {
      temperature,
      action,
      isThermallySuspended: this.isThermallySuspended,
      activeAgents: this.activeAgents.size,
    });
  }

  /**
   * Handles thermal recovery
   */
  private handleThermalRecovery(temperature: number): void {
    if (this.isThermallySuspended && 
        temperature < this.config.thermalAwareProcessing.temperatureThresholds.reduceAgents) {
      
      // Wait for cooldown period before resuming
      setTimeout(() => {
        this.isThermallySuspended = false;
        this.logger.info('Thermal suspension lifted, resuming agent execution');
        
        this.emit('thermalRecovery', {
          temperature,
          resumedAt: new Date(),
        });
      }, this.config.thermalAwareProcessing.cooldownPeriodMs);
    }
  }

  /**
   * Gets current resource metrics
   */
  private getCurrentResourceMetrics(): { cpuPercent: number; memoryPercent: number; temperatureCelsius: number } {
    // This would integrate with actual resource monitoring
    // For now, return placeholder values
    return {
      cpuPercent: 0,
      memoryPercent: 0,
      temperatureCelsius: 0,
    };
  }

  /**
   * Updates metrics
   */
  private updateMetrics(): void {
    const currentMetrics = this.getCurrentResourceMetrics();
    this.metrics.currentResourceUsage = currentMetrics;
    this.metrics.lastMetricsUpdate = new Date();
  }

  /**
   * Generates a unique agent ID
   */
  private generateAgentId(): string {
    return `pi-agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}