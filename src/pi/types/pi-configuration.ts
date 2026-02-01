/**
 * PiConfiguration Interface
 * 
 * Defines the configuration structure for different Raspberry Pi models
 * and their hardware-specific settings.
 */

export interface PiConfiguration {
  /** Raspberry Pi model identifier */
  model: string; // e.g., 'Pi 4B', 'Pi 5', 'Pi 3B+'
  
  /** CPU architecture */
  architecture: string; // 'arm64', 'armv7l'
  
  /** Memory configuration */
  memory: {
    /** Total RAM available in MB */
    total: number;
    /** OpenClaw memory usage limit in MB */
    limit: number;
  };
  
  /** Thermal management configuration */
  thermal: {
    /** Temperature thresholds in Celsius for throttling actions */
    thresholds: number[];
    /** Optional GPIO pin for fan control */
    fanPin?: number;
  };
  
  /** Storage configuration */
  storage: {
    /** Storage type: SD card, USB, SSD, or unknown */
    type: 'sd' | 'usb' | 'ssd' | 'unknown';
    /** Whether wear leveling is enabled */
    wearLeveling: boolean;
  };
  
  /** GPIO configuration */
  gpio: {
    /** Array of available GPIO pin numbers */
    available: number[];
    /** Array of GPIO pins reserved for system use */
    reserved: number[];
  };
}