/**
 * ThermalPolicy Interface
 * 
 * Defines thermal management policies and thresholds for Raspberry Pi
 * temperature control and throttling behavior.
 */

export interface ThermalPolicy {
  /** Temperature monitoring configuration */
  monitoring: {
    /** Monitoring interval in seconds */
    interval: number;
    /** Path to temperature sensor source */
    source: string;
  };
  
  /** Thermal threshold configurations */
  thresholds: {
    /** Threshold temperature in Celsius */
    temperature: number;
    /** Action to take when threshold is exceeded */
    action: 'reduce_25' | 'reduce_50' | 'pause_services';
    /** Recovery temperature in Celsius (when to restore normal operation) */
    recovery: number;
  }[];
  
  /** Optional fan control configuration */
  fanControl?: {
    /** GPIO pin number for fan control */
    pin: number;
    /** PWM frequency for variable speed control */
    pwmFrequency: number;
  };
}