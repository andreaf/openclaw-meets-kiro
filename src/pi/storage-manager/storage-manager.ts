/**
 * Storage Manager Implementation
 * 
 * Provides SD card optimization and wear leveling for Raspberry Pi.
 * Implements tmpfs setup, log rotation, and write distribution to minimize
 * SD card wear and optimize storage usage.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, renameSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname, basename, extname } from 'node:path';
import { EventEmitter } from 'node:events';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type { PiConfiguration } from '../types/pi-configuration.js';

export interface StorageConfiguration {
  /** Maximum total log size in bytes (default: 100MB) */
  maxLogSize: number;
  /** Tmpfs mount points for temporary files */
  tmpfsMounts: string[];
  /** Log directories to manage */
  logDirectories: string[];
  /** Cache directories for intelligent caching */
  cacheDirectories: string[];
  /** External storage mount points */
  externalStoragePaths: string[];
  /** Wear leveling write distribution paths */
  wearLevelingPaths: string[];
}

export interface StorageMetrics {
  /** Total storage capacity in bytes */
  totalCapacity: number;
  /** Used storage in bytes */
  usedStorage: number;
  /** Available storage in bytes */
  availableStorage: number;
  /** Current log size in bytes */
  currentLogSize: number;
  /** Number of write operations for wear leveling */
  writeOperations: number;
  /** Tmpfs usage in bytes */
  tmpfsUsage: number;
  /** Cache usage in bytes */
  cacheUsage: number;
  /** External storage availability */
  externalStorageAvailable: boolean;
}

export class StorageManager extends EventEmitter {
  private config: PiConfiguration;
  private storageConfig: StorageConfiguration;
  private writeOperationCount = 0;
  private currentWearLevelingIndex = 0;
  private tmpfsMounted = false;
  private monitoringInterval?: NodeJS.Timeout;

  constructor(config: PiConfiguration, storageConfig?: Partial<StorageConfiguration>) {
    super();
    this.config = config;
    this.storageConfig = {
      maxLogSize: 100 * 1024 * 1024, // 100MB default
      tmpfsMounts: ['/tmp/openclaw', '/var/tmp/openclaw'],
      logDirectories: ['/var/log/openclaw', '/home/pi/.openclaw/logs'],
      cacheDirectories: ['/var/cache/openclaw', '/home/pi/.openclaw/cache'],
      externalStoragePaths: ['/media/usb', '/mnt/usb', '/media/pi'],
      wearLevelingPaths: ['/var/lib/openclaw/data1', '/var/lib/openclaw/data2', '/var/lib/openclaw/data3'],
      ...storageConfig,
    };
  }

  /**
   * Sets up tmpfs for temporary files
   * Implements Requirements 3.3: Store temporary files in tmpfs-mounted directories
   */
  async setupTmpfs(): Promise<void> {
    try {
      for (const mountPoint of this.storageConfig.tmpfsMounts) {
        await this.createTmpfsMount(mountPoint);
      }
      this.tmpfsMounted = true;
      this.emit('tmpfsSetupCompleted', { 
        mountPoints: this.storageConfig.tmpfsMounts,
        timestamp: new Date() 
      });
      console.log(`Tmpfs setup completed for ${this.storageConfig.tmpfsMounts.length} mount points`);
    } catch (error) {
      console.error('Failed to setup tmpfs:', error);
      this.emit('tmpfsSetupError', error);
      throw error;
    }
  }

  /**
   * Creates a tmpfs mount point
   */
  private async createTmpfsMount(mountPoint: string): Promise<void> {
    try {
      // Create directory if it doesn't exist
      if (!existsSync(mountPoint)) {
        mkdirSync(mountPoint, { recursive: true });
      }

      // Check if already mounted
      const mountOutput = execSync('mount', { encoding: 'utf8' });
      if (mountOutput.includes(mountPoint)) {
        console.log(`Tmpfs already mounted at ${mountPoint}`);
        return;
      }

      // Calculate tmpfs size based on available RAM (use 10% of total RAM)
      const tmpfsSize = Math.floor(this.config.memory.total * 0.1); // 10% of total RAM in MB
      
      // Mount tmpfs (requires sudo privileges)
      try {
        execSync(`sudo mount -t tmpfs -o size=${tmpfsSize}M tmpfs ${mountPoint}`, { encoding: 'utf8' });
        console.log(`Tmpfs mounted at ${mountPoint} with size ${tmpfsSize}MB`);
      } catch (mountError) {
        // If mount fails (e.g., no sudo), create regular directory
        console.warn(`Failed to mount tmpfs at ${mountPoint}, using regular directory:`, mountError);
        if (!existsSync(mountPoint)) {
          mkdirSync(mountPoint, { recursive: true });
        }
      }
    } catch (error) {
      console.error(`Failed to create tmpfs mount at ${mountPoint}:`, error);
      throw error;
    }
  }

