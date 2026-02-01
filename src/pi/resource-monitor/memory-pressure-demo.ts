/**
 * Memory Pressure Response System Demo
 * 
 * This demo shows how the memory pressure response system works:
 * 1. Automatic garbage collection at 80% memory usage
 * 2. Graceful service reduction under memory pressure
 */

import { ResourceMonitor } from './resource-monitor.js';
import type { PiConfiguration } from '../types/pi-configuration.js';

// Example Pi configuration
const piConfig: PiConfiguration = {
  model: 'Pi 4B',
  architecture: 'arm64',
  memory: {
    total: 4096, // 4GB
    limit: 2048, // 2GB limit
  },
  thermal: {
    thresholds: [70, 75, 80],
  },
  storage: {
    type: 'sd',
    wearLeveling: true,
  },
  gpio: {
    available: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27],
    reserved: [0, 1],
  },
};

export function demonstrateMemoryPressureResponse(): void {
  console.log('🚀 Memory Pressure Response System Demo');
  console.log('=====================================\n');

  // Create ResourceMonitor instance
  const monitor = new ResourceMonitor(piConfig);

  // Set up event listeners to demonstrate the memory pressure response
  monitor.on('garbageCollectionTriggered', (event) => {
    console.log('🗑️  Garbage Collection Triggered:');
    console.log(`   Memory freed: ${Math.round(event.memoryFreed / 1024 / 1024)}MB`);
    console.log(`   Before GC: ${Math.round(event.beforeGC.heapUsed / 1024 / 1024)}MB heap used`);
    console.log(`   After GC: ${Math.round(event.afterGC.heapUsed / 1024 / 1024)}MB heap used`);
    console.log(`   Timestamp: ${event.timestamp.toISOString()}\n`);
  });

  monitor.on('serviceReductionRequested', (event) => {
    console.log('⚠️  Service Reduction Requested:');
    console.log(`   Reason: ${event.reason}`);
    console.log(`   Level: ${event.level}`);
    console.log(`   Memory usage: ${Math.round(event.memoryUsage * 100)}%`);
    console.log(`   Timestamp: ${event.timestamp.toISOString()}\n`);
  });

  monitor.on('serviceRestorationRequested', (event) => {
    console.log('✅ Service Restoration Requested:');
    console.log(`   Reason: ${event.reason}`);
    console.log(`   Memory usage: ${Math.round(event.memoryUsage * 100)}%`);
    console.log(`   Timestamp: ${event.timestamp.toISOString()}\n`);
  });

  monitor.on('memoryLimitExceeded', (event) => {
    console.log('🚨 Memory Limit Exceeded:');
    console.log(`   Used: ${Math.round(event.used / 1024 / 1024)}MB`);
    console.log(`   Limit: ${Math.round(event.limit / 1024 / 1024)}MB`);
    console.log(`   Overage: ${Math.round((event.used - event.limit) / 1024 / 1024)}MB\n`);
  });

  // Enable adaptive scaling to activate memory pressure response
  monitor.enableAdaptiveScaling();
  console.log('✅ Adaptive scaling enabled\n');

  // Demonstrate different memory pressure scenarios
  console.log('📊 Simulating Memory Pressure Scenarios:\n');

  // Scenario 1: GC threshold (80% usage)
  console.log('1️⃣  Simulating 80% memory usage (GC threshold)...');
  monitor.emit('memoryPressure', { 
    level: 'gc', 
    usage: 0.8, 
    metrics: {} as any 
  });

  setTimeout(() => {
    // Scenario 2: Critical memory pressure (90% usage)
    console.log('2️⃣  Simulating 90% memory usage (critical threshold)...');
    monitor.emit('memoryPressure', { 
      level: 'critical', 
      usage: 0.9, 
      metrics: {} as any 
    });
  }, 1000);

  setTimeout(() => {
    // Scenario 3: Memory limit exceeded
    console.log('3️⃣  Simulating memory limit exceeded...');
    const memoryLimitBytes = piConfig.memory.limit * 1024 * 1024;
    monitor.emit('memoryLimitExceeded', {
      used: memoryLimitBytes + 100 * 1024 * 1024, // 100MB over limit
      limit: memoryLimitBytes,
      metrics: {} as any,
    });
  }, 2000);

  setTimeout(() => {
    // Scenario 4: Memory pressure resolved
    console.log('4️⃣  Simulating memory pressure resolution...');
    monitor.emit('memoryPressure', { 
      level: 'normal', 
      usage: 0.6, 
      metrics: {} as any 
    });
  }, 3000);

  setTimeout(() => {
    console.log('🏁 Demo completed!\n');
    
    // Show current memory pressure level and usage statistics
    console.log('📈 Current System Status:');
    console.log(`   Memory pressure level: ${monitor.getMemoryPressureLevel()}`);
    console.log(`   Memory pressure active: ${monitor.isMemoryPressureActive()}`);
    
    const limitUsage = monitor.getMemoryLimitUsage();
    console.log(`   Total memory usage: ${Math.round(limitUsage.totalUsage * 100)}%`);
    console.log(`   Limit usage: ${Math.round(limitUsage.limitUsage * 100)}%`);
    console.log(`   Within limit: ${limitUsage.withinLimit}`);
    console.log(`   Available before limit: ${Math.round(limitUsage.availableBeforeLimit / 1024 / 1024)}MB`);
    
    monitor.stopMonitoring();
  }, 4000);
}

// Run the demo if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  demonstrateMemoryPressureResponse();
}