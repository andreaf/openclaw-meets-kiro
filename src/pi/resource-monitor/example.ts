/**
 * Example Usage of ResourceMonitor
 * 
 * Demonstrates how to use the ResourceMonitor class for comprehensive
 * system monitoring on Raspberry Pi hardware.
 */

import { ResourceMonitor } from './resource-monitor.js';
import { detectPiHardware } from '../hardware/detection.js';

async function main() {
  console.log('🔍 Detecting Raspberry Pi hardware...');
  
  // Detect the current Pi hardware configuration
  const piConfig = detectPiHardware();
  console.log(`📋 Detected: ${piConfig.model} (${piConfig.architecture})`);
  console.log(`💾 Memory: ${piConfig.memory.total}MB total, ${piConfig.memory.limit}MB limit`);
  console.log(`🌡️  Thermal thresholds: ${piConfig.thermal.thresholds.join('°C, ')}°C`);
  console.log(`💽 Storage: ${piConfig.storage.type} with wear leveling ${piConfig.storage.wearLeveling ? 'enabled' : 'disabled'}`);
  console.log(`🔌 GPIO: ${piConfig.gpio.available.length} pins available`);
  
  // Create ResourceMonitor with detected configuration
  const resourceMonitor = new ResourceMonitor(piConfig, {
    memoryGCThreshold: 0.8,      // Trigger GC at 80% memory usage
    memoryPressureThreshold: 0.9, // Critical memory pressure at 90%
    cpuUsageThreshold: 0.85,     // CPU pressure alert at 85%
    storageCleanupThreshold: 0.8, // Storage cleanup at 80% full
    networkLatencyThreshold: 100, // Network issues above 100ms
  });
  
  console.log('\n📊 Setting up event listeners...');
  
  // Set up event listeners for resource monitoring
  resourceMonitor.on('memoryPressure', (event) => {
    console.log(`⚠️  Memory pressure detected: ${event.level} (${(event.usage * 100).toFixed(1)}%)`);
  });
  
  resourceMonitor.on('cpuPressure', (event) => {
    console.log(`🔥 CPU pressure detected: ${event.usage.toFixed(1)}%`);
  });
  
  resourceMonitor.on('storagePressure', (event) => {
    console.log(`💾 Storage pressure detected: ${(event.usage * 100).toFixed(1)}% full`);
  });
  
  resourceMonitor.on('networkPressure', (event) => {
    console.log(`🌐 Network issues detected: ${event.latency}ms latency`);
  });
  
  resourceMonitor.on('memoryLimitExceeded', (event) => {
    console.log(`🚨 Memory limit exceeded: ${(event.used / 1024 / 1024).toFixed(1)}MB used, limit: ${(event.limit / 1024 / 1024).toFixed(1)}MB`);
  });
  
  // Enable adaptive scaling
  resourceMonitor.enableAdaptiveScaling();
  
  resourceMonitor.on('serviceReductionRequested', (event) => {
    console.log(`📉 Service reduction requested: ${event.reason}`);
  });
  
  resourceMonitor.on('cpuReductionRequested', (event) => {
    console.log(`🔽 CPU reduction requested: ${event.reason}`);
  });
  
  resourceMonitor.on('storageCleanupRequested', (event) => {
    console.log(`🧹 Storage cleanup requested: ${event.reason}`);
  });
  
  console.log('\n🚀 Starting resource monitoring...');
  
  // Collect initial metrics
  console.log('\n📈 Collecting system metrics...');
  const metrics = await resourceMonitor.getSystemMetrics();
  
  console.log('\n=== SYSTEM METRICS ===');
  console.log(`⏰ Timestamp: ${metrics.timestamp.toISOString()}`);
  
  console.log('\n🖥️  CPU Metrics:');
  console.log(`   Usage: ${metrics.cpu.usage.toFixed(1)}%`);
  console.log(`   Temperature: ${metrics.cpu.temperature.toFixed(1)}°C`);
  console.log(`   Frequency: ${metrics.cpu.frequency}MHz`);
  console.log(`   Throttled: ${metrics.cpu.throttled ? 'Yes' : 'No'}`);
  
  console.log('\n💾 Memory Metrics:');
  console.log(`   Total: ${(metrics.memory.total / 1024 / 1024).toFixed(1)}MB`);
  console.log(`   Used: ${(metrics.memory.used / 1024 / 1024).toFixed(1)}MB (${((metrics.memory.used / metrics.memory.total) * 100).toFixed(1)}%)`);
  console.log(`   Available: ${(metrics.memory.available / 1024 / 1024).toFixed(1)}MB`);
  console.log(`   Swap Used: ${(metrics.memory.swapUsed / 1024 / 1024).toFixed(1)}MB`);
  
  console.log('\n💽 Storage Metrics:');
  console.log(`   Total: ${(metrics.storage.total / 1024 / 1024 / 1024).toFixed(1)}GB`);
  console.log(`   Used: ${(metrics.storage.used / 1024 / 1024 / 1024).toFixed(1)}GB (${((metrics.storage.used / metrics.storage.total) * 100).toFixed(1)}%)`);
  console.log(`   Available: ${(metrics.storage.available / 1024 / 1024 / 1024).toFixed(1)}GB`);
  console.log(`   Write Count: ${metrics.storage.writeCount}`);
  
  console.log('\n🌐 Network Metrics:');
  console.log(`   Interface: ${metrics.network.interface}`);
  console.log(`   Bandwidth: ${metrics.network.bandwidth}Mbps`);
  console.log(`   Latency: ${metrics.network.latency.toFixed(1)}ms`);
  console.log(`   Packets Lost: ${metrics.network.packetsLost}`);
  
  // Show performance profile
  const profile = resourceMonitor.getPerformanceProfile();
  console.log(`\n🎯 Performance Profile: ${profile.toUpperCase()}`);
  
  // Start continuous monitoring
  console.log('\n🔄 Starting continuous monitoring (5-second intervals)...');
  resourceMonitor.startMonitoring(5000);
  
  // Monitor for 30 seconds
  console.log('📊 Monitoring for 30 seconds...');
  await new Promise(resolve => setTimeout(resolve, 30000));
  
  // Stop monitoring
  console.log('\n⏹️  Stopping monitoring...');
  resourceMonitor.stopMonitoring();
  
  // Show final metrics
  const finalMetrics = resourceMonitor.getLastMetrics();
  if (finalMetrics) {
    console.log('\n📊 Final Metrics Summary:');
    console.log(`   CPU Usage: ${finalMetrics.cpu.usage.toFixed(1)}%`);
    console.log(`   Memory Usage: ${((finalMetrics.memory.used / finalMetrics.memory.total) * 100).toFixed(1)}%`);
    console.log(`   Storage Usage: ${((finalMetrics.storage.used / finalMetrics.storage.total) * 100).toFixed(1)}%`);
    console.log(`   Network Latency: ${finalMetrics.network.latency.toFixed(1)}ms`);
    console.log(`   Performance Profile: ${resourceMonitor.getPerformanceProfile().toUpperCase()}`);
  }
  
  console.log('\n✅ Resource monitoring example completed!');
}

// Run the example
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { main as runResourceMonitorExample };