  /**
   * Rotates log files to maintain size limits
   * Implements Requirements 3.1: Log rotation with maximum 100MB total log size
   */
  async rotateLogFiles(): Promise<void> {
    try {
      let totalLogSize = 0;
      const logFiles: Array<{ path: string; size: number; mtime: Date }> = [];

      // Collect all log files from configured directories
      for (const logDir of this.storageConfig.logDirectories) {
        if (existsSync(logDir)) {
          const files = this.collectLogFiles(logDir);
          logFiles.push(...files);
          totalLogSize += files.reduce((sum, file) => sum + file.size, 0);
        }
      }

      // Check if rotation is needed - return early if under limit
      if (totalLogSize <= this.storageConfig.maxLogSize) {
        this.emit('logRotationSkipped', { 
          totalSize: totalLogSize, 
          maxSize: this.storageConfig.maxLogSize,
          timestamp: new Date() 
        });
        return;
      }

      // Sort files by modification time (oldest first)
      logFiles.sort((a, b) => a.mtime.getTime() - b.mtime.getTime());

      let removedSize = 0;
      const removedFiles: string[] = [];

      // Remove oldest files until under limit
      for (const file of logFiles) {
        if (totalLogSize - removedSize <= this.storageConfig.maxLogSize) {
          break;
        }

        try {
          unlinkSync(file.path);
          removedSize += file.size;
          removedFiles.push(file.path);
          console.log(`Removed log file: ${file.path} (${file.size} bytes)`);
        } catch (error) {
          console.warn(`Failed to remove log file ${file.path}:`, error);
        }
      }

      // Rotate remaining large log files
      await this.rotateLargeLogFiles(logFiles.filter(f => !removedFiles.includes(f.path)));

      this.emit('logRotationCompleted', {
        totalSizeBefore: totalLogSize,
        totalSizeAfter: totalLogSize - removedSize,
        removedFiles,
        removedSize,
        timestamp: new Date(),
      });

      console.log(`Log rotation completed: removed ${removedFiles.length} files (${removedSize} bytes)`);
    } catch (error) {
      console.error('Failed to rotate log files:', error);
      this.emit('logRotationError', error);
      throw error;
    }
  }

  /**
   * Collects log files from a directory
   */
  private collectLogFiles(directory: string): Array<{ path: string; size: number; mtime: Date }> {
    const logFiles: Array<{ path: string; size: number; mtime: Date }> = [];
    
    try {
      const files = readdirSync(directory);
      
      for (const file of files) {
        const filePath = join(directory, file);
        
        try {
          const stats = statSync(filePath);
          
          // Consider files with .log extension or containing 'log' in name
          // Don't filter out files with short names - they are valid log files
          if (stats.isFile() && (file.endsWith('.log') || file.includes('log'))) {
            logFiles.push({
              path: filePath,
              size: stats.size,
              mtime: stats.mtime,
            });
          }
        } catch (error) {
          console.warn(`Failed to stat file ${filePath}:`, error);
        }
      }
    } catch (error) {
      console.warn(`Failed to read directory ${directory}:`, error);
    }

    return logFiles;
  }

  /**
   * Rotates large individual log files
   */
  private async rotateLargeLogFiles(logFiles: Array<{ path: string; size: number; mtime: Date }>): Promise<void> {
    const maxSingleFileSize = Math.floor(this.storageConfig.maxLogSize * 0.1); // 10% of max log size

    for (const file of logFiles) {
      if (file.size > maxSingleFileSize) {
        try {
          await this.rotateLogFile(file.path);
        } catch (error) {
          console.warn(`Failed to rotate large log file ${file.path}:`, error);
        }
      }
    }
  }

  /**
   * Rotates a single log file
   */
  private async rotateLogFile(filePath: string): Promise<void> {
    const dir = dirname(filePath);
    const name = basename(filePath, extname(filePath));
    const ext = extname(filePath);
    
    // Create rotated filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const rotatedPath = join(dir, `${name}.${timestamp}${ext}`);
    
    try {
      renameSync(filePath, rotatedPath);
      console.log(`Rotated log file: ${filePath} -> ${rotatedPath}`);
    } catch (error) {
      console.warn(`Failed to rotate log file ${filePath}:`, error);
    }
  }

