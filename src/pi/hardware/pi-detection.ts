/**
 * Pi Hardware Detection
 * 
 * Detects Raspberry Pi hardware model, architecture, and capabilities.
 * Provides automatic configuration optimization based on detected hardware.
 * 
 * Requirements: 10.2 - Hardware detection and automatic configuration optimization
 */

import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createSubsystemLogger } from '../../logging/subsystem.js';
import type { PiConfiguration } from '../types/pi-configuration.js';

const log = createSubsystemLogger('pi/hardware-detection');

export interface PiHardwareInfo {
  /** Pi model (e.g., 'Pi 4B', 'Pi 5', 'Pi 3B+') */
  model: string;
  /** CPU architecture (e.g., 'arm64', 'armv7l') */
  architecture: string;
  /** Total RAM in MB */
  totalMemoryMB: number;
  /** CPU cores count */
  cpuCores: number;
  /** CPU base frequency in MHz */
  cpuFrequency: number;
  /** Storage type detected */
  storageType: 'sd' | 'usb' | 'ssd' | 'unknown';
  /** Available GPIO pins */
  gpioPins: number[];
  /** Hardware revision code */
  revision?: string;
  /** Serial number */
  serial?: string;
  /** Whether this is actually a Raspberry Pi */
  isRaspberryPi: boolean;
}

/**
 * Detects Raspberry Pi hardware and returns configuration
 */
export async function detectPiHardware(): Promise<PiHardwareInfo> {
  log.info('Detecting Raspberry Pi hardware...');

  try {
    const hardwareInfo = await gatherHardwareInfo();
    
    log.info('Pi hardware detection completed', {
      model: hardwareInfo.model,
      architecture: hardwareInfo.architecture,
      memory: `${hardwareInfo.totalMemoryMB}MB`,
      isRaspberryPi: hardwareInfo.isRaspberryPi,
    });

    return hardwareInfo;
  } catch (error) {
    log.error('Failed to detect Pi hardware:', { error: error instanceof Error ? error.message : String(error) });
    
    // Return fallback configuration for non-Pi systems
    return getFallbackHardwareInfo();
  }
}

/**
 * Creates optimized Pi configuration based on detected hardware
 */
export function createOptimizedPiConfiguration(hardwareInfo: PiHardwareInfo): PiConfiguration {
  log.info('Creating optimized Pi configuration', {
    model: hardwareInfo.model,
    memory: hardwareInfo.totalMemoryMB,
  });

  // Calculate memory limit based on total RAM
  let memoryLimit: number;
  if (hardwareInfo.totalMemoryMB <= 1024) {
    memoryLimit = 512; // 512MB limit for 1GB Pi models
  } else if (hardwareInfo.totalMemoryMB <= 2048) {
    memoryLimit = 1024; // 1GB limit for 2GB Pi models
  } else {
    memoryLimit = 2048; // 2GB limit for 4GB+ Pi models
  }

  // Determine thermal thresholds based on Pi model
  const thermalThresholds = getThermalThresholds(hardwareInfo.model);

  // Configure GPIO pins (exclude reserved pins)
  const reservedPins = [0, 1]; // I2C pins typically reserved
  const availableGpioPins = hardwareInfo.gpioPins.filter(pin => !reservedPins.includes(pin));

  const config: PiConfiguration = {
    model: hardwareInfo.model,
    architecture: hardwareInfo.architecture,
    memory: {
      total: hardwareInfo.totalMemoryMB,
      limit: memoryLimit,
    },
    thermal: {
      thresholds: thermalThresholds,
    },
    storage: {
      type: hardwareInfo.storageType,
      wearLeveling: hardwareInfo.storageType === 'sd', // Enable wear leveling for SD cards
    },
    gpio: {
      available: availableGpioPins,
      reserved: reservedPins,
    },
  };

  log.info('Pi configuration created', {
    memoryLimit: `${memoryLimit}MB`,
    thermalThresholds,
    wearLeveling: config.storage.wearLeveling,
    gpioPins: availableGpioPins.length,
  });

  return config;
}

/**
 * Checks if the current system is a Raspberry Pi
 */
