/**
 * Thermal Controller Implementation
 * 
 * Provides thermal management and CPU throttling for Raspberry Pi.
 * Implements temperature monitoring from /sys/class/thermal/thermal_zone0/temp
 * with configurable thresholds and automatic throttling responses.
 * 
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5
 */

import { readFileSync, existsSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import type { ThermalPolicy } from '../types/thermal-policy.js';
import { createSubsystemLogger } from '../../logging/subsystem.js';
import { logWarn, logError } from '../../logger.js';

export interface ThermalEvent {
  temperature: number;
  threshold: number;
  action: 'reduce_25' | 'reduce_50' | 'pause_services' | 'recovery';
  timestamp: Date;
  severity: 'info' | 'warning' | 'critical' | 'emergency';
  message: string;
  metadata?: Record<string, unknown>;
}

export interface ThermalStatus {
  currentTemperature: number;
  activeThrottling: boolean;
  currentAction?: 'reduce_25' | 'reduce_50' | 'pause_services';
  lastUpdate: Date;
}

export interface ThermalNotification {
  id: string;
  type: 'throttling' | 'recovery' | 'emergency' | 'sensor_failure';
  severity: 'info' | 'warning' | 'critical' | 'emergency';
  title: string;
  message: string;
  timestamp: Date;
  temperature?: number;
  action?: string;
  metadata?: Record<string, unknown>;
}

export interface AdministratorNotificationConfig {
  enabled: boolean;
  channels: Array<'console' | 'file' | 'event'>;
  throttlingThreshold: number; // Minimum temperature to trigger notifications
  emergencyThreshold: number; // Temperature for emergency notifications
  cooldownPeriod: number; // Minimum time between notifications (seconds)
}

export class ThermalController extends EventEmitter {
  private policy: ThermalPolicy;
  private monitoringInterval?: NodeJS.Timeout;
  private currentStatus: ThermalStatus;
  private temperatureHistory: Array<{ temperature: number; timestamp: Date }> = [];
  private readonly maxHistorySize = 100; // Keep last 100 temperature readings
  
  // Logging and notification system (Requirement 4.5)
  private readonly logger = createSubsystemLogger('pi/thermal');
  private notificationConfig: AdministratorNotificationConfig;
  private lastNotificationTime = new Map<string, Date>();
  private thermalEventLog: ThermalEvent[] = [];
  private readonly maxEventLogSize = 1000; // Keep last 1000 thermal events

  constructor(policy: ThermalPolicy, notificationConfig?: Partial<AdministratorNotificationConfig>) {
    super();
    this.policy = policy;
    this.currentStatus = {
      currentTemperature: 0,
      activeThrottling: false,
      lastUpdate: new Date(),
    };
    
    // Initialize notification configuration with defaults
    this.notificationConfig = {
      enabled: true,
      channels: ['console', 'file', 'event'],
      throttlingThreshold: 70, // Start notifications at 70°C
      emergencyThreshold: 80, // Emergency notifications at 80°C
      cooldownPeriod: 300, // 5 minutes between similar notifications
      ...notificationConfig,
    };
    
    this.logger.info('Thermal controller initialized', {
      policy: {
        interval: policy.monitoring.interval,
        thresholds: policy.thresholds.length,
        fanControl: !!policy.fanControl,
      },
      notifications: this.notificationConfig,
    });
  }

  /**
   * Gets current CPU temperature from thermal zone
   * Implements temperature reading from /sys/class/thermal/thermal_zone0/temp (Requirement 4.4)
   */
  async getCurrentTemperature(): Promise<number> {
    let temperature: number;
    let sensorFailure = false;
    let failureReason = '';
    
    try {
      const thermalPath = this.policy.monitoring.source;
      
      if (!existsSync(thermalPath)) {
        this.logger.warn('Thermal sensor not found, using fallback', {
          path: thermalPath,
          fallbackTemperature: 45.0,
        });
        temperature = this.getFallbackTemperature();
        sensorFailure = true;
        failureReason = `Thermal sensor not found at ${thermalPath}`;
      } else {
        const tempStr = readFileSync(thermalPath, 'utf8').trim();
        const tempMilliC = parseInt(tempStr, 10);
        
        if (isNaN(tempMilliC)) {
          this.logger.warn('Invalid temperature reading, using fallback', {
            path: thermalPath,
            rawValue: tempStr,
            fallbackTemperature: 45.0,
          });
          temperature = this.getFallbackTemperature();
          sensorFailure = true;
          failureReason = `Invalid temperature reading: ${tempStr}`;
        } else {
          temperature = tempMilliC / 1000; // Convert from millicelsius to celsius
        }
      }
    } catch (error) {
      this.logger.error('Failed to read CPU temperature, using fallback', {
        error: String(error),
        fallbackTemperature: 45.0,
      });
      temperature = this.getFallbackTemperature();
      sensorFailure = true;
      failureReason = `Sensor read error: ${String(error)}`;
    }
    
    // Log sensor failure for administrator notification
    if (sensorFailure) {
      this.logThermalEvent({
        temperature: 45.0,
        threshold: 0,
        action: 'recovery',
        timestamp: new Date(),
        severity: 'warning',
        message: 'Thermal sensor failure detected, using fallback temperature',
        metadata: { 
          error: failureReason, 
          sensorPath: this.policy.monitoring.source,
          fallbackTemperature: 45.0,
        },
      });
    }
    
    // Always update status and history regardless of sensor success/failure
    this.currentStatus.currentTemperature = temperature;
    this.currentStatus.lastUpdate = new Date();
    this.addToTemperatureHistory(temperature);
    
    return temperature;
  }

  /**
   * Gets fallback temperature when sensor is unavailable
   */
  private getFallbackTemperature(): number {
    // Return a safe default temperature
    return 45.0;
  }

  /**
   * Adds temperature reading to history for trend analysis
   */
  private addToTemperatureHistory(temperature: number): void {
    this.temperatureHistory.push({
      temperature,
      timestamp: new Date(),
    });
    
    // Keep only the most recent readings
    if (this.temperatureHistory.length > this.maxHistorySize) {
      this.temperatureHistory.shift();
    }
  }

  /**
   * Gets temperature history for analysis
   */
  getTemperatureHistory(): Array<{ temperature: number; timestamp: Date }> {
    return [...this.temperatureHistory];
  }

  /**
   * Starts thermal monitoring with 5-second interval
   * Implements 5-second monitoring interval (Requirement 4.4)
   */
  startMonitoring(): void {
    if (this.monitoringInterval) {
      this.stopMonitoring();
    }

    const intervalMs = this.policy.monitoring.interval * 1000;
    
    this.monitoringInterval = setInterval(async () => {
      try {
        const temperature = await this.getCurrentTemperature();
        this.checkThermalThresholds(temperature);
      } catch (error) {
        this.logger.error('Error during thermal monitoring', {
          error: String(error),
          interval: this.policy.monitoring.interval,
        });
        this.emit('monitoringError', error);
      }
    }, intervalMs);

    this.emit('monitoringStarted', { 
      interval: this.policy.monitoring.interval,
      source: this.policy.monitoring.source,
    });
    
    this.logger.info('Thermal monitoring started', {
      interval: this.policy.monitoring.interval,
      source: this.policy.monitoring.source,
      thresholds: this.policy.thresholds.map(t => ({
        temperature: t.temperature,
        action: t.action,
        recovery: t.recovery,
      })),
    });
  }

  /**
   * Stops thermal monitoring
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
      this.emit('monitoringStopped');
      this.logger.info('Thermal monitoring stopped');
    }
  }

  /**
   * Logs thermal events with structured logging (Requirement 4.5)
   */
  private logThermalEvent(event: ThermalEvent): void {
    // Add to event log
    this.thermalEventLog.push(event);
    
    // Maintain log size limit
    if (this.thermalEventLog.length > this.maxEventLogSize) {
      this.thermalEventLog.shift();
    }
    
    // Log to structured logger based on severity
    const logData = {
      temperature: event.temperature,
      threshold: event.threshold,
      action: event.action,
      severity: event.severity,
      timestamp: event.timestamp.toISOString(),
      ...event.metadata,
    };
    
    switch (event.severity) {
      case 'emergency':
        this.logger.fatal(event.message, logData);
        break;
      case 'critical':
        this.logger.error(event.message, logData);
        break;
      case 'warning':
        this.logger.warn(event.message, logData);
        break;
      case 'info':
      default:
        this.logger.info(event.message, logData);
        break;
    }
    
    // Send administrator notification if enabled
    if (this.notificationConfig.enabled) {
      this.sendAdministratorNotification(event);
    }
  }
  
  /**
   * Sends administrator notifications for thermal events (Requirement 4.5)
   */
  private sendAdministratorNotification(event: ThermalEvent): void {
    // Check if notification should be sent based on thresholds
    const shouldNotify = this.shouldSendNotification(event);
    if (!shouldNotify) {
      return;
    }
    
    // Generate notification
    const notification: ThermalNotification = {
      id: `thermal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: this.getNotificationType(event),
      severity: event.severity,
      title: this.getNotificationTitle(event),
      message: this.getNotificationMessage(event),
      timestamp: event.timestamp,
      temperature: event.temperature,
      action: event.action,
      metadata: event.metadata,
    };
    
    // Send through configured channels
    for (const channel of this.notificationConfig.channels) {
      this.sendNotificationToChannel(notification, channel);
    }
    
    // Update last notification time for cooldown
    const cooldownKey = `${event.action}-${event.threshold}`;
    this.lastNotificationTime.set(cooldownKey, event.timestamp);
    
    // Emit notification event for external systems
    this.emit('thermalNotification', notification);
  }
  
  /**
   * Determines if a notification should be sent based on configuration and cooldown
   */
  private shouldSendNotification(event: ThermalEvent): boolean {
    // Check temperature thresholds
    if (event.temperature < this.notificationConfig.throttlingThreshold && 
        event.action !== 'recovery' && 
        event.severity !== 'warning') {
      return false;
    }
    
    // Check cooldown period - use a key that includes both action and temperature threshold
    // This allows different thresholds to have separate cooldowns
    const cooldownKey = `${event.action}-${event.threshold}`;
    const lastNotification = this.lastNotificationTime.get(cooldownKey);
    if (lastNotification) {
      const timeSinceLastMs = event.timestamp.getTime() - lastNotification.getTime();
      const cooldownMs = this.notificationConfig.cooldownPeriod * 1000;
      if (timeSinceLastMs < cooldownMs) {
        return false;
      }
    }
    
    return true;
  }
  
  /**
   * Gets notification type based on thermal event
   */
  private getNotificationType(event: ThermalEvent): ThermalNotification['type'] {
    if (event.action === 'recovery') {
      return 'recovery';
    }
    if (event.temperature >= this.notificationConfig.emergencyThreshold) {
      return 'emergency';
    }
    if (event.metadata?.error) {
      return 'sensor_failure';
    }
    return 'throttling';
  }
  
  /**
   * Generates notification title based on event
   */
  private getNotificationTitle(event: ThermalEvent): string {
    switch (event.action) {
      case 'reduce_25':
        return 'Thermal Throttling: 25% Reduction';
      case 'reduce_50':
        return 'Thermal Throttling: 50% Reduction';
      case 'pause_services':
        return 'Thermal Emergency: Services Paused';
      case 'recovery':
        return 'Thermal Recovery: Normal Operation Resumed';
      default:
        return 'Thermal Event';
    }
  }
  
  /**
   * Generates detailed notification message
   */
  private getNotificationMessage(event: ThermalEvent): string {
    const baseMessage = `CPU temperature: ${event.temperature.toFixed(1)}°C`;
    
    switch (event.action) {
      case 'reduce_25':
        return `${baseMessage}. CPU-intensive operations reduced by 25% to prevent overheating.`;
      case 'reduce_50':
        return `${baseMessage}. CPU-intensive operations reduced by 50% to prevent overheating.`;
      case 'pause_services':
        return `${baseMessage}. Non-essential services paused due to critical temperature.`;
      case 'recovery':
        return `${baseMessage}. Temperature returned to safe levels, normal operation resumed.`;
      default:
        return `${baseMessage}. ${event.message}`;
    }
  }
  
  /**
   * Sends notification to specific channel
   */
  private sendNotificationToChannel(notification: ThermalNotification, channel: string): void {
    try {
      switch (channel) {
        case 'console':
          this.sendConsoleNotification(notification);
          break;
        case 'file':
          this.sendFileNotification(notification);
          break;
        case 'event':
          // Event emission is handled in sendAdministratorNotification
          break;
        default:
          this.logger.warn('Unknown notification channel', { channel });
      }
    } catch (error) {
      this.logger.error('Failed to send notification', {
        channel,
        notificationId: notification.id,
        error: String(error),
      });
    }
  }
  
  /**
   * Sends console notification using global logger
   */
  private sendConsoleNotification(notification: ThermalNotification): void {
    const message = `pi/thermal: ${notification.title} - ${notification.message}`;
    
    switch (notification.severity) {
      case 'emergency':
      case 'critical':
        logError(message);
        break;
      case 'warning':
        logWarn(message);
        break;
      case 'info':
      default:
        this.logger.info(notification.message, {
          consoleMessage: message,
          notificationId: notification.id,
          type: notification.type,
        });
        break;
    }
  }
  
  /**
   * Sends file notification (structured logging)
   */
  private sendFileNotification(notification: ThermalNotification): void {
    this.logger.info('Administrator notification sent', {
      notification: {
        id: notification.id,
        type: notification.type,
        severity: notification.severity,
        title: notification.title,
        message: notification.message,
        temperature: notification.temperature,
        action: notification.action,
        timestamp: notification.timestamp.toISOString(),
      },
      metadata: notification.metadata,
    });
  }

  /**
   * Checks temperature against thresholds and triggers appropriate actions
   * Implements thermal throttling logic (Requirements 4.1, 4.2, 4.3)
   */
  private checkThermalThresholds(temperature: number): void {
    // First check if we can recover from current throttling
    if (this.currentStatus.activeThrottling) {
      const canRecover = this.checkThermalRecovery(temperature);
      if (canRecover) {
        return; // Recovery handled, no need to check new thresholds
      }
    }
    
    // Sort thresholds by temperature (ascending) to check from lowest to highest
    const sortedThresholds = [...this.policy.thresholds].sort((a, b) => a.temperature - b.temperature);
    
    let newAction: 'reduce_25' | 'reduce_50' | 'pause_services' | undefined;
    let triggeredThreshold: typeof sortedThresholds[0] | undefined;
    
    // Find the highest threshold that is exceeded
    for (const threshold of sortedThresholds) {
      if (temperature >= threshold.temperature) {
        newAction = threshold.action;
        triggeredThreshold = threshold;
      }
    }
    
    // Check if we need to trigger a new action
    if (newAction && newAction !== this.currentStatus.currentAction) {
      this.triggerThermalAction(temperature, newAction, triggeredThreshold!);
    }
  }

  /**
   * Triggers thermal throttling action
   * Implements thermal throttling responses (Requirements 4.1, 4.2, 4.3, 4.5)
   */
  private triggerThermalAction(
    temperature: number, 
    action: 'reduce_25' | 'reduce_50' | 'pause_services',
    threshold: ThermalPolicy['thresholds'][0]
  ): void {
    // Determine severity based on action
    let severity: ThermalEvent['severity'];
    let message: string;
    
    switch (action) {
      case 'reduce_25':
        severity = 'warning';
        message = `CPU temperature ${temperature}°C exceeded 25% throttling threshold (${threshold.temperature}°C)`;
        break;
      case 'reduce_50':
        severity = 'critical';
        message = `CPU temperature ${temperature}°C exceeded 50% throttling threshold (${threshold.temperature}°C)`;
        break;
      case 'pause_services':
        severity = 'emergency';
        message = `CPU temperature ${temperature}°C exceeded emergency threshold (${threshold.temperature}°C), pausing services`;
        break;
    }
    
    const thermalEvent: ThermalEvent = {
      temperature,
      threshold: threshold.temperature,
      action,
      timestamp: new Date(),
      severity,
      message,
      metadata: {
        recoveryThreshold: threshold.recovery,
        previousAction: this.currentStatus.currentAction,
        activeThrottling: this.currentStatus.activeThrottling,
      },
    };

    this.currentStatus.activeThrottling = true;
    this.currentStatus.currentAction = action;

    // Log thermal event with structured logging (Requirement 4.5)
    this.logThermalEvent(thermalEvent);
    
    // Emit specific events based on action
    switch (action) {
      case 'reduce_25':
        // Reduce CPU-intensive operations by 25% at 70°C (Requirement 4.1)
        this.emit('thermalThrottling', { ...thermalEvent, reductionLevel: 0.25 });
        break;
        
      case 'reduce_50':
        // Reduce CPU-intensive operations by 50% at 75°C (Requirement 4.2)
        this.emit('thermalThrottling', { ...thermalEvent, reductionLevel: 0.50 });
        break;
        
      case 'pause_services':
        // Pause non-essential services at 80°C (Requirement 4.3)
        this.emit('thermalEmergency', { ...thermalEvent, emergencyLevel: 'pause_services' });
        break;
    }

    // Emit general thermal event for logging and notification
    this.emit('thermalEvent', thermalEvent);
  }

  /**
   * Checks if thermal recovery is possible
   */
  private checkThermalRecovery(temperature: number): boolean {
    if (!this.currentStatus.currentAction) return false;

    // Find the threshold for the current action
    const currentThreshold = this.policy.thresholds.find(
      (t: ThermalPolicy['thresholds'][0]) => t.action === this.currentStatus.currentAction
    );

    if (currentThreshold && temperature <= currentThreshold.recovery) {
      const thermalEvent: ThermalEvent = {
        temperature,
        threshold: currentThreshold.recovery,
        action: 'recovery',
        timestamp: new Date(),
        severity: 'info',
        message: `CPU temperature ${temperature}°C dropped below recovery threshold (${currentThreshold.recovery}°C), resuming normal operation`,
        metadata: {
          previousAction: this.currentStatus.currentAction,
          previousThreshold: currentThreshold.temperature,
          recoveryTime: new Date().toISOString(),
        },
      };

      this.currentStatus.activeThrottling = false;
      this.currentStatus.currentAction = undefined;

      // Log thermal recovery with structured logging (Requirement 4.5)
      this.logThermalEvent(thermalEvent);
      
      this.emit('thermalRecovery', thermalEvent);
      this.emit('thermalEvent', thermalEvent);
      
      return true;
    }
    
    return false;
  }

  /**
   * Sets a new thermal policy
   */
  setThermalPolicy(policy: ThermalPolicy): void {
    const wasMonitoring = !!this.monitoringInterval;
    
    if (wasMonitoring) {
      this.stopMonitoring();
    }
    
    this.policy = policy;
    
    if (wasMonitoring) {
      this.startMonitoring();
    }
    
    this.emit('policyUpdated', policy);
  }

  /**
   * Gets current thermal policy
   */
  getThermalPolicy(): ThermalPolicy {
    return { ...this.policy };
  }

  /**
   * Gets current thermal status
   */
  getThermalStatus(): ThermalStatus {
    return { ...this.currentStatus };
  }

  /**
   * Enables fan control if configured
   */
  enableFanControl(): void {
    if (!this.policy.fanControl) {
      this.logger.warn('Fan control not configured in thermal policy');
      return;
    }

    // This would integrate with GPIO interface for actual fan control
    // For now, emit an event that can be handled by GPIO interface
    this.emit('fanControlRequested', {
      pin: this.policy.fanControl.pin,
      pwmFrequency: this.policy.fanControl.pwmFrequency,
    });
    
    this.logger.info('Fan control enabled', {
      pin: this.policy.fanControl.pin,
      pwmFrequency: this.policy.fanControl.pwmFrequency,
    });
  }

  /**
   * Gets thermal event log for analysis (Requirement 4.5)
   */
  getThermalEventLog(): ThermalEvent[] {
    return [...this.thermalEventLog];
  }

  /**
   * Gets thermal events filtered by criteria
   */
  getThermalEvents(filter?: {
    since?: Date;
    action?: ThermalEvent['action'];
    severity?: ThermalEvent['severity'];
    limit?: number;
  }): ThermalEvent[] {
    let events = [...this.thermalEventLog];
    
    if (filter?.since) {
      events = events.filter(e => e.timestamp >= filter.since!);
    }
    
    if (filter?.action) {
      events = events.filter(e => e.action === filter.action);
    }
    
    if (filter?.severity) {
      events = events.filter(e => e.severity === filter.severity);
    }
    
    if (filter?.limit) {
      events = events.slice(-filter.limit);
    }
    
    return events;
  }

  /**
   * Gets notification configuration
   */
  getNotificationConfig(): AdministratorNotificationConfig {
    return { ...this.notificationConfig };
  }

  /**
   * Updates notification configuration
   */
  setNotificationConfig(config: Partial<AdministratorNotificationConfig>): void {
    this.notificationConfig = { ...this.notificationConfig, ...config };
    this.logger.info('Notification configuration updated', {
      config: this.notificationConfig,
    });
  }

  /**
   * Clears thermal event log
   */
  clearThermalEventLog(): void {
    const eventCount = this.thermalEventLog.length;
    this.thermalEventLog = [];
    this.logger.info('Thermal event log cleared', { clearedEvents: eventCount });
  }

  /**
   * Gets thermal statistics for analysis
   */
  getThermalStatistics(): {
    averageTemperature: number;
    maxTemperature: number;
    minTemperature: number;
    throttlingEvents: number;
    lastThrottlingTime?: Date;
  } {
    if (this.temperatureHistory.length === 0) {
      return {
        averageTemperature: 0,
        maxTemperature: 0,
        minTemperature: 0,
        throttlingEvents: 0,
      };
    }

    const temperatures = this.temperatureHistory.map(h => h.temperature);
    const averageTemperature = temperatures.reduce((sum, temp) => sum + temp, 0) / temperatures.length;
    const maxTemperature = Math.max(...temperatures);
    const minTemperature = Math.min(...temperatures);

    return {
      averageTemperature: Math.round(averageTemperature * 10) / 10,
      maxTemperature,
      minTemperature,
      throttlingEvents: 0, // This would be tracked separately in a real implementation
    };
  }

  /**
   * Forces a thermal check (useful for testing)
   */
  async forceThermalCheck(): Promise<void> {
    const temperature = await this.getCurrentTemperature();
    this.checkThermalThresholds(temperature);
  }

  /**
   * Checks if thermal monitoring is currently active
   */
  isMonitoring(): boolean {
    return !!this.monitoringInterval;
  }

  /**
   * Gets the monitoring interval in seconds
   */
  getMonitoringInterval(): number {
    return this.policy.monitoring.interval;
  }
}