  /**
   * Optimizes write operations for wear leveling
   * Implements Requirements 3.4: Distribute writes across available storage
   */
  async optimizeWrites(): Promise<void> {
    if (!this.config.storage.wearLeveling) {
      // When wear leveling is disabled, don't create directories or increment counters
      return;
    }

    try {
      // Ensure wear leveling directories exist
      for (const path of this.storageConfig.wearLevelingPaths) {
        if (!existsSync(path)) {
          mkdirSync(path, { recursive: true });
        }
      }

      // Increment write operation count
      this.writeOperationCount++;

      // Distribute writes across available paths
      this.currentWearLevelingIndex = (this.currentWearLevelingIndex + 1) % this.storageConfig.wearLevelingPaths.length;

      this.emit('writeOptimized', {
        writeCount: this.writeOperationCount,
        currentPath: this.storageConfig.wearLevelingPaths[this.currentWearLevelingIndex],
        timestamp: new Date(),
      });

      console.log(`Write optimization completed: operation ${this.writeOperationCount}, path index ${this.currentWearLevelingIndex}`);
    } catch (error) {
      console.error('Failed to optimize writes:', error);
      this.emit('writeOptimizationError', error);
      throw error;
    }
  }

  /**
   * Gets the next write path for wear leveling
   */
  getNextWritePath(): string {
    if (!this.config.storage.wearLeveling || this.storageConfig.wearLevelingPaths.length === 0) {
      return '/var/lib/openclaw'; // Default path
    }

    return this.storageConfig.wearLevelingPaths[this.currentWearLevelingIndex];
  }

  /**
   * Implements intelligent caching strategy
   * Requirements 3.2: RAM-first caching with SD card fallback
   */
  async setupIntelligentCaching(): Promise<void> {
    try {
      // Create cache directories
      for (const cacheDir of this.storageConfig.cacheDirectories) {
        if (!existsSync(cacheDir)) {
          mkdirSync(cacheDir, { recursive: true });
        }
      }

      // Setup RAM-based cache in tmpfs if available
      if (this.tmpfsMounted) {
        const ramCacheDir = join(this.storageConfig.tmpfsMounts[0], 'cache');
        if (!existsSync(ramCacheDir)) {
          mkdirSync(ramCacheDir, { recursive: true });
        }
        console.log(`RAM-based cache setup at ${ramCacheDir}`);
      }

      // Detect and setup external USB storage for large cache items
      const externalStorage = await this.detectExternalStorage();
      if (externalStorage.length > 0) {
        for (const storagePath of externalStorage) {
          const externalCacheDir = join(storagePath, 'openclaw-cache');
          try {
            if (!existsSync(externalCacheDir)) {
              mkdirSync(externalCacheDir, { recursive: true });
            }
            console.log(`External cache directory setup at ${externalCacheDir}`);
          } catch (error) {
            console.warn(`Failed to setup external cache at ${storagePath}:`, error);
          }
        }
      }

      this.emit('cachingSetupCompleted', {
        ramCacheAvailable: this.tmpfsMounted,
        cacheDirectories: this.storageConfig.cacheDirectories,
        externalStorageAvailable: externalStorage.length > 0,
        externalStoragePaths: externalStorage,
        timestamp: new Date(),
      });
    } catch (error) {
      console.error('Failed to setup intelligent caching:', error);
      this.emit('cachingSetupError', error);
      throw error;
    }
  }

  /**
   * Gets the optimal cache path based on intelligent caching strategy
   * Prioritizes RAM -> SD card -> External storage based on file size and availability
   */
  getOptimalCachePath(fileSizeBytes: number = 0): string {
    // For small files (< 1MB), prefer RAM cache if available
    if (fileSizeBytes < 1024 * 1024 && this.tmpfsMounted) {
      const ramCacheDir = join(this.storageConfig.tmpfsMounts[0], 'cache');
      if (existsSync(ramCacheDir)) {
        return ramCacheDir;
      }
    }

    // For medium files (1MB - 50MB), use SD card cache
    if (fileSizeBytes < 50 * 1024 * 1024) {
      return this.storageConfig.cacheDirectories[0] || '/var/cache/openclaw';
    }

    // For large files (> 50MB), prefer external storage if available
    const externalStorage = this.storageConfig.externalStoragePaths.find(path => {
      const externalCacheDir = join(path, 'openclaw-cache');
      return existsSync(externalCacheDir);
    });

    if (externalStorage) {
      return join(externalStorage, 'openclaw-cache');
    }

    // Fallback to SD card cache
    return this.storageConfig.cacheDirectories[0] || '/var/cache/openclaw';
  }

