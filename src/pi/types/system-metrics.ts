/**
 * SystemMetrics Interface
 * 
 * Defines the structure for comprehensive system resource monitoring
 * on Raspberry Pi hardware.
 */

export interface SystemMetrics {
  /** Timestamp when metrics were collected */
  timestamp: Date;
  
  /** CPU-related metrics */
  cpu: {
    /** CPU usage percentage (0-100) */
    usage: number;
    /** CPU temperature in Celsius */
    temperature: number;
    /** Current CPU frequency in MHz */
    frequency: number;
    /** Whether CPU is currently throttled due to thermal limits */
    throttled: boolean;
  };
  
  /** Memory-related metrics */
  memory: {
    /** Total system RAM in bytes */
    total: number;
    /** Currently used memory in bytes */
    used: number;
    /** Available memory in bytes */
    available: number;
    /** Swap memory currently in use in bytes */
    swapUsed: number;
  };
  
  /** Storage-related metrics */
  storage: {
    /** Total storage capacity in bytes */
    total: number;
    /** Currently used storage in bytes */
    used: number;
    /** Available storage space in bytes */
    available: number;
    /** Write operation count for wear leveling tracking */
    writeCount: number;
  };
  
  /** Network-related metrics */
  network: {
    /** Active network interface type */
    interface: 'wifi' | 'ethernet';
    /** Available bandwidth in Mbps */
    bandwidth: number;
    /** Network latency in milliseconds */
    latency: number;
    /** Number of lost packets */
    packetsLost: number;
  };
}