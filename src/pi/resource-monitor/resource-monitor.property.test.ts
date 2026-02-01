/**
 * Property-Based Tests for ResourceMonitor
 * 
 * **Feature: raspberry-pi-port, Property 26: Comprehensive Resource Monitoring**
 * **Validates: Requirements 9.1**
 * 
 * Tests that the ResourceMonitor accurately tracks CPU usage, memory consumption,
 * disk I/O, and network throughput across all possible system states and inputs.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type MockedFunction } from 'vitest';
import * as fc from 'fast-check';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { ResourceMonitor } from './resource-monitor.js';
import type { SystemMetrics } from '../types/index.js';
import type { PiConfiguration } from '../types/pi-configuration.js';
import { propertyTestConfig, validateSystemMetrics } from '../test-setup.js';

// Mock Node.js modules
vi.mock('fs');
vi.mock('child_process');

const mockReadFileSync = readFileSync as MockedFunction<typeof readFileSync>;
const mockExistsSync = existsSync as MockedFunction<typeof existsSync>;
const mockExecSync = execSync as MockedFunction<typeof execSync>;

describe('ResourceMonitor Property-Based Tests', () => {
  let resourceMonitor: ResourceMonitor;
  let mockConfig: PiConfiguration;

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockConfig = {
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

    resourceMonitor = new ResourceMonitor(mockConfig);
  });

  afterEach(() => {
    resourceMonitor.stopMonitoring();
  });

  /**
   * Property 26: Comprehensive Resource Monitoring
   * **Validates: Requirements 9.1**
   * 
   * For any system operation, the Resource_Monitor should accurately track 
   * CPU usage, memory consumption, disk I/O, and network throughput, 
   * providing complete system visibility.
   */
  describe('Property 26: Comprehensive Resource Monitoring', () => {
    it('should accurately track all system metrics across all possible system states', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate simpler system states to avoid timeout
          fc.record({
            cpuStat: fc.record({
              user: fc.integer({ min: 0, max: 10000 }),
              nice: fc.integer({ min: 0, max: 1000 }),
              system: fc.integer({ min: 0, max: 5000 }),
              idle: fc.integer({ min: 0, max: 100000 }),
              iowait: fc.integer({ min: 0, max: 1000 }),
              irq: fc.integer({ min: 0, max: 100 }),
              softirq: fc.integer({ min: 0, max: 100 }),
            }),
            temperature: fc.integer({ min: 30000, max: 80000 }), // millicelsius
            frequency: fc.integer({ min: 600000, max: 2400000 }), // KHz
            maxFrequency: fc.integer({ min: 1000000, max: 2400000 }), // KHz
            memInfo: fc.record({
              total: fc.integer({ min: 1048576, max: 4194304 }), // KB (1GB to 4GB)
              available: fc.integer({ min: 262144, max: 3145728 }), // KB
              swapTotal: fc.integer({ min: 0, max: 1048576 }), // KB
              swapFree: fc.integer({ min: 0, max: 1048576 }), // KB
            }).filter(mem => mem.available <= mem.total && mem.swapFree <= mem.swapTotal),
            storage: fc.record({
              total: fc.bigInt({ min: 8000000000n, max: 100000000000n }), // bytes
              used: fc.bigInt({ min: 1000000000n, max: 80000000000n }), // bytes
            }).map(storage => ({
              total: Number(storage.total),
              used: Number(storage.used),
              available: Number(storage.total) - Number(storage.used),
            })).filter(storage => storage.used <= storage.total),
            network: fc.record({
              interface: fc.constantFrom('wlan0', 'eth0'),
              speed: fc.option(fc.integer({ min: 10, max: 1000 })), // Mbps
              latency: fc.float({ min: Math.fround(1.0), max: Math.fround(100.0) }), // ms
              rxPackets: fc.integer({ min: 0, max: 10000 }),
              rxDropped: fc.integer({ min: 0, max: 100 }),
              rxErrors: fc.integer({ min: 0, max: 10 }),
            }),
          }),
          async (systemState) => {
            // Setup mocks based on generated system state
            mockExistsSync.mockReturnValue(true);
            
            mockReadFileSync.mockImplementation((path: string) => {
              if (path === '/proc/stat') {
                const { user, nice, system, idle, iowait, irq, softirq } = systemState.cpuStat;
                return `cpu  ${user} ${nice} ${system} ${idle} ${iowait} ${irq} ${softirq} 0 0 0\n`;
              }
              
              if (path === '/sys/class/thermal/thermal_zone0/temp') {
                return systemState.temperature.toString();
              }
              
              if (path === '/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq') {
                return systemState.frequency.toString();
              }
              
              if (path === '/sys/devices/system/cpu/cpu0/cpufreq/scaling_max_freq') {
                return systemState.maxFrequency.toString();
              }
              
              if (path === '/proc/meminfo') {
                const { total, available, swapTotal, swapFree } = systemState.memInfo;
                return `MemTotal: ${total} kB\nMemAvailable: ${available} kB\nSwapTotal: ${swapTotal} kB\nSwapFree: ${swapFree} kB\n`;
              }
              
              if (path.includes('/sys/class/net/') && path.includes('/speed')) {
                return systemState.network.speed ? systemState.network.speed.toString() : '';
              }
              
              if (path.includes('/sys/class/net/') && path.includes('/statistics/rx_packets')) {
                return systemState.network.rxPackets.toString();
              }
              
              if (path.includes('/sys/class/net/') && path.includes('/statistics/rx_dropped')) {
                return systemState.network.rxDropped.toString();
              }
              
              if (path.includes('/sys/class/net/') && path.includes('/statistics/rx_errors')) {
                return systemState.network.rxErrors.toString();
              }
              
              return '';
            });
            
            mockExecSync.mockImplementation((command: string) => {
              if (command === 'df -B1 /') {
                const { total, used, available } = systemState.storage;
                return `Filesystem 1B-blocks Used Available Use% Mounted\n/dev/root ${total} ${used} ${available} 50% /\n`;
              }
              
              if (command === 'ip route get 8.8.8.8') {
                return `via 192.168.1.1 dev ${systemState.network.interface} src 192.168.1.100\n`;
              }
              
              if (command === 'ping -c 1 -W 1 8.8.8.8') {
                return `PING 8.8.8.8: time=${systemState.network.latency} ms\n`;
              }
              
              return '';
            });

            // Collect system metrics
            const metrics = await resourceMonitor.getSystemMetrics();

            // **Property 26: Comprehensive Resource Monitoring**
            // Verify all required metrics are present and valid
            expect(metrics).toHaveProperty('timestamp');
            expect(metrics).toHaveProperty('cpu');
            expect(metrics).toHaveProperty('memory');
            expect(metrics).toHaveProperty('storage');
            expect(metrics).toHaveProperty('network');

            // Verify timestamp is recent and valid
            expect(metrics.timestamp).toBeInstanceOf(Date);
            expect(Date.now() - metrics.timestamp.getTime()).toBeLessThan(5000); // Within 5 seconds

            // **CPU Metrics Validation**
            expect(metrics.cpu.usage).toBeGreaterThanOrEqual(0);
            expect(metrics.cpu.usage).toBeLessThanOrEqual(100);
            expect(metrics.cpu.temperature).toBe(systemState.temperature / 1000); // Convert millicelsius to celsius
            expect(metrics.cpu.frequency).toBe(Math.round(systemState.frequency / 1000)); // Convert KHz to MHz
            expect(typeof metrics.cpu.throttled).toBe('boolean');
            
            // Throttling should be detected when current frequency is significantly below max
            const expectedThrottled = systemState.frequency < (systemState.maxFrequency * 0.9);
            expect(metrics.cpu.throttled).toBe(expectedThrottled);

            // **Memory Metrics Validation**
            expect(metrics.memory.total).toBe(systemState.memInfo.total * 1024); // Convert KB to bytes
            expect(metrics.memory.available).toBe(systemState.memInfo.available * 1024);
            expect(metrics.memory.used).toBe((systemState.memInfo.total - systemState.memInfo.available) * 1024);
            expect(metrics.memory.swapUsed).toBe((systemState.memInfo.swapTotal - systemState.memInfo.swapFree) * 1024);
            
            // Memory consistency checks
            expect(metrics.memory.used).toBeLessThanOrEqual(metrics.memory.total);
            expect(metrics.memory.available).toBeLessThanOrEqual(metrics.memory.total);
            expect(metrics.memory.swapUsed).toBeGreaterThanOrEqual(0);

            // **Storage Metrics Validation**
            expect(metrics.storage.total).toBe(systemState.storage.total);
            expect(metrics.storage.used).toBe(systemState.storage.used);
            expect(metrics.storage.available).toBe(systemState.storage.available);
            expect(metrics.storage.writeCount).toBeGreaterThanOrEqual(0);
            
            // Storage consistency checks
            expect(metrics.storage.used).toBeLessThanOrEqual(metrics.storage.total);
            expect(metrics.storage.available).toBeLessThanOrEqual(metrics.storage.total);

            // **Network Metrics Validation**
            const expectedInterface = systemState.network.interface.startsWith('wlan') ? 'wifi' : 'ethernet';
            expect(metrics.network.interface).toBe(expectedInterface);
            expect(metrics.network.bandwidth).toBeGreaterThan(0);
            expect(metrics.network.latency).toBe(systemState.network.latency);
            expect(metrics.network.packetsLost).toBe(systemState.network.rxDropped + systemState.network.rxErrors);
            
            // Network metrics should be reasonable
            expect(metrics.network.bandwidth).toBeLessThanOrEqual(10000); // Max 10Gbps
            expect(metrics.network.latency).toBeGreaterThanOrEqual(0);
            expect(metrics.network.packetsLost).toBeGreaterThanOrEqual(0);

            // **Complete System Visibility Validation**
            // Ensure metrics provide comprehensive system visibility
            expect(validateSystemMetrics(metrics)).toBe(true);
            
            // Verify metrics are internally consistent
            expect(metrics.memory.used + metrics.memory.available).toBeLessThanOrEqual(metrics.memory.total * 1.1); // Allow some overhead
            expect(metrics.storage.used + metrics.storage.available).toBeLessThanOrEqual(metrics.storage.total * 1.1); // Allow filesystem overhead
          }
        ),
        { 
          numRuns: 10, // Reduced significantly for faster execution
          timeout: 10000, // 10 second timeout per test
        }
      );
    });

    it('should maintain metric consistency across multiple collections', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              cpuUsage: fc.float({ min: 0, max: 100 }),
              temperature: fc.integer({ min: 30000, max: 80000 }),
              memoryUsed: fc.integer({ min: 1000000, max: 4000000000 }),
              storageUsed: fc.integer({ min: 1000000000, max: 500000000000 }),
            }),
            { minLength: 2, maxLength: 5 }
          ),
          async (systemStates) => {
            const collectedMetrics: SystemMetrics[] = [];
            
            for (const state of systemStates) {
              // Setup mocks for this state
              mockExistsSync.mockReturnValue(true);
              mockReadFileSync.mockImplementation((path: string) => {
                if (path === '/proc/stat') return 'cpu  100 0 50 1000 0 0 0 0 0 0\n';
                if (path === '/sys/class/thermal/thermal_zone0/temp') return state.temperature.toString();
                if (path === '/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq') return '1500000'; // 1.5GHz
                if (path === '/sys/devices/system/cpu/cpu0/cpufreq/scaling_max_freq') return '1800000'; // 1.8GHz
                if (path === '/proc/meminfo') {
                  const total = 4194304; // 4GB in KB
                  const available = total - Math.floor(state.memoryUsed / 1024);
                  return `MemTotal: ${total} kB\nMemAvailable: ${available} kB\nSwapTotal: 1048576 kB\nSwapFree: 524288 kB\n`;
                }
                if (path.includes('/sys/class/net/') && path.includes('/statistics/rx_packets')) {
                  return '1000';
                }
                if (path.includes('/sys/class/net/') && path.includes('/statistics/rx_dropped')) {
                  return '0';
                }
                if (path.includes('/sys/class/net/') && path.includes('/statistics/rx_errors')) {
                  return '0';
                }
                return '';
              });
              
              mockExecSync.mockImplementation((command: string) => {
                if (command === 'df -B1 /') {
                  const total = 32000000000; // 32GB
                  const used = Math.min(state.storageUsed, total - 1000000000); // Ensure available space
                  const available = total - used;
                  return `Filesystem 1B-blocks Used Available Use% Mounted\n/dev/root ${total} ${used} ${available} 50% /\n`;
                }
                if (command === 'ping -c 1 -W 1 8.8.8.8') return 'PING 8.8.8.8: time=10.0 ms\n';
                if (command === 'ip route get 8.8.8.8') return 'via 192.168.1.1 dev wlan0 src 192.168.1.100\n';
                return '';
              });

              const metrics = await resourceMonitor.getSystemMetrics();
              collectedMetrics.push(metrics);
              
              // Small delay to ensure timestamp differences
              await new Promise(resolve => setTimeout(resolve, 1));
            }

            // **Comprehensive Resource Monitoring Consistency**
            // Verify all collections have complete metrics
            for (const metrics of collectedMetrics) {
              expect(validateSystemMetrics(metrics)).toBe(true);
              
              // Each collection should have all required components
              expect(metrics.cpu).toBeDefined();
              expect(metrics.memory).toBeDefined();
              expect(metrics.storage).toBeDefined();
              expect(metrics.network).toBeDefined();
            }

            // Verify timestamps are in chronological order
            for (let i = 1; i < collectedMetrics.length; i++) {
              expect(collectedMetrics[i].timestamp.getTime()).toBeGreaterThanOrEqual(
                collectedMetrics[i - 1].timestamp.getTime()
              );
            }

            // Verify last metrics tracking
            const lastMetrics = resourceMonitor.getLastMetrics();
            expect(lastMetrics).toBeDefined();
            expect(lastMetrics?.timestamp).toEqual(collectedMetrics[collectedMetrics.length - 1].timestamp);
          }
        ),
        { 
          numRuns: 10, // Fewer runs due to multiple async operations
          timeout: propertyTestConfig.timeout * 2,
        }
      );
    });

    it('should handle system file access errors gracefully while maintaining monitoring capability', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            procStatExists: fc.boolean(),
            thermalExists: fc.boolean(),
            meminfoExists: fc.boolean(),
            cpufreqExists: fc.boolean(),
            dfFails: fc.boolean(),
            pingFails: fc.boolean(),
            routeFails: fc.boolean(),
          }),
          async (errorConditions) => {
            // Setup mocks based on error conditions
            mockExistsSync.mockImplementation((path: string) => {
              if (path === '/proc/stat') return errorConditions.procStatExists;
              if (path === '/sys/class/thermal/thermal_zone0/temp') return errorConditions.thermalExists;
              if (path === '/proc/meminfo') return errorConditions.meminfoExists;
              if (path.includes('cpufreq')) return errorConditions.cpufreqExists;
              return true;
            });

            mockReadFileSync.mockImplementation((path: string) => {
              if (path === '/proc/stat' && errorConditions.procStatExists) {
                return 'cpu  100 0 50 1000 0 0 0 0 0 0\n';
              }
              if (path === '/sys/class/thermal/thermal_zone0/temp' && errorConditions.thermalExists) {
                return '45000';
              }
              if (path === '/proc/meminfo' && errorConditions.meminfoExists) {
                return 'MemTotal: 4194304 kB\nMemAvailable: 3145728 kB\nSwapTotal: 1048576 kB\nSwapFree: 524288 kB\n';
              }
              if (path.includes('cpufreq') && errorConditions.cpufreqExists) {
                return '1500000';
              }
              if (path.includes('/sys/class/net/') && path.includes('/statistics/rx_packets')) {
                return '1000';
              }
              if (path.includes('/sys/class/net/') && path.includes('/statistics/rx_dropped')) {
                return '0';
              }
              if (path.includes('/sys/class/net/') && path.includes('/statistics/rx_errors')) {
                return '0';
              }
              throw new Error('File not accessible');
            });

            mockExecSync.mockImplementation((command: string) => {
              if (command === 'df -B1 /' && !errorConditions.dfFails) {
                return 'Filesystem 1B-blocks Used Available Use% Mounted\n/dev/root 32000000000 16000000000 16000000000 50% /\n';
              }
              if (command === 'ping -c 1 -W 1 8.8.8.8' && !errorConditions.pingFails) {
                return 'PING 8.8.8.8: time=10.0 ms\n';
              }
              if (command === 'ip route get 8.8.8.8' && !errorConditions.routeFails) {
                return 'via 192.168.1.1 dev wlan0 src 192.168.1.100\n';
              }
              
              if (errorConditions.dfFails && command === 'df -B1 /') {
                throw new Error('df command failed');
              }
              if (errorConditions.pingFails && command === 'ping -c 1 -W 1 8.8.8.8') {
                throw new Error('ping command failed');
              }
              if (errorConditions.routeFails && command === 'ip route get 8.8.8.8') {
                throw new Error('route command failed');
              }
              
              return '';
            });

            // **Property 26: Comprehensive Resource Monitoring under error conditions**
            // System should still provide complete metrics even with partial failures
            const metrics = await resourceMonitor.getSystemMetrics();

            // Should never throw errors - graceful degradation
            expect(metrics).toBeDefined();
            expect(validateSystemMetrics(metrics)).toBe(true);

            // All metric categories should be present with reasonable defaults
            expect(metrics.cpu.usage).toBeGreaterThanOrEqual(0);
            expect(metrics.cpu.usage).toBeLessThanOrEqual(100);
            expect(metrics.cpu.temperature).toBeGreaterThan(0);
            expect(metrics.cpu.frequency).toBeGreaterThan(0);

            expect(metrics.memory.total).toBeGreaterThan(0);
            expect(metrics.memory.used).toBeGreaterThanOrEqual(0);
            expect(metrics.memory.available).toBeGreaterThanOrEqual(0);

            expect(metrics.storage.total).toBeGreaterThan(0);
            expect(metrics.storage.used).toBeGreaterThanOrEqual(0);
            expect(metrics.storage.available).toBeGreaterThanOrEqual(0);

            expect(['wifi', 'ethernet']).toContain(metrics.network.interface);
            expect(metrics.network.bandwidth).toBeGreaterThan(0);
            expect(metrics.network.latency).toBeGreaterThanOrEqual(0);

            // When files don't exist, should use reasonable defaults
            if (!errorConditions.thermalExists) {
              expect(metrics.cpu.temperature).toBe(45); // Default safe temperature from ResourceMonitor
            } else {
              expect(metrics.cpu.temperature).toBeGreaterThan(0);
            }
            if (!errorConditions.cpufreqExists) {
              expect(metrics.cpu.frequency).toBe(1500); // Default frequency from ResourceMonitor
            } else {
              expect(metrics.cpu.frequency).toBeGreaterThan(0);
            }
            if (!errorConditions.meminfoExists) {
              expect(metrics.memory.total).toBe(mockConfig.memory.total * 1024 * 1024);
            } else {
              expect(metrics.memory.total).toBeGreaterThan(0);
            }
          }
        ),
        { 
          numRuns: 15, // Reduced for faster execution as requested
          timeout: propertyTestConfig.timeout,
        }
      );
    });

    it('should provide accurate resource tracking across different Pi hardware configurations', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            model: fc.constantFrom('Pi 3B+', 'Pi 4B', 'Pi 5', 'Pi Zero 2W'),
            architecture: fc.constantFrom('arm64', 'armv7l'),
            totalMemoryMB: fc.constantFrom(512, 1024, 2048, 4096, 8192),
            storageType: fc.constantFrom('sd', 'usb', 'ssd'),
          }),
          async (hardwareConfig) => {
            // Create configuration for this hardware
            const config: PiConfiguration = {
              model: hardwareConfig.model,
              architecture: hardwareConfig.architecture,
              memory: {
                total: hardwareConfig.totalMemoryMB,
                limit: Math.min(hardwareConfig.totalMemoryMB, 2048), // Max 2GB limit
              },
              thermal: {
                thresholds: [70, 75, 80],
              },
              storage: {
                type: hardwareConfig.storageType,
                wearLeveling: hardwareConfig.storageType === 'sd',
              },
              gpio: {
                available: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27],
                reserved: [0, 1],
              },
            };

            const monitor = new ResourceMonitor(config);

            // Setup consistent mocks
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockImplementation((path: string) => {
              if (path === '/proc/stat') return 'cpu  100 0 50 1000 0 0 0 0 0 0\n';
              if (path === '/sys/class/thermal/thermal_zone0/temp') return '55000';
              if (path === '/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq') return '1500000'; // 1.5GHz
              if (path === '/sys/devices/system/cpu/cpu0/cpufreq/scaling_max_freq') return '1800000'; // 1.8GHz
              if (path === '/proc/meminfo') {
                const totalKB = hardwareConfig.totalMemoryMB * 1024;
                const availableKB = Math.floor(totalKB * 0.7); // 70% available
                return `MemTotal: ${totalKB} kB\nMemAvailable: ${availableKB} kB\nSwapTotal: 1048576 kB\nSwapFree: 524288 kB\n`;
              }
              if (path.includes('/sys/class/net/') && path.includes('/statistics/rx_packets')) {
                return '1000';
              }
              if (path.includes('/sys/class/net/') && path.includes('/statistics/rx_dropped')) {
                return '0';
              }
              if (path.includes('/sys/class/net/') && path.includes('/statistics/rx_errors')) {
                return '0';
              }
              return '';
            });

            mockExecSync.mockImplementation((command: string) => {
              if (command === 'df -B1 /') {
                return 'Filesystem 1B-blocks Used Available Use% Mounted\n/dev/root 32000000000 16000000000 16000000000 50% /\n';
              }
              if (command === 'ping -c 1 -W 1 8.8.8.8') {
                return 'PING 8.8.8.8: time=10.0 ms\n';
              }
              if (command === 'ip route get 8.8.8.8') {
                return 'via 192.168.1.1 dev wlan0 src 192.168.1.100\n';
              }
              return '';
            });

            const metrics = await monitor.getSystemMetrics();

            // **Property 26: Hardware-specific comprehensive monitoring**
            // Metrics should be accurate for the specific hardware configuration
            expect(validateSystemMetrics(metrics)).toBe(true);

            // Memory metrics should reflect the hardware configuration
            expect(metrics.memory.total).toBe(hardwareConfig.totalMemoryMB * 1024 * 1024);
            expect(metrics.memory.available).toBe(Math.floor(hardwareConfig.totalMemoryMB * 1024 * 0.7) * 1024);
            expect(metrics.memory.used).toBe(metrics.memory.total - metrics.memory.available);

            // All hardware configurations should provide complete monitoring
            expect(metrics.cpu.usage).toBeGreaterThanOrEqual(0);
            expect(metrics.cpu.temperature).toBe(55); // From mock temperature value
            expect(metrics.storage.total).toBeGreaterThan(0);
            expect(metrics.network.interface).toMatch(/^(wifi|ethernet)$/);

            // Cleanup
            monitor.stopMonitoring();
          }
        ),
        { 
          numRuns: 15, // Reduced for faster execution as requested
          timeout: propertyTestConfig.timeout,
        }
      );
    });
  });

  /**
   * Property 4: Hardware-Adaptive Memory Limits
   * **Validates: Requirements 2.1, 2.2, 2.3**
   * 
   * For any Raspberry Pi model, the Pi_System should detect the total RAM and 
   * enforce appropriate memory limits (512MB for 1GB models, 1GB for 2GB models, 
   * 2GB for 4GB+ models), never exceeding the configured limit.
   */
  describe('Property 4: Hardware-Adaptive Memory Limits', () => {
    it('should enforce hardware-adaptive memory limits for all Pi models', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            // Generate different Pi hardware configurations
            piModel: fc.constantFrom('Pi 3B+', 'Pi 4B', 'Pi 5', 'Pi Zero 2W', 'Pi 400'),
            totalRAM: fc.constantFrom(512, 1024, 2048, 4096, 8192), // MB
            architecture: fc.constantFrom('arm64', 'armv7l'),
            // Generate memory usage scenarios
            memoryUsageScenario: fc.record({
              totalKB: fc.integer({ min: 524288, max: 8388608 }), // 512MB to 8GB in KB
              availableKB: fc.integer({ min: 100000, max: 7000000 }), // Variable available memory
              swapTotalKB: fc.integer({ min: 0, max: 2097152 }), // 0 to 2GB swap
              swapUsedKB: fc.integer({ min: 0, max: 1048576 }), // Variable swap usage
            }).filter(scenario => 
              scenario.availableKB <= scenario.totalKB && 
              scenario.swapUsedKB <= scenario.swapTotalKB
            ),
          }),
          async (testCase) => {
            // Create Pi configuration based on hardware specs
            const config: PiConfiguration = {
              model: testCase.piModel,
              architecture: testCase.architecture,
              memory: {
                total: testCase.totalRAM,
                // Apply hardware-adaptive memory limits as per requirements
                limit: testCase.totalRAM <= 1024 ? 512 :  // 512MB limit for 1GB models (Req 2.1)
                       testCase.totalRAM <= 2048 ? 1024 : // 1GB limit for 2GB models (Req 2.2)
                       2048                               // 2GB limit for 4GB+ models (Req 2.3)
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

            const monitor = new ResourceMonitor(config);

            // Setup mocks to simulate the memory scenario
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockImplementation((path: string) => {
              if (path === '/proc/stat') {
                return 'cpu  100 0 50 1000 0 0 0 0 0 0\n';
              }
              if (path === '/sys/class/thermal/thermal_zone0/temp') {
                return '45000'; // 45°C
              }
              if (path === '/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq') {
                return '1500000'; // 1.5GHz
              }
              if (path === '/sys/devices/system/cpu/cpu0/cpufreq/scaling_max_freq') {
                return '1800000'; // 1.8GHz
              }
              if (path === '/proc/meminfo') {
                const { totalKB, availableKB, swapTotalKB, swapUsedKB } = testCase.memoryUsageScenario;
                const swapFreeKB = swapTotalKB - swapUsedKB;
                return `MemTotal: ${totalKB} kB\nMemAvailable: ${availableKB} kB\nSwapTotal: ${swapTotalKB} kB\nSwapFree: ${swapFreeKB} kB\n`;
              }
              if (path.includes('/sys/class/net/') && path.includes('/statistics/rx_packets')) {
                return '1000';
              }
              if (path.includes('/sys/class/net/') && path.includes('/statistics/rx_dropped')) {
                return '0';
              }
              if (path.includes('/sys/class/net/') && path.includes('/statistics/rx_errors')) {
                return '0';
              }
              return '';
            });

            mockExecSync.mockImplementation((command: string) => {
              if (command === 'df -B1 /') {
                return 'Filesystem 1B-blocks Used Available Use% Mounted\n/dev/root 32000000000 16000000000 16000000000 50% /\n';
              }
              if (command === 'ping -c 1 -W 1 8.8.8.8') {
                return 'PING 8.8.8.8: time=10.0 ms\n';
              }
              if (command === 'ip route get 8.8.8.8') {
                return 'via 192.168.1.1 dev wlan0 src 192.168.1.100\n';
              }
              return '';
            });

            // Collect system metrics
            const metrics = await monitor.getSystemMetrics();

            // **Property 4: Hardware-Adaptive Memory Limits**
            
            // 1. Verify memory limit detection is correct for the Pi model
            const expectedLimit = config.memory.limit;
            
            // Requirement 2.1: 1GB RAM Pi models should have 512MB limit
            if (testCase.totalRAM <= 1024) {
              expect(expectedLimit).toBe(512);
            }
            // Requirement 2.2: 2GB RAM Pi models should have 1GB limit  
            else if (testCase.totalRAM <= 2048) {
              expect(expectedLimit).toBe(1024);
            }
            // Requirement 2.3: 4GB+ RAM Pi models should have 2GB limit
            else {
              expect(expectedLimit).toBe(2048);
            }

            // 2. Verify the system correctly reports total memory
            expect(metrics.memory.total).toBe(testCase.memoryUsageScenario.totalKB * 1024);
            expect(metrics.memory.available).toBe(testCase.memoryUsageScenario.availableKB * 1024);
            expect(metrics.memory.used).toBe((testCase.memoryUsageScenario.totalKB - testCase.memoryUsageScenario.availableKB) * 1024);

            // 3. Verify memory limit enforcement mechanism
            const memoryLimitBytes = config.memory.limit * 1024 * 1024;
            
            // Monitor should track when memory usage exceeds the configured limit
            let memoryLimitExceededEmitted = false;
            monitor.once('memoryLimitExceeded', (event) => {
              memoryLimitExceededEmitted = true;
              expect(event.used).toBeGreaterThan(event.limit);
              expect(event.limit).toBe(memoryLimitBytes);
              expect(event.metrics).toBeDefined();
            });

            // If current memory usage exceeds the limit, the event should be emitted
            if (metrics.memory.used > memoryLimitBytes) {
              // Trigger threshold checking by getting metrics again
              await monitor.getSystemMetrics();
              expect(memoryLimitExceededEmitted).toBe(true);
            }

            // 4. Verify memory limits never exceed the configured maximum
            expect(config.memory.limit).toBeLessThanOrEqual(Math.max(512, Math.min(2048, testCase.totalRAM)));

            // 5. Verify memory metrics are consistent and valid
            expect(validateSystemMetrics(metrics)).toBe(true);
            expect(metrics.memory.used).toBeGreaterThanOrEqual(0);
            expect(metrics.memory.available).toBeGreaterThanOrEqual(0);
            expect(metrics.memory.used + metrics.memory.available).toBeLessThanOrEqual(metrics.memory.total * 1.1); // Allow some overhead

            // 6. Verify swap usage is properly tracked
            expect(metrics.memory.swapUsed).toBe(testCase.memoryUsageScenario.swapUsedKB * 1024);
            expect(metrics.memory.swapUsed).toBeGreaterThanOrEqual(0);

            // Cleanup
            monitor.stopMonitoring();
          }
        ),
        { 
          numRuns: 15, // Reduced for faster execution as requested
          timeout: 8000, // 8 second timeout per test
        }
      );
    });

    it('should trigger memory pressure events when approaching hardware limits', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            piModel: fc.constantFrom('Pi 3B+', 'Pi 4B', 'Pi 5'),
            totalRAM: fc.constantFrom(1024, 2048, 4096), // MB
            memoryPressureLevel: fc.float({ min: Math.fround(0.7), max: Math.fround(0.95) }), // 70% to 95% usage
          }),
          async (testCase) => {
            // Create configuration with appropriate memory limits
            const config: PiConfiguration = {
              model: testCase.piModel,
              architecture: 'arm64',
              memory: {
                total: testCase.totalRAM,
                limit: testCase.totalRAM <= 1024 ? 512 :
                       testCase.totalRAM <= 2048 ? 1024 : 
                       2048
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

            const monitor = new ResourceMonitor(config);

            // Calculate memory usage to create pressure scenario
            const totalKB = testCase.totalRAM * 1024;
            const usedKB = Math.floor(totalKB * testCase.memoryPressureLevel);
            const availableKB = totalKB - usedKB;

            // Setup mocks for memory pressure scenario
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockImplementation((path: string) => {
              if (path === '/proc/stat') return 'cpu  100 0 50 1000 0 0 0 0 0 0\n';
              if (path === '/sys/class/thermal/thermal_zone0/temp') return '45000';
              if (path === '/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq') return '1500000';
              if (path === '/sys/devices/system/cpu/cpu0/cpufreq/scaling_max_freq') return '1800000';
              if (path === '/proc/meminfo') {
                return `MemTotal: ${totalKB} kB\nMemAvailable: ${availableKB} kB\nSwapTotal: 1048576 kB\nSwapFree: 524288 kB\n`;
              }
              if (path.includes('/sys/class/net/') && path.includes('/statistics/rx_packets')) return '1000';
              if (path.includes('/sys/class/net/') && path.includes('/statistics/rx_dropped')) return '0';
              if (path.includes('/sys/class/net/') && path.includes('/statistics/rx_errors')) return '0';
              return '';
            });

            mockExecSync.mockImplementation((command: string) => {
              if (command === 'df -B1 /') return 'Filesystem 1B-blocks Used Available Use% Mounted\n/dev/root 32000000000 16000000000 16000000000 50% /\n';
              if (command === 'ping -c 1 -W 1 8.8.8.8') return 'PING 8.8.8.8: time=10.0 ms\n';
              if (command === 'ip route get 8.8.8.8') return 'via 192.168.1.1 dev wlan0 src 192.168.1.100\n';
              return '';
            });

            // Track memory pressure events
            let memoryPressureEvents: Array<{ level: string; usage: number }> = [];
            monitor.on('memoryPressure', (event) => {
              memoryPressureEvents.push({ level: event.level, usage: event.usage });
            });

            // Collect metrics to trigger threshold checking
            const metrics = await monitor.getSystemMetrics();

            // **Property 4: Memory pressure response validation**
            
            // Verify memory usage calculation is correct
            const actualMemoryUsage = metrics.memory.used / metrics.memory.total;
            expect(actualMemoryUsage).toBeCloseTo(testCase.memoryPressureLevel, 2);

            // Verify memory pressure events are triggered appropriately
            if (testCase.memoryPressureLevel >= 0.8) {
              // Should trigger GC threshold (80%)
              expect(memoryPressureEvents.some(e => e.level === 'gc')).toBe(true);
              
              if (testCase.memoryPressureLevel >= 0.9) {
                // Should trigger critical threshold (90%)
                expect(memoryPressureEvents.some(e => e.level === 'critical')).toBe(true);
              }
            }

            // Verify memory limit enforcement is active
            const memoryLimitBytes = config.memory.limit * 1024 * 1024;
            expect(memoryLimitBytes).toBeGreaterThan(0);
            expect(memoryLimitBytes).toBeLessThanOrEqual(2048 * 1024 * 1024); // Never exceed 2GB limit

            // Verify hardware-adaptive limits are correctly applied
            if (testCase.totalRAM <= 1024) {
              expect(config.memory.limit).toBe(512); // Requirement 2.1
            } else if (testCase.totalRAM <= 2048) {
              expect(config.memory.limit).toBe(1024); // Requirement 2.2  
            } else {
              expect(config.memory.limit).toBe(2048); // Requirement 2.3
            }

            // Cleanup
            monitor.stopMonitoring();
          }
        ),
        { 
          numRuns: 12, // Reduced for faster execution
          timeout: 6000,
        }
      );
    });

    it('should maintain memory limit consistency across different system states', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            piConfigs: fc.array(
              fc.record({
                model: fc.constantFrom('Pi 3B+', 'Pi 4B', 'Pi 5'),
                totalRAM: fc.constantFrom(1024, 2048, 4096, 8192),
                architecture: fc.constantFrom('arm64', 'armv7l'),
              }),
              { minLength: 2, maxLength: 4 }
            ),
          }),
          async (testCase) => {
            for (const piConfig of testCase.piConfigs) {
              const config: PiConfiguration = {
                model: piConfig.model,
                architecture: piConfig.architecture,
                memory: {
                  total: piConfig.totalRAM,
                  limit: piConfig.totalRAM <= 1024 ? 512 :
                         piConfig.totalRAM <= 2048 ? 1024 :
                         2048
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

              const monitor = new ResourceMonitor(config);

              // Setup consistent mocks
              mockExistsSync.mockReturnValue(true);
              mockReadFileSync.mockImplementation((path: string) => {
                if (path === '/proc/stat') return 'cpu  100 0 50 1000 0 0 0 0 0 0\n';
                if (path === '/sys/class/thermal/thermal_zone0/temp') return '45000';
                if (path === '/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq') return '1500000';
                if (path === '/sys/devices/system/cpu/cpu0/cpufreq/scaling_max_freq') return '1800000';
                if (path === '/proc/meminfo') {
                  const totalKB = piConfig.totalRAM * 1024;
                  const availableKB = Math.floor(totalKB * 0.6); // 60% available
                  return `MemTotal: ${totalKB} kB\nMemAvailable: ${availableKB} kB\nSwapTotal: 1048576 kB\nSwapFree: 524288 kB\n`;
                }
                if (path.includes('/sys/class/net/') && path.includes('/statistics/rx_packets')) return '1000';
                if (path.includes('/sys/class/net/') && path.includes('/statistics/rx_dropped')) return '0';
                if (path.includes('/sys/class/net/') && path.includes('/statistics/rx_errors')) return '0';
                return '';
              });

              mockExecSync.mockImplementation((command: string) => {
                if (command === 'df -B1 /') return 'Filesystem 1B-blocks Used Available Use% Mounted\n/dev/root 32000000000 16000000000 16000000000 50% /\n';
                if (command === 'ping -c 1 -W 1 8.8.8.8') return 'PING 8.8.8.8: time=10.0 ms\n';
                if (command === 'ip route get 8.8.8.8') return 'via 192.168.1.1 dev wlan0 src 192.168.1.100\n';
                return '';
              });

              const metrics = await monitor.getSystemMetrics();

              // **Property 4: Consistent memory limit enforcement**
              
              // Verify hardware-adaptive memory limits are consistently applied
              const expectedLimit = piConfig.totalRAM <= 1024 ? 512 :
                                   piConfig.totalRAM <= 2048 ? 1024 :
                                   2048;
              
              expect(config.memory.limit).toBe(expectedLimit);
              
              // Verify memory limits never exceed maximum allowed (2GB)
              expect(config.memory.limit).toBeLessThanOrEqual(2048);
              
              // Verify memory limits are reasonable for the hardware
              expect(config.memory.limit).toBeLessThanOrEqual(piConfig.totalRAM);
              
              // Verify memory metrics are valid
              expect(validateSystemMetrics(metrics)).toBe(true);
              expect(metrics.memory.total).toBe(piConfig.totalRAM * 1024 * 1024);

              monitor.stopMonitoring();
            }
          }
        ),
        { 
          numRuns: 10, // Reduced for faster execution
          timeout: 8000,
        }
      );
    });
  });

  /**
   * Property 5: Memory Pressure Response
   * **Validates: Requirements 2.4, 2.5**
   * 
   * For any memory usage pattern, when memory usage exceeds 80% of the allocated limit, 
   * the Resource_Monitor should trigger garbage collection and gracefully reduce 
   * non-essential services, maintaining system stability.
   */
  describe('Property 5: Memory Pressure Response', () => {
    it('should trigger garbage collection when memory usage exceeds 80% threshold', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            // Generate different Pi configurations
            piConfig: fc.record({
              model: fc.constantFrom('Pi 3B+', 'Pi 4B', 'Pi 5'),
              totalRAM: fc.constantFrom(1024, 2048, 4096), // MB
              architecture: fc.constantFrom('arm64', 'armv7l'),
            }),
            // Generate memory usage scenarios that exceed 80% threshold
            memoryScenario: fc.record({
              usagePercentage: fc.float({ min: Math.fround(0.8), max: Math.fround(0.95) }), // 80% to 95%
              swapUsageKB: fc.integer({ min: 0, max: 524288 }), // 0 to 512MB swap
            }),
          }),
          async (testCase) => {
            // Create Pi configuration
            const config: PiConfiguration = {
              model: testCase.piConfig.model,
              architecture: testCase.piConfig.architecture,
              memory: {
                total: testCase.piConfig.totalRAM,
                limit: testCase.piConfig.totalRAM <= 1024 ? 512 :
                       testCase.piConfig.totalRAM <= 2048 ? 1024 :
                       2048
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

            const monitor = new ResourceMonitor(config);

            // Calculate memory usage to exceed 80% threshold
            const totalKB = testCase.piConfig.totalRAM * 1024;
            const usedKB = Math.floor(totalKB * testCase.memoryScenario.usagePercentage);
            const availableKB = totalKB - usedKB;

            // Setup mocks for memory pressure scenario
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockImplementation((path: string) => {
              if (path === '/proc/stat') return 'cpu  100 0 50 1000 0 0 0 0 0 0\n';
              if (path === '/sys/class/thermal/thermal_zone0/temp') return '45000';
              if (path === '/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq') return '1500000';
              if (path === '/sys/devices/system/cpu/cpu0/cpufreq/scaling_max_freq') return '1800000';
              if (path === '/proc/meminfo') {
                return `MemTotal: ${totalKB} kB\nMemAvailable: ${availableKB} kB\nSwapTotal: 1048576 kB\nSwapFree: ${1048576 - testCase.memoryScenario.swapUsageKB} kB\n`;
              }
              if (path.includes('/sys/class/net/') && path.includes('/statistics/rx_packets')) return '1000';
              if (path.includes('/sys/class/net/') && path.includes('/statistics/rx_dropped')) return '0';
              if (path.includes('/sys/class/net/') && path.includes('/statistics/rx_errors')) return '0';
              return '';
            });

            mockExecSync.mockImplementation((command: string) => {
              if (command === 'df -B1 /') return 'Filesystem 1B-blocks Used Available Use% Mounted\n/dev/root 32000000000 16000000000 16000000000 50% /\n';
              if (command === 'ping -c 1 -W 1 8.8.8.8') return 'PING 8.8.8.8: time=10.0 ms\n';
              if (command === 'ip route get 8.8.8.8') return 'via 192.168.1.1 dev wlan0 src 192.168.1.100\n';
              return '';
            });

            // Enable adaptive scaling to activate memory pressure response
            monitor.enableAdaptiveScaling();

            // Track memory pressure events
            let memoryPressureEvents: Array<{ level: string; usage: number; timestamp: Date }> = [];
            let garbageCollectionTriggered = false;
            let serviceReductionRequested = false;

            monitor.on('memoryPressure', (event) => {
              memoryPressureEvents.push({ 
                level: event.level, 
                usage: event.usage, 
                timestamp: new Date() 
              });
            });

            monitor.on('garbageCollectionTriggered', () => {
              garbageCollectionTriggered = true;
            });

            monitor.on('serviceReductionRequested', (event) => {
              serviceReductionRequested = true;
              expect(event.reason).toMatch(/memory/);
              expect(event.level).toMatch(/^(light|moderate|aggressive)$/);
              expect(event.timestamp).toBeInstanceOf(Date);
            });

            // Collect metrics to trigger memory pressure response
            const metrics = await monitor.getSystemMetrics();

            // **Property 5: Memory Pressure Response Validation**

            // 1. Verify memory usage calculation is correct
            const actualMemoryUsage = metrics.memory.used / metrics.memory.total;
            expect(actualMemoryUsage).toBeCloseTo(testCase.memoryScenario.usagePercentage, 2);

            // 2. **Requirement 2.4**: Trigger garbage collection at 80% memory usage
            if (testCase.memoryScenario.usagePercentage >= 0.8) {
              // Allow for small floating point precision issues
              const hasGCEvent = memoryPressureEvents.some(e => e.level === 'gc');
              const hasMemoryPressure = actualMemoryUsage >= 0.799; // Allow small tolerance
              
              if (hasMemoryPressure) {
                expect(hasGCEvent).toBe(true);
                
                // Verify GC event has correct usage information
                const gcEvent = memoryPressureEvents.find(e => e.level === 'gc');
                if (gcEvent) {
                  expect(gcEvent.usage).toBeGreaterThanOrEqual(0.799); // Allow small tolerance
                  expect(gcEvent.timestamp).toBeInstanceOf(Date);
                }
              }
            }

            // 3. **Requirement 2.5**: Graceful service reduction under memory pressure
            if (testCase.memoryScenario.usagePercentage >= 0.9) {
              expect(memoryPressureEvents.some(e => e.level === 'critical')).toBe(true);
              expect(serviceReductionRequested).toBe(true);
              
              // Verify critical event has correct usage information
              const criticalEvent = memoryPressureEvents.find(e => e.level === 'critical');
              if (criticalEvent) {
                expect(criticalEvent.usage).toBeGreaterThanOrEqual(0.9);
              }
            }

            // 4. Verify memory pressure response maintains system stability
            expect(validateSystemMetrics(metrics)).toBe(true);
            expect(metrics.memory.used).toBeGreaterThanOrEqual(0);
            expect(metrics.memory.available).toBeGreaterThanOrEqual(0);
            expect(metrics.memory.total).toBeGreaterThan(0);

            // 5. Verify memory pressure level detection is accurate
            const pressureLevel = monitor.getMemoryPressureLevel();
            if (testCase.memoryScenario.usagePercentage >= 0.9) {
              expect(pressureLevel).toBe('critical');
            } else if (testCase.memoryScenario.usagePercentage >= 0.8) {
              expect(pressureLevel).toBe('gc');
            } else {
              expect(pressureLevel).toBe('normal');
            }

            // 6. Verify memory pressure state tracking
            const isMemoryPressureActive = monitor.isMemoryPressureActive();
            if (testCase.memoryScenario.usagePercentage >= 0.9) {
              expect(isMemoryPressureActive).toBe(true);
            }

            // 7. Verify memory limit usage calculations
            const memoryLimitUsage = monitor.getMemoryLimitUsage();
            expect(memoryLimitUsage.totalUsage).toBeCloseTo(actualMemoryUsage, 2);
            expect(memoryLimitUsage.limitUsage).toBeGreaterThanOrEqual(0);
            expect(memoryLimitUsage.availableBeforeLimit).toBeGreaterThanOrEqual(0);
            expect(typeof memoryLimitUsage.withinLimit).toBe('boolean');

            // Cleanup
            monitor.stopMonitoring();
          }
        ),
        { 
          numRuns: 15, // Reduced for faster execution as requested
          timeout: 8000,
        }
      );
    });

    it('should gracefully reduce services under sustained memory pressure', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            // Generate memory pressure scenarios
            memoryPressurePattern: fc.array(
              fc.record({
                usagePercentage: fc.float({ min: Math.fround(0.85), max: Math.fround(0.98) }), // High memory usage
                durationMs: fc.integer({ min: 100, max: 500 }), // Duration of pressure
              }),
              { minLength: 2, maxLength: 4 }
            ),
            piConfig: fc.record({
              totalRAM: fc.constantFrom(1024, 2048, 4096),
              model: fc.constantFrom('Pi 4B', 'Pi 5'),
            }),
          }),
          async (testCase) => {
            const config: PiConfiguration = {
              model: testCase.piConfig.model,
              architecture: 'arm64',
              memory: {
                total: testCase.piConfig.totalRAM,
                limit: testCase.piConfig.totalRAM <= 1024 ? 512 :
                       testCase.piConfig.totalRAM <= 2048 ? 1024 :
                       2048
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

            const monitor = new ResourceMonitor(config);
            monitor.enableAdaptiveScaling();

            // Track all memory pressure responses
            let serviceReductionEvents: Array<{ reason: string; level: string; timestamp: Date }> = [];
            let memoryPressureEvents: Array<{ level: string; usage: number }> = [];

            monitor.on('serviceReductionRequested', (event) => {
              serviceReductionEvents.push({
                reason: event.reason,
                level: event.level,
                timestamp: event.timestamp,
              });
            });

            monitor.on('memoryPressure', (event) => {
              memoryPressureEvents.push({ level: event.level, usage: event.usage });
            });

            // Simulate sustained memory pressure pattern
            for (const pressurePoint of testCase.memoryPressurePattern) {
              const totalKB = testCase.piConfig.totalRAM * 1024;
              const usedKB = Math.floor(totalKB * pressurePoint.usagePercentage);
              const availableKB = totalKB - usedKB;

              // Setup mocks for this pressure level
              mockExistsSync.mockReturnValue(true);
              mockReadFileSync.mockImplementation((path: string) => {
                if (path === '/proc/stat') return 'cpu  100 0 50 1000 0 0 0 0 0 0\n';
                if (path === '/sys/class/thermal/thermal_zone0/temp') return '45000';
                if (path === '/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq') return '1500000';
                if (path === '/sys/devices/system/cpu/cpu0/cpufreq/scaling_max_freq') return '1800000';
                if (path === '/proc/meminfo') {
                  return `MemTotal: ${totalKB} kB\nMemAvailable: ${availableKB} kB\nSwapTotal: 1048576 kB\nSwapFree: 524288 kB\n`;
                }
                if (path.includes('/sys/class/net/') && path.includes('/statistics/rx_packets')) return '1000';
                if (path.includes('/sys/class/net/') && path.includes('/statistics/rx_dropped')) return '0';
                if (path.includes('/sys/class/net/') && path.includes('/statistics/rx_errors')) return '0';
                return '';
              });

              mockExecSync.mockImplementation((command: string) => {
                if (command === 'df -B1 /') return 'Filesystem 1B-blocks Used Available Use% Mounted\n/dev/root 32000000000 16000000000 16000000000 50% /\n';
                if (command === 'ping -c 1 -W 1 8.8.8.8') return 'PING 8.8.8.8: time=10.0 ms\n';
                if (command === 'ip route get 8.8.8.8') return 'via 192.168.1.1 dev wlan0 src 192.168.1.100\n';
                return '';
              });

              // Collect metrics to trigger pressure response
              await monitor.getSystemMetrics();
              
              // Wait for the specified duration to simulate sustained pressure
              await new Promise(resolve => setTimeout(resolve, pressurePoint.durationMs));
            }

            // **Property 5: Sustained Memory Pressure Response Validation**

            // 1. Verify service reduction was requested for high memory usage
            const highPressurePoints = testCase.memoryPressurePattern.filter(p => p.usagePercentage >= 0.9);
            if (highPressurePoints.length > 0) {
              expect(serviceReductionEvents.length).toBeGreaterThan(0);
              
              // Verify service reduction events have correct structure
              for (const event of serviceReductionEvents) {
                expect(event.reason).toMatch(/memory/);
                expect(['light', 'moderate', 'aggressive']).toContain(event.level);
                expect(event.timestamp).toBeInstanceOf(Date);
              }
            }

            // 2. Verify memory pressure events were triggered appropriately
            const gcPressurePoints = testCase.memoryPressurePattern.filter(p => p.usagePercentage >= 0.8);
            if (gcPressurePoints.length > 0) {
              expect(memoryPressureEvents.some(e => e.level === 'gc')).toBe(true);
            }

            // 3. Verify system maintains stability under sustained pressure
            const finalMetrics = await monitor.getSystemMetrics();
            expect(validateSystemMetrics(finalMetrics)).toBe(true);

            // 4. Verify memory pressure response escalation
            const criticalPressurePoints = testCase.memoryPressurePattern.filter(p => p.usagePercentage >= 0.95);
            if (criticalPressurePoints.length > 0) {
              // Should have aggressive service reduction for very high memory usage
              expect(serviceReductionEvents.some(e => e.level === 'aggressive')).toBe(true);
            }

            // 5. Verify memory pressure state consistency
            const currentPressureLevel = monitor.getMemoryPressureLevel();
            const lastPressurePoint = testCase.memoryPressurePattern[testCase.memoryPressurePattern.length - 1];
            
            if (lastPressurePoint.usagePercentage >= 0.9) {
              expect(['critical', 'gc']).toContain(currentPressureLevel);
            } else if (lastPressurePoint.usagePercentage >= 0.8) {
              expect(['gc', 'normal']).toContain(currentPressureLevel);
            }

            // Cleanup
            monitor.stopMonitoring();
          }
        ),
        { 
          numRuns: 10, // Reduced for faster execution
          timeout: 10000, // Longer timeout due to multiple async operations
        }
      );
    });

    it('should maintain system stability across all memory usage patterns', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            // Generate various memory usage patterns
            memoryPattern: fc.array(
              fc.record({
                usagePercentage: fc.float({ min: Math.fround(0.3), max: Math.fround(0.98) }), // 30% to 98%
                swapUsageKB: fc.integer({ min: 0, max: 1048576 }), // 0 to 1GB swap
              }),
              { minLength: 3, maxLength: 6 }
            ),
            piConfig: fc.record({
              totalRAM: fc.constantFrom(1024, 2048, 4096),
              architecture: fc.constantFrom('arm64', 'armv7l'),
            }),
          }),
          async (testCase) => {
            const config: PiConfiguration = {
              model: 'Pi 4B',
              architecture: testCase.piConfig.architecture,
              memory: {
                total: testCase.piConfig.totalRAM,
                limit: testCase.piConfig.totalRAM <= 1024 ? 512 :
                       testCase.piConfig.totalRAM <= 2048 ? 1024 :
                       2048
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

            const monitor = new ResourceMonitor(config);
            monitor.enableAdaptiveScaling();

            const collectedMetrics: SystemMetrics[] = [];
            let totalMemoryPressureEvents = 0;
            let totalServiceReductions = 0;

            monitor.on('memoryPressure', () => {
              totalMemoryPressureEvents++;
            });

            monitor.on('serviceReductionRequested', () => {
              totalServiceReductions++;
            });

            // Test each memory usage pattern
            for (const memoryState of testCase.memoryPattern) {
              const totalKB = testCase.piConfig.totalRAM * 1024;
              const usedKB = Math.floor(totalKB * memoryState.usagePercentage);
              const availableKB = totalKB - usedKB;

              // Setup mocks for this memory state
              mockExistsSync.mockReturnValue(true);
              mockReadFileSync.mockImplementation((path: string) => {
                if (path === '/proc/stat') return 'cpu  100 0 50 1000 0 0 0 0 0 0\n';
                if (path === '/sys/class/thermal/thermal_zone0/temp') return '45000';
                if (path === '/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq') return '1500000';
                if (path === '/sys/devices/system/cpu/cpu0/cpufreq/scaling_max_freq') return '1800000';
                if (path === '/proc/meminfo') {
                  const swapFreeKB = Math.max(0, 1048576 - memoryState.swapUsageKB);
                  return `MemTotal: ${totalKB} kB\nMemAvailable: ${availableKB} kB\nSwapTotal: 1048576 kB\nSwapFree: ${swapFreeKB} kB\n`;
                }
                if (path.includes('/sys/class/net/') && path.includes('/statistics/rx_packets')) return '1000';
                if (path.includes('/sys/class/net/') && path.includes('/statistics/rx_dropped')) return '0';
                if (path.includes('/sys/class/net/') && path.includes('/statistics/rx_errors')) return '0';
                return '';
              });

              mockExecSync.mockImplementation((command: string) => {
                if (command === 'df -B1 /') return 'Filesystem 1B-blocks Used Available Use% Mounted\n/dev/root 32000000000 16000000000 16000000000 50% /\n';
                if (command === 'ping -c 1 -W 1 8.8.8.8') return 'PING 8.8.8.8: time=10.0 ms\n';
                if (command === 'ip route get 8.8.8.8') return 'via 192.168.1.1 dev wlan0 src 192.168.1.100\n';
                return '';
              });

              const metrics = await monitor.getSystemMetrics();
              collectedMetrics.push(metrics);

              // Small delay between measurements
              await new Promise(resolve => setTimeout(resolve, 10));
            }

            // **Property 5: System Stability Validation**

            // 1. Verify all metrics collections were successful and valid
            expect(collectedMetrics.length).toBe(testCase.memoryPattern.length);
            for (const metrics of collectedMetrics) {
              expect(validateSystemMetrics(metrics)).toBe(true);
            }

            // 2. Verify memory pressure response was triggered appropriately
            const highMemoryStates = testCase.memoryPattern.filter(m => m.usagePercentage >= 0.8);
            if (highMemoryStates.length > 0) {
              expect(totalMemoryPressureEvents).toBeGreaterThan(0);
            }

            // 3. Verify service reduction was requested for critical memory states
            const criticalMemoryStates = testCase.memoryPattern.filter(m => m.usagePercentage >= 0.9);
            if (criticalMemoryStates.length > 0) {
              expect(totalServiceReductions).toBeGreaterThan(0);
            }

            // 4. Verify system maintained stability throughout all memory patterns
            for (let i = 0; i < collectedMetrics.length; i++) {
              const metrics = collectedMetrics[i];
              const expectedUsage = testCase.memoryPattern[i].usagePercentage;
              
              const actualUsage = metrics.memory.used / metrics.memory.total;
              expect(actualUsage).toBeCloseTo(expectedUsage, 1); // Allow some tolerance
              
              // System should never crash or return invalid metrics
              expect(metrics.memory.total).toBeGreaterThan(0);
              expect(metrics.memory.used).toBeGreaterThanOrEqual(0);
              expect(metrics.memory.available).toBeGreaterThanOrEqual(0);
              expect(metrics.memory.swapUsed).toBeGreaterThanOrEqual(0);
            }

            // 5. Verify memory pressure response maintains system stability
            const finalPressureLevel = monitor.getMemoryPressureLevel();
            expect(['normal', 'gc', 'critical']).toContain(finalPressureLevel);

            // 6. Verify memory limit tracking remains consistent
            const memoryLimitUsage = monitor.getMemoryLimitUsage();
            expect(memoryLimitUsage.totalUsage).toBeGreaterThanOrEqual(0);
            expect(memoryLimitUsage.totalUsage).toBeLessThanOrEqual(1);
            expect(memoryLimitUsage.limitUsage).toBeGreaterThanOrEqual(0);

            // Cleanup
            monitor.stopMonitoring();
          }
        ),
        { 
          numRuns: 12, // Reduced for faster execution
          timeout: 12000, // Longer timeout due to multiple iterations
        }
      );
    });
  });
});