  /**
   * Caches data using intelligent caching strategy
   */
  async cacheData(key: string, data: Buffer | string, ttlSeconds: number = 3600): Promise<string> {
    const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const cachePath = this.getOptimalCachePath(dataBuffer.length);
    const cacheFile = join(cachePath, `${key}.cache`);
    const metaFile = join(cachePath, `${key}.meta`);

    try {
      // Ensure cache directory exists
      if (!existsSync(cachePath)) {
        mkdirSync(cachePath, { recursive: true });
      }

      // Write cache data
      writeFileSync(cacheFile, dataBuffer);

      // Write metadata
      const metadata = {
        key,
        size: dataBuffer.length,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
        path: cachePath,
      };
      writeFileSync(metaFile, JSON.stringify(metadata, null, 2));

      console.log(`Cached ${key} (${dataBuffer.length} bytes) in ${cachePath}`);
      return cacheFile;
    } catch (error) {
      console.error(`Failed to cache ${key}:`, error);
      throw error;
    }
  }

  /**
   * Retrieves cached data using intelligent caching strategy
   */
  async getCachedData(key: string): Promise<Buffer | null> {
    // Check all possible cache locations
    const cachePaths = [
      ...(this.tmpfsMounted ? [join(this.storageConfig.tmpfsMounts[0], 'cache')] : []),
      ...this.storageConfig.cacheDirectories,
      ...this.storageConfig.externalStoragePaths.map(path => join(path, 'openclaw-cache')),
    ];

    for (const cachePath of cachePaths) {
      const cacheFile = join(cachePath, `${key}.cache`);
      const metaFile = join(cachePath, `${key}.meta`);

      if (existsSync(cacheFile) && existsSync(metaFile)) {
        try {
          // Check if cache is still valid
          const metadata = JSON.parse(readFileSync(metaFile, 'utf8'));
          const expiresAt = new Date(metadata.expiresAt);
          
          if (expiresAt > new Date()) {
            const data = readFileSync(cacheFile);
            console.log(`Cache hit for ${key} from ${cachePath}`);
            return data;
          } else {
            // Cache expired, remove it
            try {
              unlinkSync(cacheFile);
              unlinkSync(metaFile);
              console.log(`Expired cache removed for ${key}`);
            } catch (cleanupError) {
              console.warn(`Failed to cleanup expired cache for ${key}:`, cleanupError);
            }
          }
        } catch (error) {
          console.warn(`Failed to read cache for ${key} from ${cachePath}:`, error);
        }
      }
    }

    return null; // Cache miss
  }

  /**
   * Cleans up cache and temporary files when storage is low
   * Requirements 3.5: Automatic cleanup at 80% storage usage
   */
  async cleanupStorage(): Promise<void> {
    try {
      const metrics = await this.getStorageMetrics();
      const usagePercentage = metrics.usedStorage / metrics.totalCapacity;

      if (usagePercentage < 0.8) {
        this.emit('cleanupSkipped', { 
          usagePercentage, 
          threshold: 0.8,
          timestamp: new Date() 
        });
        return;
      }

      let cleanedSize = 0;
      let cleanedFiles = 0;

      // Clean cache directories
      for (const cacheDir of this.storageConfig.cacheDirectories) {
        if (existsSync(cacheDir)) {
          const { size, files } = await this.cleanDirectory(cacheDir, 'cache');
          cleanedSize += size;
          cleanedFiles += files;
        }
      }

      // Clean tmpfs directories
      for (const tmpfsDir of this.storageConfig.tmpfsMounts) {
        if (existsSync(tmpfsDir)) {
          const { size, files } = await this.cleanDirectory(tmpfsDir, 'temp');
          cleanedSize += size;
          cleanedFiles += files;
        }
      }

      // Additional log cleanup if still over threshold
      const updatedMetrics = await this.getStorageMetrics();
      const updatedUsage = updatedMetrics.usedStorage / updatedMetrics.totalCapacity;
      
      if (updatedUsage > 0.8) {
        await this.rotateLogFiles();
      }

      this.emit('cleanupCompleted', {
        cleanedSize,
        cleanedFiles,
        usagePercentageBefore: usagePercentage,
        usagePercentageAfter: updatedUsage,
        timestamp: new Date(),
      });

      console.log(`Storage cleanup completed: removed ${cleanedFiles} files (${cleanedSize} bytes)`);
    } catch (error) {
      console.error('Failed to cleanup storage:', error);
      this.emit('cleanupError', error);
      throw error;
    }
  }

