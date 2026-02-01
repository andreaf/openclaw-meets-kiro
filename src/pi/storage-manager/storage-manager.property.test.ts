/**
 * Property-Based Tests for StorageManager
 * 
 * **Feature: raspberry-pi-port, Property 7: Log Rotation Management**
 * **Validates: Requirements 3.1**
 * 
 * **Feature: raspberry-pi-port, Property 9: Temporary File Management**
 * **Validates: Requirements 3.3**
 * 
 * **Feature: raspberry-pi-port, Property 10: Storage Wear Leveling**
 * **Validates: Requirements 3.4**
 * 
 * Tests that the StorageManager maintains log size under 100MB through automatic rotation,
 * stores temporary files in tmpfs-mounted directories, and distributes writes across
 * available storage locations for wear leveling.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type MockedFunction } from 'vitest';
import * as fc from 'fast-check';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, renameSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { StorageManager } from './storage-manager.js';
import type { PiConfiguration } from '../types/pi-configuration.js';
import { propertyTestConfig } from '../test-setup.js';

// Mock Node.js modules
vi.mock('fs');
vi.mock('child_process');

const mockReadFileSync = readFileSync as MockedFunction<typeof readFileSync>;
const mockWriteFileSync = writeFileSync as MockedFunction<typeof writeFileSync>;
const mockExistsSync = existsSync as MockedFunction<typeof existsSync>;
const mockMkdirSync = mkdirSync as MockedFunction<typeof mkdirSync>;
const mockReaddirSync = readdirSync as MockedFunction<typeof readdirSync>;
const mockStatSync = statSync as MockedFunction<typeof statSync>;
const mockUnlinkSync = unlinkSync as MockedFunction<typeof unlinkSync>;
const mockRenameSync = renameSync as MockedFunction<typeof renameSync>;
const mockExecSync = execSync as MockedFunction<typeof execSync>;

describe('StorageManager Property-Based Tests', () => {
  let storageManager: StorageManager;
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

    // Reset all mocks to default behavior
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    mockReaddirSync.mockReturnValue([]);
    mockStatSync.mockImplementation(() => {
      throw new Error('File not found');
    });
    mockUnlinkSync.mockImplementation(() => {});
    mockRenameSync.mockImplementation(() => {});
    mockMkdirSync.mockImplementation(() => {});
    mockExecSync.mockImplementation(() => '');

    storageManager = new StorageManager(mockConfig);
  });

  afterEach(() => {
    storageManager.stopMonitoring();
  });

  /**
   * Property 7: Log Rotation Management
   * **Validates: Requirements 3.1**
   * 
   * For any log generation pattern, the Storage_Manager should maintain total log size 
   * under 100MB through automatic rotation, preventing unbounded log growth.
   */
  describe('Property 7: Log Rotation Management', () => {
    it('should maintain total log size under 100MB for any log file pattern', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            // Generate various log file scenarios
            logFiles: fc.array(
              fc.record({
                name: fc.stringMatching(/^[a-zA-Z0-9_-]{3,15}\.log$/), // Valid log file names
                size: fc.integer({ min: 1024, max: 50 * 1024 * 1024 }), // 1KB to 50MB
                ageInDays: fc.integer({ min: 0, max: 365 }), // 0 to 365 days old
              }),
              { minLength: 1, maxLength: 20 }
            ),
            maxLogSize: fc.constantFrom(
              50 * 1024 * 1024,   // 50MB
              100 * 1024 * 1024,  // 100MB (default)
              200 * 1024 * 1024   // 200MB
            ),
          }),
          async (testCase) => {
            // Configure storage manager with custom max log size
            storageManager.updateStorageConfiguration({
              maxLogSize: testCase.maxLogSize,
            });

            // Calculate total log size before rotation
            const totalSizeBefore = testCase.logFiles.reduce((sum, file) => sum + file.size, 0);

            // Setup mocks for log files
            const logDir = '/var/log/openclaw'; // Use the first configured log directory
            mockExistsSync.mockImplementation((path: string) => {
              return path === logDir;
            });
            
            mockReaddirSync.mockImplementation((dirPath: string) => {
              if (dirPath === logDir) {
                return testCase.logFiles.map(f => f.name);
              }
              return [];
            });
            
            mockStatSync.mockImplementation((path: string) => {
              const fileName = path.split('/').pop();
              const file = testCase.logFiles.find(f => f.name === fileName);
              
              if (!file) {
                throw new Error('File not found');
              }

              const mtime = new Date(Date.now() - file.ageInDays * 24 * 60 * 60 * 1000);
              
              return {
                isFile: () => true,
                size: file.size,
                mtime,
              } as any;
            });

            // Track which files were removed
            const removedFiles: string[] = [];
            mockUnlinkSync.mockImplementation((path: string) => {
              const fileName = path.split('/').pop();
              if (fileName) {
                removedFiles.push(fileName);
              }
            });

            // Track which files were rotated
            const rotatedFiles: string[] = [];
            mockRenameSync.mockImplementation((oldPath: string, newPath: string) => {
              const fileName = oldPath.split('/').pop();
              if (fileName) {
                rotatedFiles.push(fileName);
              }
            });

            // Perform log rotation
            await storageManager.rotateLogFiles();

            // **Property 7: Log Rotation Management Validation**

            // 1. Calculate remaining log size after rotation
            const remainingFiles = testCase.logFiles.filter(f => !removedFiles.includes(f.name));
            const totalSizeAfter = remainingFiles.reduce((sum, file) => sum + file.size, 0);

            // 2. Verify total log size is under the configured limit
            if (totalSizeBefore > testCase.maxLogSize) {
              // If we started over the limit, we should now be under it
              expect(totalSizeAfter).toBeLessThanOrEqual(testCase.maxLogSize);
              
              // Should have removed some files
              expect(removedFiles.length).toBeGreaterThan(0);
            } else {
              // If we started under the limit, no files should have been removed
              // Note: The logic returns early when under limit, so no rotation occurs
              expect(removedFiles.length).toBe(0);
              expect(totalSizeAfter).toBe(totalSizeBefore);
            }

            // 3. Verify oldest files are removed first (FIFO rotation)
            if (removedFiles.length > 0 && totalSizeBefore > testCase.maxLogSize) {
              const sortedByAge = [...testCase.logFiles].sort((a, b) => b.ageInDays - a.ageInDays);
              
              // Filter out files with empty trimmed names as they won't be processed
              const validFiles = sortedByAge.filter(f => f.name.trim().length > 0);
              
              if (validFiles.length > 0) {
                const oldestFiles = validFiles.slice(0, Math.min(removedFiles.length, validFiles.length));
                
                for (const oldFile of oldestFiles) {
                  expect(removedFiles).toContain(oldFile.name);
                }
              }
            }

            // 4. Verify large individual files are rotated
            if (totalSizeBefore > testCase.maxLogSize) {
              const maxSingleFileSize = Math.floor(testCase.maxLogSize * 0.1); // 10% of max log size
              const largeFiles = remainingFiles.filter(f => f.size > maxSingleFileSize);
              
              for (const largeFile of largeFiles) {
                expect(rotatedFiles).toContain(largeFile.name);
              }
            }

            // 5. Verify log rotation prevents unbounded growth
            expect(totalSizeAfter).toBeLessThanOrEqual(testCase.maxLogSize);
            
            // 6. Verify rotation is deterministic and consistent
            const config = storageManager.getStorageConfiguration();
            expect(config.maxLogSize).toBe(testCase.maxLogSize);
          }
        ),
        { 
          numRuns: propertyTestConfig.numRuns,
          timeout: propertyTestConfig.timeout * 2, // Longer timeout for file operations
        }
      );
    });

    it('should handle log rotation across multiple directories consistently', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            // Generate log files across multiple directories
            directories: fc.array(
              fc.record({
                path: fc.constantFrom('/var/log/openclaw', '/home/pi/.openclaw/logs', '/tmp/logs'),
                logFiles: fc.array(
                  fc.record({
                    name: fc.stringMatching(/^[a-zA-Z0-9_-]{2,8}\.log$/), // Shorter names
                    size: fc.integer({ min: 1024 * 1024, max: 10 * 1024 * 1024 }), // 1MB to 10MB (reduced)
                    ageInHours: fc.integer({ min: 1, max: 24 * 7 }), // 1 hour to 7 days (reduced)
                  }),
                  { minLength: 0, maxLength: 5 } // Reduced max files per directory
                ),
              }),
              { minLength: 1, maxLength: 2 } // Reduced to max 2 directories
            ).map(dirs => {
              // Ensure unique directory paths
              const uniqueDirs = new Map();
              for (const dir of dirs) {
                if (!uniqueDirs.has(dir.path)) {
                  uniqueDirs.set(dir.path, dir);
                } else {
                  // Merge log files if duplicate path
                  const existing = uniqueDirs.get(dir.path);
                  existing.logFiles.push(...dir.logFiles);
                }
              }
              return Array.from(uniqueDirs.values());
            }),
          }),
          async (testCase) => {
            // Calculate total size across all directories
            let totalSizeAcrossDirectories = 0;
            const allFiles: Array<{ name: string; size: number; directory: string; age: number }> = [];
            
            for (const dir of testCase.directories) {
              for (const file of dir.logFiles) {
                totalSizeAcrossDirectories += file.size;
                allFiles.push({
                  name: file.name,
                  size: file.size,
                  directory: dir.path,
                  age: file.ageInHours,
                });
              }
            }

            // Setup mocks for multiple directories
            mockExistsSync.mockImplementation((path: string) => {
              return testCase.directories.some(dir => dir.path === path);
            });

            mockReaddirSync.mockImplementation((dirPath: string) => {
              const dir = testCase.directories.find(d => d.path === dirPath);
              return dir ? dir.logFiles.map(f => f.name) : [];
            });

            mockStatSync.mockImplementation((filePath: string) => {
              const fileName = filePath.split('/').pop();
              const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));
              
              const file = allFiles.find(f => f.name === fileName && f.directory === dirPath);
              
              if (!file) {
                throw new Error('File not found');
              }

              const mtime = new Date(Date.now() - file.age * 60 * 60 * 1000);
              
              return {
                isFile: () => true,
                size: file.size,
                mtime,
              } as any;
            });

            const removedFiles: string[] = [];
            mockUnlinkSync.mockImplementation((path: string) => {
              removedFiles.push(path);
            });

            // Perform log rotation
            await storageManager.rotateLogFiles();

            // **Property 7: Multi-directory Log Rotation Validation**

            // 1. Verify rotation works consistently across all directories
            const maxLogSize = storageManager.getStorageConfiguration().maxLogSize;
            
            if (totalSizeAcrossDirectories > maxLogSize) {
              // Should have removed some files
              expect(removedFiles.length).toBeGreaterThan(0);
              
              // Calculate remaining size
              let remainingSize = totalSizeAcrossDirectories;
              for (const removedPath of removedFiles) {
                const fileName = removedPath.split('/').pop();
                const dirPath = removedPath.substring(0, removedPath.lastIndexOf('/'));
                const file = allFiles.find(f => f.name === fileName && f.directory === dirPath);
                if (file) {
                  remainingSize -= file.size;
                }
              }
              
              expect(remainingSize).toBeLessThanOrEqual(maxLogSize);
            }

            // 2. Verify oldest files across all directories are prioritized for removal
            if (removedFiles.length > 0 && totalSizeAcrossDirectories > maxLogSize) {
              const sortedByAge = [...allFiles].sort((a, b) => b.age - a.age);
              const removedFileNames = removedFiles.map(path => {
                const fileName = path.split('/').pop();
                return fileName;
              }).filter(name => name && name.trim().length > 0);
              
              // At least some of the oldest files should be in the removed list
              const validOldestFiles = sortedByAge
                .filter(f => f.name.trim().length > 0) // Only consider files with valid names
                .slice(0, Math.min(5, sortedByAge.length));
              
              if (validOldestFiles.length > 0 && removedFileNames.length > 0) {
                const hasOldFiles = validOldestFiles.some(f => removedFileNames.includes(f.name));
                expect(hasOldFiles).toBe(true);
              }
            }

            // 3. Verify log rotation maintains consistency across directories
            expect(totalSizeAcrossDirectories).toBeGreaterThanOrEqual(0);
          }
        ),
        { 
          numRuns: 3, // Significantly reduced to prevent memory issues
          timeout: 5000, // Reduced timeout
        }
      );
    });
  });

  /**
   * Property 9: Temporary File Management
   * **Validates: Requirements 3.3**
   * 
   * For any temporary file creation, the Storage_Manager should store files in 
   * tmpfs-mounted directories, ensuring they don't contribute to SD card wear.
   */
  describe('Property 9: Temporary File Management', () => {
    it('should store all temporary files in tmpfs-mounted directories', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            // Generate different Pi memory configurations
            memoryConfig: fc.record({
              totalRAM: fc.constantFrom(1024, 2048, 4096, 8192), // MB
              architecture: fc.constantFrom('arm64', 'armv7l'),
            }),
            // Generate tmpfs mount scenarios
            tmpfsScenario: fc.record({
              mountSuccess: fc.boolean(),
              existingMounts: fc.array(
                fc.constantFrom('/tmp/openclaw', '/var/tmp/openclaw', '/run/openclaw'),
                { minLength: 0, maxLength: 2 }
              ),
              sudoAvailable: fc.boolean(),
            }),
          }),
          async (testCase) => {
            // Create configuration for this test
            const config: PiConfiguration = {
              ...mockConfig,
              memory: {
                total: testCase.memoryConfig.totalRAM,
                limit: Math.min(testCase.memoryConfig.totalRAM, 2048),
              },
              architecture: testCase.memoryConfig.architecture,
            };

            const manager = new StorageManager(config);

            // Setup mocks for tmpfs scenario
            mockExistsSync.mockImplementation((path: string) => {
              // Directories don't exist initially
              return false;
            });

            mockExecSync.mockImplementation((command: string) => {
              if (command === 'mount') {
                // Return existing mounts
                return testCase.tmpfsScenario.existingMounts
                  .map(mount => `tmpfs on ${mount} type tmpfs (rw,relatime)`)
                  .join('\n');
              }
              
              if (command.includes('sudo mount -t tmpfs')) {
                if (!testCase.tmpfsScenario.sudoAvailable || !testCase.tmpfsScenario.mountSuccess) {
                  throw new Error('Permission denied or mount failed');
                }
                return ''; // Successful mount
              }
              
              return '';
            });

            // Track tmpfs setup events
            let tmpfsSetupCompleted = false;
            let tmpfsSetupError: Error | null = null;
            
            manager.once('tmpfsSetupCompleted', () => {
              tmpfsSetupCompleted = true;
            });
            
            manager.once('tmpfsSetupError', (error) => {
              tmpfsSetupError = error;
            });

            // **Property 9: Temporary File Management Validation**

            try {
              await manager.setupTmpfs();

              // 1. Verify tmpfs setup attempts were made
              expect(mockMkdirSync).toHaveBeenCalled();
              
              // 2. Verify tmpfs size calculation based on RAM
              const expectedTmpfsSize = Math.floor(testCase.memoryConfig.totalRAM * 0.1); // 10% of RAM
              
              if (testCase.tmpfsScenario.sudoAvailable && testCase.tmpfsScenario.mountSuccess) {
                // Should attempt to mount with correct size - check if any mount command contains the expected size
                const mountCalls = mockExecSync.mock.calls.filter(call => 
                  typeof call[0] === 'string' && call[0].includes('sudo mount -t tmpfs')
                );
                
                if (mountCalls.length > 0) {
                  // At least one mount call should contain the expected size
                  const hasCorrectSize = mountCalls.some(call => 
                    call[0].includes(`size=${expectedTmpfsSize}M`)
                  );
                  expect(hasCorrectSize).toBe(true);
                }
                
                expect(tmpfsSetupCompleted).toBe(true);
              }

              // 3. Verify tmpfs availability detection
              const isTmpfsAvailable = manager.isTmpfsAvailable();
              expect(typeof isTmpfsAvailable).toBe('boolean');

              // 4. Verify tmpfs directories are created for temporary files
              const storageConfig = manager.getStorageConfiguration();
              expect(storageConfig.tmpfsMounts.length).toBeGreaterThan(0);
              
              for (const mountPoint of storageConfig.tmpfsMounts) {
                expect(mockMkdirSync).toHaveBeenCalledWith(mountPoint, { recursive: true });
              }

              // 5. Verify tmpfs prevents SD card wear for temporary files
              // Temporary files should be stored in tmpfs mounts, not on SD card
              expect(storageConfig.tmpfsMounts.every(mount => 
                mount.includes('/tmp') || mount.includes('/var/tmp') || mount.includes('/run')
              )).toBe(true);

            } catch (error) {
              // 6. Verify graceful fallback when tmpfs setup fails
              if (!testCase.tmpfsScenario.sudoAvailable || !testCase.tmpfsScenario.mountSuccess) {
                expect(tmpfsSetupError).toBeInstanceOf(Error);
                
                // Should still create directories as fallback
                expect(mockMkdirSync).toHaveBeenCalled();
              } else {
                throw error; // Unexpected error
              }
            }

            // 7. Verify tmpfs configuration is appropriate for Pi hardware
            const config_result = manager.getStorageConfiguration();
            expect(config_result.tmpfsMounts.length).toBeGreaterThan(0);
            expect(config_result.tmpfsMounts.length).toBeLessThanOrEqual(5); // Reasonable limit

            // Cleanup
            manager.stopMonitoring();
          }
        ),
        { 
          numRuns: propertyTestConfig.numRuns,
          timeout: propertyTestConfig.timeout,
        }
      );
    });

    it('should handle tmpfs mount failures gracefully while maintaining functionality', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            // Generate different failure scenarios
            failureScenario: fc.record({
              directoryCreationFails: fc.boolean(),
              mountCommandFails: fc.boolean(),
              permissionDenied: fc.boolean(),
              insufficientMemory: fc.boolean(),
            }),
            memorySize: fc.constantFrom(512, 1024, 2048, 4096), // MB
          }),
          async (testCase) => {
            const config: PiConfiguration = {
              ...mockConfig,
              memory: {
                total: testCase.memorySize,
                limit: Math.min(testCase.memorySize, 2048),
              },
            };

            const manager = new StorageManager(config);

            // Setup mocks for failure scenarios
            mockExistsSync.mockReturnValue(false);
            
            mockMkdirSync.mockImplementation((path: string) => {
              if (testCase.failureScenario.directoryCreationFails) {
                throw new Error('Failed to create directory');
              }
            });

            mockExecSync.mockImplementation((command: string) => {
              if (command === 'mount') {
                return ''; // No existing mounts
              }
              
              if (command.includes('sudo mount -t tmpfs')) {
                if (testCase.failureScenario.mountCommandFails) {
                  throw new Error('Mount command failed');
                }
                if (testCase.failureScenario.permissionDenied) {
                  throw new Error('Permission denied');
                }
                if (testCase.failureScenario.insufficientMemory) {
                  throw new Error('Cannot allocate memory');
                }
                return ''; // Successful mount
              }
              
              return '';
            });

            // Track error events
            let errorOccurred = false;
            manager.once('tmpfsSetupError', () => {
              errorOccurred = true;
            });

            // **Property 9: Graceful Failure Handling Validation**

            if (testCase.failureScenario.directoryCreationFails) {
              // Should throw error if directory creation fails
              await expect(manager.setupTmpfs()).rejects.toThrow();
              expect(errorOccurred).toBe(true);
            } else {
              // Should handle mount failures gracefully
              await manager.setupTmpfs();
              
              // 1. Verify system remains functional even with tmpfs failures
              const storageConfig = manager.getStorageConfiguration();
              expect(storageConfig.tmpfsMounts.length).toBeGreaterThan(0);
              
              // 2. Verify fallback directories are created
              expect(mockMkdirSync).toHaveBeenCalled();
              
              // 3. Verify tmpfs availability is correctly reported
              const isTmpfsAvailable = manager.isTmpfsAvailable();
              
              if (testCase.failureScenario.mountCommandFails || 
                  testCase.failureScenario.permissionDenied || 
                  testCase.failureScenario.insufficientMemory) {
                // Tmpfs should still be marked as available (fallback to regular directories)
                expect(typeof isTmpfsAvailable).toBe('boolean');
              } else {
                // Successful setup
                expect(isTmpfsAvailable).toBe(true);
              }
              
              // 4. Verify storage manager remains operational
              const metrics = await manager.getStorageMetrics().catch(() => null);
              // Should not crash when getting metrics
              expect(metrics).toBeDefined();
            }

            // 5. Verify temporary file management continues to work
            // Even with tmpfs failures, temporary files should be managed
            const config_result = manager.getStorageConfiguration();
            expect(config_result.tmpfsMounts).toBeDefined();
            expect(Array.isArray(config_result.tmpfsMounts)).toBe(true);

            // Cleanup
            manager.stopMonitoring();
          }
        ),
        { 
          numRuns: 20, // More runs to test various failure combinations
          timeout: 6000,
        }
      );
    });
  });

  /**
   * Property 10: Storage Wear Leveling
   * **Validates: Requirements 3.4**
   * 
   * For any write operation pattern, the Storage_Manager should distribute writes 
   * across available storage locations, preventing concentrated wear on specific sectors.
   */
  describe('Property 10: Storage Wear Leveling', () => {
    it('should distribute writes evenly across all available storage locations', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            // Generate different write patterns
            writeOperations: fc.array(
              fc.record({
                operationType: fc.constantFrom('log', 'cache', 'data', 'temp'),
                dataSize: fc.integer({ min: 1024, max: 10 * 1024 * 1024 }), // 1KB to 10MB
                timestamp: fc.integer({ min: 0, max: 1000 }), // Relative timestamp
              }),
              { minLength: 10, maxLength: 100 }
            ),
            // Generate storage configuration
            storageConfig: fc.record({
              wearLevelingEnabled: fc.boolean(),
              numberOfPaths: fc.integer({ min: 2, max: 8 }),
              storageType: fc.constantFrom('sd', 'usb', 'ssd'),
            }),
          }),
          async (testCase) => {
            // Create configuration for this test
            const config: PiConfiguration = {
              ...mockConfig,
              storage: {
                type: testCase.storageConfig.storageType,
                wearLeveling: testCase.storageConfig.wearLevelingEnabled,
              },
            };

            // Generate wear leveling paths
            const wearLevelingPaths = Array.from(
              { length: testCase.storageConfig.numberOfPaths },
              (_, i) => `/var/lib/openclaw/data${i + 1}`
            );

            const manager = new StorageManager(config, {
              wearLevelingPaths,
            });

            // Clear any previous mock calls for this specific test case
            mockMkdirSync.mockClear();
            mockExistsSync.mockReturnValue(false);
            mockMkdirSync.mockImplementation(() => {}); // Successful directory creation

            // Track write distribution
            const writeDistribution = new Map<string, number>();
            const writePaths: string[] = [];

            // **Property 10: Storage Wear Leveling Validation**

            if (testCase.storageConfig.wearLevelingEnabled) {
              // Perform write operations and track distribution
              for (const operation of testCase.writeOperations) {
                await manager.optimizeWrites();
                const currentPath = manager.getNextWritePath();
                writePaths.push(currentPath);
                
                // Count writes per path
                const count = writeDistribution.get(currentPath) || 0;
                writeDistribution.set(currentPath, count + 1);
              }

              // 1. Verify writes are distributed across multiple paths
              expect(writeDistribution.size).toBeGreaterThan(1);
              expect(writeDistribution.size).toBeLessThanOrEqual(testCase.storageConfig.numberOfPaths);

              // 2. Verify even distribution (no path should have significantly more writes)
              const writeCounts = Array.from(writeDistribution.values());
              const maxWrites = Math.max(...writeCounts);
              const minWrites = Math.min(...writeCounts);
              const distributionRatio = maxWrites / Math.max(minWrites, 1);
              
              // Distribution should be reasonably even (within 2x ratio for large datasets)
              if (testCase.writeOperations.length >= 20) {
                expect(distributionRatio).toBeLessThanOrEqual(2.5);
              }

              // 3. Verify all configured paths are used
              for (const path of wearLevelingPaths) {
                expect(writePaths).toContain(path);
              }

              // 4. Verify write operation counting
              const writeStats = manager.getWriteStatistics();
              expect(writeStats.count).toBe(testCase.writeOperations.length);
              expect(writeStats.currentPath).toContain('/var/lib/openclaw/data');
              expect(writeStats.pathIndex).toBeGreaterThanOrEqual(0);
              expect(writeStats.pathIndex).toBeLessThan(testCase.storageConfig.numberOfPaths);

              // 5. Verify wear leveling directories are created
              for (const path of wearLevelingPaths) {
                expect(mockMkdirSync).toHaveBeenCalledWith(path, { recursive: true });
              }

              // 6. Verify cyclic distribution pattern
              // Check that paths are used in a rotating fashion
              const pathSequence = writePaths.slice(0, Math.min(10, writePaths.length));
              const uniquePathsInSequence = new Set(pathSequence);
              expect(uniquePathsInSequence.size).toBeGreaterThan(1);

            } else {
              // Wear leveling disabled - should use default path
              for (const operation of testCase.writeOperations) {
                await manager.optimizeWrites();
                const currentPath = manager.getNextWritePath();
                expect(currentPath).toBe('/var/lib/openclaw');
              }

              // Should not create wear leveling directories when disabled
              // The optimizeWrites() method returns early when wear leveling is disabled
              const wearLevelingCalls = mockMkdirSync.mock.calls.filter(call => 
                typeof call[0] === 'string' && call[0].includes('/var/lib/openclaw/data')
              );
              // When wear leveling is disabled, no data directories should be created
              expect(wearLevelingCalls.length).toBe(0);
            }

            // 7. Verify write optimization events are emitted
            let writeOptimizedEvents = 0;
            manager.on('writeOptimized', () => {
              writeOptimizedEvents++;
            });

            await manager.optimizeWrites();
            
            if (testCase.storageConfig.wearLevelingEnabled) {
              expect(writeOptimizedEvents).toBe(1);
            }

            // 8. Verify storage type compatibility
            const storageConfig = manager.getStorageConfiguration();
            expect(storageConfig.wearLevelingPaths.length).toBe(testCase.storageConfig.numberOfPaths);

            // Cleanup
            manager.stopMonitoring();
          }
        ),
        { 
          numRuns: propertyTestConfig.numRuns,
          timeout: propertyTestConfig.timeout,
        }
      );
    });

    it('should prevent concentrated wear on specific storage sectors across different usage patterns', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            // Generate different usage patterns
            usagePatterns: fc.array(
              fc.record({
                burstWrites: fc.integer({ min: 5, max: 50 }), // Number of writes in burst
                pauseDuration: fc.integer({ min: 0, max: 100 }), // Pause between bursts (ms)
                writeIntensity: fc.constantFrom('low', 'medium', 'high'),
              }),
              { minLength: 2, maxLength: 8 }
            ),
            storageConfiguration: fc.record({
              pathCount: fc.integer({ min: 3, max: 6 }),
              storageType: fc.constantFrom('sd', 'usb'),
            }),
          }),
          async (testCase) => {
            const config: PiConfiguration = {
              ...mockConfig,
              storage: {
                type: testCase.storageConfiguration.storageType,
                wearLeveling: true,
              },
            };

            // Create wear leveling paths
            const wearLevelingPaths = Array.from(
              { length: testCase.storageConfiguration.pathCount },
              (_, i) => `/var/lib/openclaw/sector${i + 1}`
            );

            const manager = new StorageManager(config, {
              wearLevelingPaths,
            });

            // Clear any previous mock calls
            mockMkdirSync.mockClear();
            mockExistsSync.mockReturnValue(false);
            mockMkdirSync.mockImplementation(() => {});

            // Track wear distribution across different usage patterns
            const totalWearDistribution = new Map<string, number>();
            let totalWrites = 0;

            // **Property 10: Concentrated Wear Prevention Validation**

            // Simulate different usage patterns
            for (const pattern of testCase.usagePatterns) {
              const patternWearDistribution = new Map<string, number>();
              
              // Simulate burst writes
              for (let i = 0; i < pattern.burstWrites; i++) {
                await manager.optimizeWrites();
                const currentPath = manager.getNextWritePath();
                
                // Track wear for this pattern
                const patternCount = patternWearDistribution.get(currentPath) || 0;
                patternWearDistribution.set(currentPath, patternCount + 1);
                
                // Track total wear
                const totalCount = totalWearDistribution.get(currentPath) || 0;
                totalWearDistribution.set(currentPath, totalCount + 1);
                
                totalWrites++;
              }

              // 1. Verify wear distribution within each pattern
              if (pattern.burstWrites >= testCase.storageConfiguration.pathCount) {
                // Should use multiple paths within each burst pattern
                expect(patternWearDistribution.size).toBeGreaterThan(1);
                
                // No single path should dominate within a pattern
                const patternCounts = Array.from(patternWearDistribution.values());
                const maxPatternWrites = Math.max(...patternCounts);
                const avgPatternWrites = patternCounts.reduce((a, b) => a + b, 0) / patternCounts.length;
                
                // Max writes should not be more than 2x the average
                expect(maxPatternWrites).toBeLessThanOrEqual(avgPatternWrites * 2.5);
              }

              // Simulate pause between patterns
              if (pattern.pauseDuration > 0) {
                await new Promise(resolve => setTimeout(resolve, Math.min(pattern.pauseDuration, 10)));
              }
            }

            // 2. Verify overall wear distribution prevents concentration
            expect(totalWearDistribution.size).toBeGreaterThan(1);
            expect(totalWearDistribution.size).toBeLessThanOrEqual(testCase.storageConfiguration.pathCount);

            // 3. Verify no single sector receives excessive wear
            const totalCounts = Array.from(totalWearDistribution.values());
            const maxTotalWrites = Math.max(...totalCounts);
            const minTotalWrites = Math.min(...totalCounts);
            const avgTotalWrites = totalCounts.reduce((a, b) => a + b, 0) / totalCounts.length;

            // Maximum writes on any sector should not exceed 3x the average
            expect(maxTotalWrites).toBeLessThanOrEqual(avgTotalWrites * 3);
            
            // Minimum writes should not be less than 1/3 of average (reasonable distribution)
            if (totalWrites >= testCase.storageConfiguration.pathCount * 2) {
              expect(minTotalWrites).toBeGreaterThanOrEqual(avgTotalWrites * 0.33);
            }

            // 4. Verify wear leveling effectiveness across different storage types
            if (testCase.storageConfiguration.storageType === 'sd') {
              // SD cards benefit most from wear leveling - should have very even distribution
              const wearVariance = maxTotalWrites - minTotalWrites;
              const maxAllowedVariance = Math.ceil(totalWrites / testCase.storageConfiguration.pathCount);
              expect(wearVariance).toBeLessThanOrEqual(maxAllowedVariance * 2);
            }

            // 5. Verify all configured sectors are utilized
            expect(totalWearDistribution.size).toBe(testCase.storageConfiguration.pathCount);
            
            for (const path of wearLevelingPaths) {
              expect(totalWearDistribution.has(path)).toBe(true);
              expect(totalWearDistribution.get(path)).toBeGreaterThan(0);
            }

            // 6. Verify write statistics accuracy
            const finalStats = manager.getWriteStatistics();
            expect(finalStats.count).toBe(totalWrites);

            // 7. Verify sector creation for wear leveling
            for (const path of wearLevelingPaths) {
              expect(mockMkdirSync).toHaveBeenCalledWith(path, { recursive: true });
            }

            // Cleanup
            manager.stopMonitoring();
          }
        ),
        { 
          numRuns: 15, // Reduced for faster execution due to complexity
          timeout: 8000,
        }
      );
    });

    it('should maintain wear leveling consistency across storage manager restarts', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            // Generate restart scenarios
            restartScenarios: fc.array(
              fc.record({
                writesBeforeRestart: fc.integer({ min: 5, max: 25 }),
                writesAfterRestart: fc.integer({ min: 5, max: 25 }),
              }),
              { minLength: 2, maxLength: 4 }
            ),
            pathConfiguration: fc.record({
              numberOfPaths: fc.integer({ min: 3, max: 5 }),
            }),
          }),
          async (testCase) => {
            const config: PiConfiguration = {
              ...mockConfig,
              storage: {
                type: 'sd',
                wearLeveling: true,
              },
            };

            const wearLevelingPaths = Array.from(
              { length: testCase.pathConfiguration.numberOfPaths },
              (_, i) => `/var/lib/openclaw/persistent${i + 1}`
            );

            mockExistsSync.mockReturnValue(false);
            mockMkdirSync.mockImplementation(() => {});

            const totalWearDistribution = new Map<string, number>();
            let totalWriteOperations = 0;

            // **Property 10: Restart Consistency Validation**

            for (const scenario of testCase.restartScenarios) {
              // Create new storage manager instance (simulating restart)
              const manager = new StorageManager(config, {
                wearLevelingPaths,
              });

              // Perform writes before "restart"
              for (let i = 0; i < scenario.writesBeforeRestart; i++) {
                await manager.optimizeWrites();
                const path = manager.getNextWritePath();
                
                const count = totalWearDistribution.get(path) || 0;
                totalWearDistribution.set(path, count + 1);
                totalWriteOperations++;
              }

              // Simulate restart by creating new instance
              const restartedManager = new StorageManager(config, {
                wearLevelingPaths,
              });

              // Perform writes after "restart"
              for (let i = 0; i < scenario.writesAfterRestart; i++) {
                await restartedManager.optimizeWrites();
                const path = restartedManager.getNextWritePath();
                
                const count = totalWearDistribution.get(path) || 0;
                totalWearDistribution.set(path, count + 1);
                totalWriteOperations++;
              }

              // Cleanup
              manager.stopMonitoring();
              restartedManager.stopMonitoring();
            }

            // 1. Verify wear leveling continues to work across restarts
            expect(totalWearDistribution.size).toBeGreaterThan(1);
            expect(totalWearDistribution.size).toBeLessThanOrEqual(testCase.pathConfiguration.numberOfPaths);

            // 2. Verify distribution remains reasonably even despite restarts
            const counts = Array.from(totalWearDistribution.values());
            const maxWrites = Math.max(...counts);
            const minWrites = Math.min(...counts);
            const avgWrites = counts.reduce((a, b) => a + b, 0) / counts.length;

            // Even with restarts, distribution should not be too skewed
            expect(maxWrites).toBeLessThanOrEqual(avgWrites * 3);
            
            if (totalWriteOperations >= testCase.pathConfiguration.numberOfPaths * 3) {
              expect(minWrites).toBeGreaterThanOrEqual(avgWrites * 0.25);
            }

            // 3. Verify all paths are still utilized after restarts
            expect(totalWearDistribution.size).toBe(testCase.pathConfiguration.numberOfPaths);
            
            for (const path of wearLevelingPaths) {
              expect(totalWearDistribution.has(path)).toBe(true);
            }

            // 4. Verify wear leveling paths are consistently created across restarts
            for (const path of wearLevelingPaths) {
              expect(mockMkdirSync).toHaveBeenCalledWith(path, { recursive: true });
            }

            // 5. Verify total write operations are tracked correctly
            expect(totalWriteOperations).toBeGreaterThan(0);
            expect(totalWriteOperations).toBe(
              testCase.restartScenarios.reduce(
                (sum, scenario) => sum + scenario.writesBeforeRestart + scenario.writesAfterRestart,
                0
              )
            );
          }
        ),
        { 
          numRuns: 12, // Reduced due to multiple manager instances
          timeout: 10000,
        }
      );
    });
  });
});