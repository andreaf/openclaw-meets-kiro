/**
 * Raspberry Pi Hardware Detection Utilities
 * 
 * Provides functions to detect Raspberry Pi model, architecture, and capabilities.
 */

import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import type { PiConfiguration } from '../types/pi-configuration.js';

/**
 * Detects the current Raspberry Pi model and hardware specifications
 */
export function detectPiHardware(): PiConfiguration {
  const model = detectPiModel();
  const architecture = detectArchitecture();
  const memory = detectMemoryConfiguration();
  
  return {
    model,
    architecture,
    memory,
    thermal: {
      thresholds: [70, 75, 80], // Default thermal thresholds
      fanPin: detectFanPin(),
    },
    storage: {
      type: detectStorageType(),
      wearLeveling: true,
    },
    gpio: {
      available: getAvailableGpioPins(model),
      reserved: getReservedGpioPins(),
    },
  };
}

/**
 * Detects the Raspberry Pi model from /proc/cpuinfo
 */
export function detectPiModel(): string {
  try {
    if (!existsSync('/proc/cpuinfo')) {
      return 'Unknown Pi Model';
    }
    
    const cpuInfo = readFileSync('/proc/cpuinfo', 'utf8');
    const modelLine = cpuInfo
      .split('\n')
      .find(line => line.startsWith('Model'));
    
    if (!modelLine) {
      return 'Unknown Pi Model';
    }
    
    const model = modelLine.split(':')[1]?.trim() || 'Unknown Pi Model';
    
    // Normalize common model names
    if (model.includes('Raspberry Pi 5')) { return 'Pi 5'; }
    if (model.includes('Raspberry Pi 4')) { return 'Pi 4B'; }
    if (model.includes('Raspberry Pi 3')) { return 'Pi 3B+'; }
    if (model.includes('Raspberry Pi Zero')) { return 'Pi Zero'; }
    
    return model;
  } catch (error) {
    console.warn('Failed to detect Pi model:', error);
    return 'Unknown Pi Model';
  }
}

/**
 * Detects the CPU architecture
 */
export function detectArchitecture(): string {
  try {
    const arch = execSync('uname -m', { encoding: 'utf8' }).trim();
    
    // Normalize architecture names
    if (arch === 'aarch64') { return 'arm64'; }
    if (arch === 'armv7l') { return 'armv7l'; }
    if (arch === 'armv6l') { return 'armv6l'; }
    
    return arch;
  } catch (error) {
    console.warn('Failed to detect architecture:', error);
    return 'unknown';
  }
}

/**
 * Detects memory configuration and sets appropriate limits
 */
export function detectMemoryConfiguration(): { total: number; limit: number } {
  try {
    if (!existsSync('/proc/meminfo')) {
      return { total: 1024, limit: 512 }; // Default fallback
    }
    
    const memInfo = readFileSync('/proc/meminfo', 'utf8');
    const memTotalLine = memInfo
      .split('\n')
      .find(line => line.startsWith('MemTotal:'));
    
    if (!memTotalLine) {
      return { total: 1024, limit: 512 };
    }
    
    // Extract memory in KB and convert to MB
    const memTotalKB = parseInt(memTotalLine.split(/\s+/)[1] || '0', 10);
    const totalMB = Math.floor(memTotalKB / 1024);
    
    // Set memory limits based on total RAM
    let limit: number;
    if (totalMB <= 1024) {
      limit = 512; // 512MB limit for 1GB Pi models
    } else if (totalMB <= 2048) {
      limit = 1024; // 1GB limit for 2GB Pi models
    } else {
      limit = 2048; // 2GB limit for 4GB+ Pi models
    }
    
    return { total: totalMB, limit };
  } catch (error) {
    console.warn('Failed to detect memory configuration:', error);
    return { total: 1024, limit: 512 };
  }
}

/**
 * Detects if a fan control pin is available
 */
export function detectFanPin(): number | undefined {
  // Common fan control pins on Raspberry Pi
  const commonFanPins = [18, 12, 13]; // PWM-capable pins
  
  // For now, return undefined - actual detection would require
  // hardware-specific logic or configuration
  return undefined;
}

/**
 * Detects the primary storage type
 */
export function detectStorageType(): 'sd' | 'usb' | 'ssd' {
  try {
    // Check if root filesystem is on SD card, USB, or SSD
    const mountInfo = execSync('findmnt -n -o SOURCE /', { encoding: 'utf8' }).trim();
    
    if (mountInfo.includes('mmcblk')) { return 'sd'; } // SD card
    if (mountInfo.includes('sda') || mountInfo.includes('sdb')) { return 'usb'; } // USB/SSD
    
    return 'sd'; // Default to SD card
  } catch (error) {
    console.warn('Failed to detect storage type:', error);
    return 'sd';
  }
}

/**
 * Gets available GPIO pins for the detected Pi model
 */
export function getAvailableGpioPins(model: string): number[] {
  // Standard GPIO pins available on most Pi models
  const standardPins = [
    2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27
  ];
  
  // Pi 5 has additional pins
  if (model === 'Pi 5') {
    return [...standardPins, 28, 29, 30, 31];
  }
  
  return standardPins;
}

/**
 * Gets GPIO pins reserved for system use
 */
export function getReservedGpioPins(): number[] {
  // Pins commonly reserved for system functions
  return [
    0, 1,   // ID EEPROM
    // Note: UART pins 14, 15 are not reserved by default to allow user access
  ];
}