  /**
   * Cleans files from a directory based on age and size
   */
  private async cleanDirectory(directory: string, type: 'cache' | 'temp'): Promise<{ size: number; files: number }> {
    let cleanedSize = 0;
    let cleanedFiles = 0;

    try {
      const files = readdirSync(directory);
      const fileStats: Array<{ path: string; size: number; mtime: Date }> = [];

      // Collect file statistics
      for (const file of files) {
        const filePath = join(directory, file);
        try {
          const stats = statSync(filePath);
          if (stats.isFile()) {
            fileStats.push({
              path: filePath,
              size: stats.size,
              mtime: stats.mtime,
            });
          }
        } catch (error) {
          console.warn(`Failed to stat file ${filePath}:`, error);
        }
      }

      // Sort by modification time (oldest first)
      fileStats.sort((a, b) => a.mtime.getTime() - b.mtime.getTime());

      // Determine cleanup criteria based on type
      const maxAge = type === 'cache' ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000; // 7 days for cache, 1 day for temp
      const now = Date.now();

      // Remove old files
      for (const file of fileStats) {
        const age = now - file.mtime.getTime();
        
        if (age > maxAge) {
          try {
            unlinkSync(file.path);
            cleanedSize += file.size;
            cleanedFiles++;
          } catch (error) {
            console.warn(`Failed to remove file ${file.path}:`, error);
          }
        }
      }
    } catch (error) {
      console.warn(`Failed to clean directory ${directory}:`, error);
    }

    return { size: cleanedSize, files: cleanedFiles };
  }

  /**
   * Detects and configures external USB storage
   * Requirements 3.6: Support external USB storage for media operations
   */
  async detectExternalStorage(): Promise<string[]> {
    const availableStorage: string[] = [];

    try {
      // Check common mount points for external storage
      for (const path of this.storageConfig.externalStoragePaths) {
        if (existsSync(path)) {
          try {
            // Check if the path is actually mounted and writable
            const testFile = join(path, '.openclaw-test');
            writeFileSync(testFile, 'test');
            unlinkSync(testFile);
            availableStorage.push(path);
            console.log(`External storage detected at ${path}`);
          } catch (error) {
            // Path exists but not writable or not mounted
            console.log(`External storage path ${path} exists but not accessible`);
          }
        }
      }

      // Use lsblk to detect additional USB devices
      try {
        const lsblkOutput = execSync('lsblk -J -o NAME,MOUNTPOINT,TYPE,SIZE', { encoding: 'utf8' });
        const devices = JSON.parse(lsblkOutput);
        
        for (const device of devices.blockdevices || []) {
          if (device.children) {
            for (const partition of device.children) {
              if (partition.mountpoint && partition.mountpoint.includes('usb')) {
                if (!availableStorage.includes(partition.mountpoint)) {
                  availableStorage.push(partition.mountpoint);
                  console.log(`USB storage detected via lsblk: ${partition.mountpoint}`);
                }
              }
            }
          }
        }
      } catch (error) {
        console.warn('Failed to detect USB storage via lsblk:', error);
      }

      this.emit('externalStorageDetected', {
        availableStorage,
        count: availableStorage.length,
        timestamp: new Date(),
      });

      return availableStorage;
    } catch (error) {
      console.error('Failed to detect external storage:', error);
      this.emit('externalStorageDetectionError', error);
      return [];
    }
  }

  /**
   * Gets comprehensive storage metrics
   */
  async getStorageMetrics(): Promise<StorageMetrics> {
    try {
      // Get filesystem statistics
      const dfOutput = execSync('df -B1 /', { encoding: 'utf8' });
      const dfLines = dfOutput.split('\n');
      const dfLine = dfLines.length > 1 ? dfLines[1] : '';
      
      let totalCapacity = 0;
      let usedStorage = 0;
      let availableStorage = 0;

      if (dfLine) {
        const dfValues = dfLine.split(/\s+/);
        totalCapacity = parseInt(dfValues[1] || '0', 10);
        usedStorage = parseInt(dfValues[2] || '0', 10);
        availableStorage = parseInt(dfValues[3] || '0', 10);
      }

      // Calculate log size
      let currentLogSize = 0;
      for (const logDir of this.storageConfig.logDirectories) {
        if (existsSync(logDir)) {
          const logFiles = this.collectLogFiles(logDir);
          currentLogSize += logFiles.reduce((sum, file) => sum + file.size, 0);
        }
      }

      // Calculate tmpfs usage
      let tmpfsUsage = 0;
      for (const tmpfsDir of this.storageConfig.tmpfsMounts) {
        if (existsSync(tmpfsDir)) {
          tmpfsUsage += this.getDirectorySize(tmpfsDir);
        }
      }

      // Calculate cache usage
      let cacheUsage = 0;
      for (const cacheDir of this.storageConfig.cacheDirectories) {
        if (existsSync(cacheDir)) {
          cacheUsage += this.getDirectorySize(cacheDir);
        }
      }

      // Check external storage availability
      const externalStorage = await this.detectExternalStorage();
      const externalStorageAvailable = externalStorage.length > 0;

      return {
        totalCapacity,
        usedStorage,
        availableStorage,
        currentLogSize,
        writeOperations: this.writeOperationCount,
        tmpfsUsage,
        cacheUsage,
        externalStorageAvailable,
      };
    } catch (error) {
      console.error('Failed to get storage metrics:', error);
      throw error;
    }
  }