export function isRaspberryPi(): boolean {
  try {
    // Check for Pi-specific files
    if (existsSync('/proc/device-tree/model')) {
      const model = readFileSync('/proc/device-tree/model', 'utf8').toLowerCase();
      return model.includes('raspberry pi');
    }

    // Check /proc/cpuinfo for Pi-specific information
    if (existsSync('/proc/cpuinfo')) {
      const cpuinfo = readFileSync('/proc/cpuinfo', 'utf8').toLowerCase();
      return cpuinfo.includes('raspberry pi') || cpuinfo.includes('bcm2');
    }

    return false;
  } catch (error) {
    log.warn('Failed to check if system is Raspberry Pi:', { error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

/**
 * Gathers comprehensive hardware information
 */
async function gatherHardwareInfo(): Promise<PiHardwareInfo> {
  const isRpi = isRaspberryPi();
  
  // Get basic system information
  const architecture = getArchitecture();
  const totalMemoryMB = getTotalMemoryMB();
  const cpuCores = getCpuCores();
  const cpuFrequency = getCpuFrequency();
  
  // Get Pi-specific information
  const model = isRpi ? getPiModel() : getGenericModel();
  const storageType = getStorageType();
  const gpioPins = isRpi ? getPiGpioPins(model) : [];
  const revision = isRpi ? getPiRevision() : undefined;
  const serial = isRpi ? getPiSerial() : undefined;

  return {
    model,
    architecture,
    totalMemoryMB,
    cpuCores,
    cpuFrequency,
    storageType,
    gpioPins,
    revision,
    serial,
    isRaspberryPi: isRpi,
  };
}

/**
 * Gets CPU architecture
 */
function getArchitecture(): string {
  try {
    const arch = execSync('uname -m', { encoding: 'utf8' }).trim();
    
    // Normalize architecture names
    switch (arch) {
      case 'aarch64':
        return 'arm64';
      case 'armv7l':
        return 'armv7l';
      case 'x86_64':
        return 'x64';
      default:
        return arch;
    }
  } catch (error) {
    log.warn('Failed to get architecture:', { error: error instanceof Error ? error.message : String(error) });
    return 'unknown';
  }
}

/**
 * Gets total system memory in MB
 */
function getTotalMemoryMB(): number {
  try {
    if (existsSync('/proc/meminfo')) {
      const meminfo = readFileSync('/proc/meminfo', 'utf8');
      const memTotalMatch = meminfo.match(/MemTotal:\s+(\d+)\s+kB/);
      
      if (memTotalMatch) {
        const memTotalKB = parseInt(memTotalMatch[1], 10);
        return Math.round(memTotalKB / 1024); // Convert KB to MB
      }
    }

    // Fallback: try using free command
    const freeOutput = execSync('free -m', { encoding: 'utf8' });
    const memMatch = freeOutput.match(/Mem:\s+(\d+)/);
    
    if (memMatch) {
      return parseInt(memMatch[1], 10);
    }

    return 1024; // Default fallback
  } catch (error) {
    log.warn('Failed to get total memory:', { error: error instanceof Error ? error.message : String(error) });
    return 1024; // Default fallback
  }
}

/**
 * Gets CPU core count
 */
function getCpuCores(): number {
  try {
    const nproc = execSync('nproc', { encoding: 'utf8' }).trim();
    return parseInt(nproc, 10) || 4;
  } catch (error) {
    log.warn('Failed to get CPU cores:', { error: error instanceof Error ? error.message : String(error) });
    return 4; // Default fallback
  }
}

/**
 * Gets CPU base frequency in MHz
 */
function getCpuFrequency(): number {
  try {
    if (existsSync('/sys/devices/system/cpu/cpu0/cpufreq/base_frequency')) {
      const freqKHz = readFileSync('/sys/devices/system/cpu/cpu0/cpufreq/base_frequency', 'utf8').trim();
      return Math.round(parseInt(freqKHz, 10) / 1000); // Convert kHz to MHz
    }

    // Fallback: try cpuinfo
    if (existsSync('/proc/cpuinfo')) {
      const cpuinfo = readFileSync('/proc/cpuinfo', 'utf8');
      const freqMatch = cpuinfo.match(/cpu MHz\s*:\s*(\d+(?:\.\d+)?)/);
      
      if (freqMatch) {
        return Math.round(parseFloat(freqMatch[1]));
      }
    }

    return 1500; // Default Pi frequency
  } catch (error) {
    log.warn('Failed to get CPU frequency:', { error: error instanceof Error ? error.message : String(error) });
    return 1500; // Default fallback
  }
}

/**
 * Gets Pi model from device tree
 */
function getPiModel(): string {
  try {
    if (existsSync('/proc/device-tree/model')) {
      const model = readFileSync('/proc/device-tree/model', 'utf8').replace(/\0/g, '').trim();
      
      // Normalize model names
      if (model.includes('Raspberry Pi 5')) return 'Pi 5';
      if (model.includes('Raspberry Pi 4')) return 'Pi 4B';
      if (model.includes('Raspberry Pi 3 Model B+')) return 'Pi 3B+';
      if (model.includes('Raspberry Pi 3')) return 'Pi 3B';
      if (model.includes('Raspberry Pi 2')) return 'Pi 2B';
      if (model.includes('Raspberry Pi Zero 2')) return 'Pi Zero 2W';
      if (model.includes('Raspberry Pi Zero')) return 'Pi Zero';
      
      return model;
    }

    return 'Pi Unknown';
  } catch (error) {
    log.warn('Failed to get Pi model:', { error: error instanceof Error ? error.message : String(error) });
    return 'Pi Unknown';
  }
}

/**
 * Gets generic system model for non-Pi systems
 */
function getGenericModel(): string {
  try {
    // Try to get system information
    const hostname = execSync('hostname', { encoding: 'utf8' }).trim();
    return `Generic ARM (${hostname})`;
  } catch (error) {
    return 'Generic ARM';
  }
}

/**
 * Gets storage type based on root filesystem
 */
function getStorageType(): 'sd' | 'usb' | 'ssd' | 'unknown' {
  try {
    const dfOutput = execSync('df /', { encoding: 'utf8' });
    const deviceMatch = dfOutput.match(/^(\S+)/m);
    
    if (deviceMatch) {
      const device = deviceMatch[1];
      
      if (device.includes('mmcblk')) return 'sd'; // SD card
      if (device.includes('sda') || device.includes('sdb')) return 'usb'; // USB/SSD
      if (device.includes('nvme')) return 'ssd'; // NVMe SSD
    }

    return 'unknown';
  } catch (error) {
    log.warn('Failed to detect storage type:', { error: error instanceof Error ? error.message : String(error) });
    return 'unknown';
  }
}

/**
 * Gets available GPIO pins for Pi model
 */
function getPiGpioPins(model: string): number[] {
  // Standard 40-pin GPIO layout for modern Pi models
  const standardGpioPins = [
    2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27
  ];

  // Model-specific GPIO configurations
  switch (model) {
    case 'Pi 5':
    case 'Pi 4B':
    case 'Pi 3B+':
    case 'Pi 3B':
    case 'Pi 2B':
      return standardGpioPins;
    
    case 'Pi Zero':
    case 'Pi Zero 2W':
      return standardGpioPins; // Same GPIO layout
    
    default:
      return standardGpioPins; // Default to standard layout
  }
}

/**
 * Gets Pi hardware revision
 */
function getPiRevision(): string | undefined {
  try {
    if (existsSync('/proc/cpuinfo')) {
      const cpuinfo = readFileSync('/proc/cpuinfo', 'utf8');
      const revisionMatch = cpuinfo.match(/Revision\s*:\s*([a-fA-F0-9]+)/);
      
      if (revisionMatch) {
        return revisionMatch[1];
      }
    }

    return undefined;
  } catch (error) {
    log.warn('Failed to get Pi revision:', { error: error instanceof Error ? error.message : String(error) });
    return undefined;
  }
}

/**
 * Gets Pi serial number
 */
function getPiSerial(): string | undefined {
  try {
    if (existsSync('/proc/cpuinfo')) {
      const cpuinfo = readFileSync('/proc/cpuinfo', 'utf8');
      const serialMatch = cpuinfo.match(/Serial\s*:\s*([a-fA-F0-9]+)/);
      
      if (serialMatch) {
        return serialMatch[1];
      }
    }

    return undefined;
  } catch (error) {
    log.warn('Failed to get Pi serial:', { error: error instanceof Error ? error.message : String(error) });
    return undefined;
  }
}

/**
 * Gets thermal thresholds based on Pi model
 */
function getThermalThresholds(model: string): number[] {
  switch (model) {
    case 'Pi 5':
      // Pi 5 can handle higher temperatures
      return [75, 80, 85];
    
    case 'Pi 4B':
      // Pi 4 runs hotter, more conservative thresholds
      return [70, 75, 80];
    
    case 'Pi 3B+':
    case 'Pi 3B':
      // Pi 3 models, standard thresholds
      return [70, 75, 80];
    
    case 'Pi Zero':
    case 'Pi Zero 2W':
      // Zero models, more conservative due to smaller form factor
      return [65, 70, 75];
    
    default:
      // Default conservative thresholds
      return [70, 75, 80];
  }
}

/**
 * Gets fallback hardware info for non-Pi systems
 */
function getFallbackHardwareInfo(): PiHardwareInfo {
  return {
    model: 'Generic ARM',
    architecture: getArchitecture(),
    totalMemoryMB: getTotalMemoryMB(),
    cpuCores: getCpuCores(),
    cpuFrequency: getCpuFrequency(),
    storageType: 'unknown',
    gpioPins: [],
    isRaspberryPi: false,
  };
}