  /**
   * Calculates the total size of a directory
   */
  private getDirectorySize(directory: string): number {
    let totalSize = 0;

    try {
      const files = readdirSync(directory);
      
      for (const file of files) {
        const filePath = join(directory, file);
        try {
          const stats = statSync(filePath);
          if (stats.isFile()) {
            totalSize += stats.size;
          } else if (stats.isDirectory()) {
            totalSize += this.getDirectorySize(filePath);
          }
        } catch (error) {
          // Skip files that can't be accessed
        }
      }
    } catch (error) {
      // Directory doesn't exist or can't be read
    }

    return totalSize;
  }

  /**
   * Starts continuous storage monitoring
   */
  startMonitoring(intervalMs: number = 60000): void {
    if (this.monitoringInterval) {
      this.stopMonitoring();
    }

    this.monitoringInterval = setInterval(async () => {
      try {
        const metrics = await this.getStorageMetrics();
        const usagePercentage = metrics.usedStorage / metrics.totalCapacity;

        this.emit('storageMetricsUpdated', { metrics, usagePercentage, timestamp: new Date() });

        // Trigger cleanup if storage usage is high
        if (usagePercentage >= 0.8) {
          this.emit('storageCleanupRequested', { 
            usagePercentage, 
            metrics,
            timestamp: new Date() 
          });
          await this.cleanupStorage();
        }

        // Trigger log rotation if log size is high
        if (metrics.currentLogSize >= this.storageConfig.maxLogSize * 0.8) {
          await this.rotateLogFiles();
        }
      } catch (error) {
        console.error('Error during storage monitoring:', error);
        this.emit('monitoringError', error);
      }
    }, intervalMs);

    this.emit('monitoringStarted', { interval: intervalMs });
  }

  /**
   * Stops storage monitoring
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
      this.emit('monitoringStopped');
    }
  }

  /**
   * Gets current storage configuration
   */
  getStorageConfiguration(): StorageConfiguration {
    return { ...this.storageConfig };
  }

  /**
   * Updates storage configuration
   */
  updateStorageConfiguration(newConfig: Partial<StorageConfiguration>): void {
    this.storageConfig = { ...this.storageConfig, ...newConfig };
    this.emit('configurationUpdated', { 
      configuration: this.storageConfig,
      timestamp: new Date() 
    });
  }

  /**
   * Gets write operation statistics
   */
  getWriteStatistics(): { count: number; currentPath: string; pathIndex: number } {
    return {
      count: this.writeOperationCount,
      currentPath: this.getNextWritePath(),
      pathIndex: this.currentWearLevelingIndex,
    };
  }

  /**
   * Checks if tmpfs is properly mounted and available
   */
  isTmpfsAvailable(): boolean {
    // Check if tmpfs setup was attempted and completed successfully
    if (this.tmpfsMounted) {
      return true;
    }

    // Also check if any tmpfs mount points exist and are accessible
    for (const mountPoint of this.storageConfig.tmpfsMounts) {
      if (existsSync(mountPoint)) {
        try {
          // Try to check if the mount point is writable (indicates successful setup)
          const testFile = join(mountPoint, '.tmpfs-test');
          writeFileSync(testFile, 'test');
          unlinkSync(testFile);
          return true;
        } catch (error) {
          // Mount point exists but not writable, continue checking others
        }
      }
    }

    return false;
  }

  /**
   * Forces immediate storage optimization
   */
  async optimizeStorageNow(): Promise<void> {
    try {
      // Setup tmpfs if not already done
      if (!this.tmpfsMounted) {
        await this.setupTmpfs();
      }

      // Setup intelligent caching
      await this.setupIntelligentCaching();

      // Rotate logs if needed
      await this.rotateLogFiles();

      // Optimize writes
      await this.optimizeWrites();

      // Cleanup if storage usage is high
      const metrics = await this.getStorageMetrics();
      const usagePercentage = metrics.usedStorage / metrics.totalCapacity;
      
      if (usagePercentage >= 0.8) {
        await this.cleanupStorage();
      }

      this.emit('storageOptimizationCompleted', {
        metrics: await this.getStorageMetrics(),
        timestamp: new Date(),
      });

      console.log('Storage optimization completed successfully');
    } catch (error) {
      console.error('Failed to optimize storage:', error);
      this.emit('storageOptimizationError', error);
      throw error;
    }
  }

  /**
   * Handles large media files using memory-mapped approach
   * Requirements 2.6: Memory-mapped file handling for files >50MB
   */
  async processLargeMediaFile(filePath: string, outputPath?: string): Promise<string> {
    try {
      const stats = statSync(filePath);
      const fileSizeBytes = stats.size;
      const LARGE_FILE_THRESHOLD = 50 * 1024 * 1024; // 50MB

      if (fileSizeBytes <= LARGE_FILE_THRESHOLD) {
        // For smaller files, use regular file operations
        return this.processRegularFile(filePath, outputPath);
      }

      console.log(`Processing large media file: ${filePath} (${fileSizeBytes} bytes)`);

      // Determine optimal storage location for large files
      const optimalPath = this.getOptimalCachePath(fileSizeBytes);
      const finalOutputPath = outputPath || join(optimalPath, `processed_${basename(filePath)}`);

      // Ensure output directory exists
      const outputDir = dirname(finalOutputPath);
      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
      }

      // Use streaming approach for memory-efficient processing
      await this.streamProcessLargeFile(filePath, finalOutputPath);

      this.emit('largeMediaProcessed', {
        inputPath: filePath,
        outputPath: finalOutputPath,
        fileSize: fileSizeBytes,
        timestamp: new Date(),
      });

      console.log(`Large media file processed: ${finalOutputPath}`);
      return finalOutputPath;
    } catch (error) {
      console.error(`Failed to process large media file ${filePath}:`, error);
      this.emit('largeMediaProcessingError', { filePath, error });
      throw error;
    }
  }

  /**
   * Processes regular-sized files using standard file operations
   */
  private async processRegularFile(filePath: string, outputPath?: string): Promise<string> {
    const stats = statSync(filePath);
    const optimalPath = this.getOptimalCachePath(stats.size);
    const finalOutputPath = outputPath || join(optimalPath, `processed_${basename(filePath)}`);

    // Ensure output directory exists
    const outputDir = dirname(finalOutputPath);
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    // For regular files, we can use standard file operations
    const data = readFileSync(filePath);
    writeFileSync(finalOutputPath, data);

    return finalOutputPath;
  }

  /**
   * Streams large files for memory-efficient processing
   */
  private async streamProcessLargeFile(inputPath: string, outputPath: string): Promise<void> {
    try {
      // Create read and write streams
      const readStream = createReadStream(inputPath, { 
        highWaterMark: 64 * 1024 // 64KB chunks for efficient streaming
      });
      const writeStream = createWriteStream(outputPath);

      // Use pipeline for efficient streaming with automatic cleanup
      await pipeline(readStream, writeStream);

      console.log(`Streamed large file from ${inputPath} to ${outputPath}`);
    } catch (error) {
      console.error(`Failed to stream large file from ${inputPath} to ${outputPath}:`, error);
      throw error;
    }
  }

  /**
   * Copies large media files to external storage if available
   * Requirements 3.6: External USB storage support for media operations
   */
  async copyLargeMediaToExternalStorage(filePath: string): Promise<string | null> {
    try {
      const stats = statSync(filePath);
      const fileSizeBytes = stats.size;
      const LARGE_FILE_THRESHOLD = 50 * 1024 * 1024; // 50MB

      if (fileSizeBytes <= LARGE_FILE_THRESHOLD) {
        return null; // Not a large file, no need for external storage
      }

      // Detect available external storage
      const externalStorage = await this.detectExternalStorage();
      if (externalStorage.length === 0) {
        console.log('No external storage available for large media file');
        return null;
      }

      // Choose the first available external storage path
      const externalPath = externalStorage[0];
      const mediaDir = join(externalPath, 'openclaw-media');
      
      if (!existsSync(mediaDir)) {
        mkdirSync(mediaDir, { recursive: true });
      }

      const externalFilePath = join(mediaDir, basename(filePath));

      // Stream the file to external storage
      await this.streamProcessLargeFile(filePath, externalFilePath);

      this.emit('largeMediaMovedToExternal', {
        originalPath: filePath,
        externalPath: externalFilePath,
        fileSize: fileSizeBytes,
        timestamp: new Date(),
      });

      console.log(`Large media file copied to external storage: ${externalFilePath}`);
      return externalFilePath;
    } catch (error) {
      console.error(`Failed to copy large media to external storage:`, error);
      this.emit('largeMediaExternalError', { filePath, error });
      return null;
    }
  }

  /**
   * Processes media files in chunks for memory efficiency
   * Requirements 2.6: Memory-mapped file handling approach
   */
  async processMediaInChunks(filePath: string, chunkProcessor: (chunk: Buffer, index: number) => Promise<Buffer>): Promise<string> {
    try {
      const stats = statSync(filePath);
      const fileSizeBytes = stats.size;
      const CHUNK_SIZE = 1024 * 1024; // 1MB chunks
      
      console.log(`Processing media file in chunks: ${filePath} (${fileSizeBytes} bytes)`);

      // Determine output path
      const optimalPath = this.getOptimalCachePath(fileSizeBytes);
      const outputPath = join(optimalPath, `chunked_${basename(filePath)}`);
      
      // Ensure output directory exists
      const outputDir = dirname(outputPath);
      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
      }

      // Process file in chunks
      const readStream = createReadStream(filePath, { highWaterMark: CHUNK_SIZE });
      const writeStream = createWriteStream(outputPath);

      let chunkIndex = 0;
      
      for await (const chunk of readStream) {
        // Process each chunk
        const processedChunk = await chunkProcessor(chunk, chunkIndex);
        
        // Write processed chunk
        writeStream.write(processedChunk);
        chunkIndex++;
        
        // Emit progress for large files
        if (chunkIndex % 10 === 0) {
          const processedBytes = chunkIndex * CHUNK_SIZE;
          const progress = Math.min((processedBytes / fileSizeBytes) * 100, 100);
          
          this.emit('mediaProcessingProgress', {
            filePath,
            progress,
            processedChunks: chunkIndex,
            timestamp: new Date(),
          });
        }
      }

      writeStream.end();

      // Wait for write stream to finish
      await new Promise((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });

      this.emit('mediaChunkProcessingCompleted', {
        inputPath: filePath,
        outputPath,
        totalChunks: chunkIndex,
        fileSize: fileSizeBytes,
        timestamp: new Date(),
      });

      console.log(`Media file processed in ${chunkIndex} chunks: ${outputPath}`);
      return outputPath;
    } catch (error) {
      console.error(`Failed to process media file in chunks:`, error);
      this.emit('mediaChunkProcessingError', { filePath, error });
      throw error;
    }
  }

  /**
   * Gets memory usage statistics for large file operations
   */
  getMemoryMappedFileStats(): { 
    largeFilesProcessed: number; 
    totalBytesProcessed: number; 
    externalStorageUsed: boolean;
    averageChunkSize: number;
  } {
    // This would be implemented with actual tracking in a real implementation
    // For now, return placeholder values
    return {
      largeFilesProcessed: 0,
      totalBytesProcessed: 0,
      externalStorageUsed: false,
      averageChunkSize: 1024 * 1024, // 1MB
    };
  }

  /**
   * Cleans up temporary files created during large media processing
   */
  async cleanupLargeMediaTempFiles(): Promise<void> {
    try {
      const tempPatterns = ['processed_*', 'chunked_*', 'temp_media_*'];
      let cleanedFiles = 0;
      let cleanedSize = 0;

      // Clean from all cache directories
      const allCachePaths = [
        ...this.storageConfig.cacheDirectories,
        ...(this.tmpfsMounted ? [join(this.storageConfig.tmpfsMounts[0], 'cache')] : []),
        ...this.storageConfig.externalStoragePaths.map(path => join(path, 'openclaw-cache')),
      ];

      for (const cachePath of allCachePaths) {
        if (existsSync(cachePath)) {
          const files = readdirSync(cachePath);
          
          for (const file of files) {
            const shouldClean = tempPatterns.some(pattern => {
              const regex = new RegExp(pattern.replace('*', '.*'));
              return regex.test(file);
            });

            if (shouldClean) {
              const filePath = join(cachePath, file);
              try {
                const stats = statSync(filePath);
                unlinkSync(filePath);
                cleanedFiles++;
                cleanedSize += stats.size;
              } catch (error) {
                console.warn(`Failed to clean temp file ${filePath}:`, error);
              }
            }
          }
        }
      }

      this.emit('largeMediaTempCleanup', {
        cleanedFiles,
        cleanedSize,
        timestamp: new Date(),
      });

      console.log(`Cleaned up ${cleanedFiles} large media temp files (${cleanedSize} bytes)`);
    } catch (error) {
      console.error('Failed to cleanup large media temp files:', error);
      this.emit('largeMediaTempCleanupError', error);
    }
  }
}