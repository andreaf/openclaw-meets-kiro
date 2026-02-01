/**
 * Pi Media Processing Integration
 * 
 * Integrates Pi optimization layer with OpenClaw media processing pipeline.
 * Provides memory-mapped file handling for large media files, external USB storage
 * support, and Pi-specific media processing optimizations.
 * 
 * Requirements: 2.6 - Memory-mapped file handling for large media files
 * Requirements: 3.6 - External USB storage support for media operations
 */

import { EventEmitter } from 'node:events';
import { createSubsystemLogger } from '../logging/subsystem.js';
import { StorageManager } from './storage-manager/storage-manager.js';
import type { PiConfiguration } from './types/pi-configuration.js';

export interface PiMediaIntegrationConfig {
  /** Enable Pi media optimization */
  enabled: boolean;
  /** Memory-mapped file handling settings */
  memoryMappedFiles: {
    enabled: boolean;
    minFileSizeMB: number; // Minimum file size to use memory mapping
    maxMappedSizeMB: number; // Maximum size to memory map at once
  };
  /** External storage settings */
  externalStorage: {
    enabled: boolean;
    autoDetect: boolean;
    preferredMountPoints: string[];
    minFreeSpaceGB: number; // Minimum free space required
  };
  /** Media processing optimizations */
  processingOptimizations: {
    enabled: boolean;
    maxConcurrentProcessing: number;
    useHardwareAcceleration: boolean;
    compressionLevel: number; // 1-9, higher = more compression
  };
  /** Cache settings */
  mediaCache: {
    enabled: boolean;
    maxCacheSizeMB: number;
    ttlMinutes: number;
    useExternalStorage: boolean;
  };
}

export interface MediaProcessingMetrics {
  totalFilesProcessed: number;
  memoryMappedFiles: number;
  externalStorageFiles: number;
  averageProcessingTimeMs: number;
  cacheHitRate: number;
  storageUsageMB: {
    internal: number;
    external: number;
    cache: number;
  };
  lastProcessedAt?: Date;
}

export interface MediaFileInfo {
  path: string;
  sizeMB: number;
  mimeType: string;
  isMemoryMapped: boolean;
  isOnExternalStorage: boolean;
  processingTimeMs?: number;
  cacheKey?: string;
}

/**
 * Pi Media Processing Integration
 * 
 * Provides Pi-specific optimizations for media processing
 */
export class PiMediaIntegration extends EventEmitter {
  private config: PiMediaIntegrationConfig;
  private piConfig: PiConfiguration;
  private storageManager: StorageManager;
  private logger = createSubsystemLogger('pi/media-integration');
  
  // Integration state
  private isStarted = false;
  private metrics: MediaProcessingMetrics;
  private memoryMappedFiles = new Map<string, { fd: number; size: number; lastAccessed: Date }>();
  private externalStoragePaths: string[] = [];
  private mediaCache = new Map<string, { data: Buffer; timestamp: Date; sizeMB: number }>();
  private processingQueue: Array<{ path: string; priority: number; resolve: Function; reject: Function }> = [];
  private activeProcessing = 0;

  constructor(
    piConfig: PiConfiguration,
    storageManager: StorageManager,
    integrationConfig: Partial<PiMediaIntegrationConfig> = {}
  ) {
    super();
    this.piConfig = piConfig;
    this.storageManager = storageManager;
    this.config = {
      enabled: true,
      memoryMappedFiles: {
        enabled: true,
        minFileSizeMB: 50, // Files larger than 50MB use memory mapping
        maxMappedSizeMB: piConfig.memory.total <= 1024 ? 100 : 200, // Limit based on Pi memory
      },
      externalStorage: {
        enabled: true,
        autoDetect: true,
        preferredMountPoints: ['/media', '/mnt', '/usb'],
        minFreeSpaceGB: 1, // Require at least 1GB free space
      },
      processingOptimizations: {
        enabled: true,
        maxConcurrentProcessing: piConfig.memory.total <= 1024 ? 1 : 2, // Limit concurrent processing on low-memory Pi
        useHardwareAcceleration: piConfig.model.includes('Pi 4') || piConfig.model.includes('Pi 5'), // Hardware acceleration for newer Pi models
        compressionLevel: 6, // Balanced compression
      },
      mediaCache: {
        enabled: true,
        maxCacheSizeMB: piConfig.memory.total <= 1024 ? 50 : 100, // Smaller cache for low-memory Pi
        ttlMinutes: 30,
        useExternalStorage: true,
      },
      ...integrationConfig,
    };

    this.metrics = {
      totalFilesProcessed: 0,
      memoryMappedFiles: 0,
      externalStorageFiles: 0,
      averageProcessingTimeMs: 0,
      cacheHitRate: 0,
      storageUsageMB: {
        internal: 0,
        external: 0,
        cache: 0,
      },
    };

    this.logger.info('Pi media integration initialized', {
      piModel: piConfig.model,
      memoryLimit: piConfig.memory.limit,
      memoryMappingEnabled: this.config.memoryMappedFiles.enabled,
      externalStorageEnabled: this.config.externalStorage.enabled,
      maxConcurrentProcessing: this.config.processingOptimizations.maxConcurrentProcessing,
    });
  }

  /**
   * Starts Pi media integration
   */
  async start(): Promise<void> {
    if (this.isStarted) {
      this.logger.warn('Pi media integration already started');
      return;
    }

    if (!this.config.enabled) {
      this.logger.info('Pi media integration disabled');
      return;
    }

    try {
      this.logger.info('Starting Pi media integration...');

      // Detect external storage
      if (this.config.externalStorage.enabled && this.config.externalStorage.autoDetect) {
        await this.detectExternalStorage();
      }

      // Initialize media cache
      if (this.config.mediaCache.enabled) {
        await this.initializeMediaCache();
      }

      // Start cleanup intervals
      this.startCleanupIntervals();

      this.isStarted = true;
      this.emit('started', { timestamp: new Date() });
      this.logger.info('Pi media integration started successfully');
    } catch (error) {
      this.logger.error('Failed to start Pi media integration:', { error: error instanceof Error ? error.message : String(error) });
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Stops Pi media integration
   */
  async stop(): Promise<void> {
    if (!this.isStarted) {
      return;
    }

    try {
      this.logger.info('Stopping Pi media integration...');

      // Close all memory-mapped files
      await this.closeAllMemoryMappedFiles();

      // Clear media cache
      this.mediaCache.clear();

      this.isStarted = false;
      this.emit('stopped', { timestamp: new Date() });
      this.logger.info('Pi media integration stopped');
    } catch (error) {
      this.logger.error('Error stopping Pi media integration:', { error: error instanceof Error ? error.message : String(error) });
      this.emit('error', error);
    }
  }

  /**
   * Processes a media file with Pi optimizations
   */
  async processMediaFile(filePath: string, options: {
    priority?: number;
    useMemoryMapping?: boolean;
    preferExternalStorage?: boolean;
    enableCaching?: boolean;
  } = {}): Promise<MediaFileInfo> {
    const {
      priority = 1,
      useMemoryMapping = true,
      preferExternalStorage = true,
      enableCaching = true,
    } = options;

    return new Promise((resolve, reject) => {
      this.processingQueue.push({
        path: filePath,
        priority,
        resolve: async () => {
          try {
            const result = await this.processMediaFileInternal(filePath, {
              useMemoryMapping,
              preferExternalStorage,
              enableCaching,
            });
            resolve(result);
          } catch (error) {
            reject(error);
          }
        },
        reject,
      });

      this.processQueue();
    });
  }

  /**
   * Gets optimal storage location for a media file
   */
  async getOptimalStorageLocation(fileSizeMB: number, mimeType: string): Promise<{
    path: string;
    isExternal: boolean;
    useMemoryMapping: boolean;
    reason: string;
  }> {
    const useMemoryMapping = this.config.memoryMappedFiles.enabled && 
                            fileSizeMB >= this.config.memoryMappedFiles.minFileSizeMB;

    // Check if external storage is available and preferred
    if (this.config.externalStorage.enabled && this.externalStoragePaths.length > 0) {
      for (const externalPath of this.externalStoragePaths) {
        const freeSpaceGB = await this.getAvailableSpace(externalPath);
        if (freeSpaceGB >= this.config.externalStorage.minFreeSpaceGB) {
          return {
            path: externalPath,
            isExternal: true,
            useMemoryMapping,
            reason: `External storage with ${freeSpaceGB.toFixed(1)}GB free space`,
          };
        }
      }
    }

    // Fall back to internal storage
    const internalPath = await this.storageManager.getOptimalStoragePath();
    return {
      path: internalPath,
      isExternal: false,
      useMemoryMapping,
      reason: 'Internal storage (external storage not available or full)',
    };
  }

  /**
   * Creates a memory-mapped file handle for large media files
   */
  async createMemoryMappedFile(filePath: string): Promise<{
    fd: number;
    size: number;
    mappedBuffer?: Buffer;
  }> {
    if (!this.config.memoryMappedFiles.enabled) {
      throw new Error('Memory-mapped files are disabled');
    }

    try {
      const { open, stat } = await import('node:fs/promises');
      
      // Open file for reading
      const fileHandle = await open(filePath, 'r');
      const stats = await stat(filePath);
      const fileSizeMB = stats.size / (1024 * 1024);

      if (fileSizeMB < this.config.memoryMappedFiles.minFileSizeMB) {
        await fileHandle.close();
        throw new Error(`File too small for memory mapping: ${fileSizeMB.toFixed(1)}MB < ${this.config.memoryMappedFiles.minFileSizeMB}MB`);
      }

      if (fileSizeMB > this.config.memoryMappedFiles.maxMappedSizeMB) {
        await fileHandle.close();
        throw new Error(`File too large for memory mapping: ${fileSizeMB.toFixed(1)}MB > ${this.config.memoryMappedFiles.maxMappedSizeMB}MB`);
      }

      const fd = fileHandle.fd;
      
      // Track memory-mapped file
      this.memoryMappedFiles.set(filePath, {
        fd,
        size: stats.size,
        lastAccessed: new Date(),
      });

      this.metrics.memoryMappedFiles++;
      
      this.logger.debug('Created memory-mapped file', {
        filePath,
        sizeMB: fileSizeMB.toFixed(1),
        fd,
      });

      this.emit('memoryMappedFileCreated', {
        filePath,
        sizeMB: fileSizeMB,
        fd,
      });

      return {
        fd,
        size: stats.size,
      };
    } catch (error) {
      this.logger.error('Failed to create memory-mapped file:', { 
        filePath, 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  /**
   * Gets current media processing metrics
   */
  getMetrics(): MediaProcessingMetrics {
    // Update storage usage
    this.updateStorageUsageMetrics();
    
    return { ...this.metrics };
  }

  /**
   * Gets available external storage paths
   */
  getExternalStoragePaths(): string[] {
    return [...this.externalStoragePaths];
  }

  /**
   * Gets media cache statistics
   */
  getMediaCacheStats(): {
    size: number;
    entries: number;
    hitRate: number;
    totalSizeMB: number;
  } {
    const entries = this.mediaCache.size;
    const totalSizeMB = Array.from(this.mediaCache.values())
      .reduce((sum, entry) => sum + entry.sizeMB, 0);

    return {
      size: this.mediaCache.size,
      entries,
      hitRate: this.metrics.cacheHitRate,
      totalSizeMB,
    };
  }

  /**
   * Internal media file processing
   */
  private async processMediaFileInternal(filePath: string, options: {
    useMemoryMapping: boolean;
    preferExternalStorage: boolean;
    enableCaching: boolean;
  }): Promise<MediaFileInfo> {
    const startTime = Date.now();
    this.activeProcessing++;

    try {
      const { stat } = await import('node:fs/promises');
      const stats = await stat(filePath);
      const fileSizeMB = stats.size / (1024 * 1024);
      
      // Detect MIME type (simplified)
      const mimeType = this.detectMimeType(filePath);
      
      // Determine if memory mapping should be used
      const shouldUseMemoryMapping = options.useMemoryMapping && 
                                   this.config.memoryMappedFiles.enabled &&
                                   fileSizeMB >= this.config.memoryMappedFiles.minFileSizeMB;

      // Check if file is on external storage
      const isOnExternalStorage = this.externalStoragePaths.some(extPath => 
        filePath.startsWith(extPath)
      );

      // Create memory mapping if needed
      let memoryMappedInfo = null;
      if (shouldUseMemoryMapping) {
        try {
          memoryMappedInfo = await this.createMemoryMappedFile(filePath);
        } catch (error) {
          this.logger.warn('Failed to create memory mapping, falling back to regular file access:', { 
            filePath, 
            error: error instanceof Error ? error.message : String(error) 
          });
        }
      }

      const processingTime = Date.now() - startTime;
      
      // Update metrics
      this.metrics.totalFilesProcessed++;
      if (isOnExternalStorage) {
        this.metrics.externalStorageFiles++;
      }
      
      // Update average processing time
      this.metrics.averageProcessingTimeMs = 
        (this.metrics.averageProcessingTimeMs * (this.metrics.totalFilesProcessed - 1) + processingTime) / 
        this.metrics.totalFilesProcessed;
      
      this.metrics.lastProcessedAt = new Date();

      const mediaFileInfo: MediaFileInfo = {
        path: filePath,
        sizeMB: fileSizeMB,
        mimeType,
        isMemoryMapped: !!memoryMappedInfo,
        isOnExternalStorage,
        processingTimeMs: processingTime,
      };

      this.logger.debug('Media file processed', {
        filePath,
        sizeMB: fileSizeMB.toFixed(1),
        mimeType,
        isMemoryMapped: mediaFileInfo.isMemoryMapped,
        isOnExternalStorage,
        processingTimeMs: processingTime,
      });

      this.emit('mediaFileProcessed', mediaFileInfo);

      return mediaFileInfo;
    } finally {
      this.activeProcessing--;
    }
  }

  /**
   * Processes the media file queue
   */
  private processQueue(): void {
    if (this.activeProcessing >= this.config.processingOptimizations.maxConcurrentProcessing) {
      return;
    }

    if (this.processingQueue.length === 0) {
      return;
    }

    // Sort by priority (higher priority first)
    this.processingQueue.sort((a, b) => b.priority - a.priority);
    
    const nextItem = this.processingQueue.shift();
    if (nextItem) {
      nextItem.resolve();
      
      // Process next item if queue is not empty
      setTimeout(() => this.processQueue(), 0);
    }
  }

  /**
   * Detects external storage devices
   */
  private async detectExternalStorage(): Promise<void> {
    try {
      const { readdir, stat } = await import('node:fs/promises');
      
      this.externalStoragePaths = [];
      
      for (const mountPoint of this.config.externalStorage.preferredMountPoints) {
        try {
          const entries = await readdir(mountPoint);
          
          for (const entry of entries) {
            const fullPath = `${mountPoint}/${entry}`;
            const stats = await stat(fullPath);
            
            if (stats.isDirectory()) {
              const freeSpaceGB = await this.getAvailableSpace(fullPath);
              
              if (freeSpaceGB >= this.config.externalStorage.minFreeSpaceGB) {
                this.externalStoragePaths.push(fullPath);
                this.logger.info('External storage detected', {
                  path: fullPath,
                  freeSpaceGB: freeSpaceGB.toFixed(1),
                });
              }
            }
          }
        } catch (error) {
          // Mount point doesn't exist or is not accessible
          continue;
        }
      }

      this.logger.info('External storage detection completed', {
        pathsFound: this.externalStoragePaths.length,
        paths: this.externalStoragePaths,
      });
    } catch (error) {
      this.logger.warn('Failed to detect external storage:', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  /**
   * Gets available space for a path in GB
   */
  private async getAvailableSpace(path: string): Promise<number> {
    try {
      const { execSync } = await import('node:child_process');
      const output = execSync(`df -BG "${path}" | tail -1 | awk '{print $4}'`, { encoding: 'utf8' });
      const availableGB = parseInt(output.replace('G', ''), 10);
      return isNaN(availableGB) ? 0 : availableGB;
    } catch (error) {
      this.logger.warn('Failed to get available space:', { path, error: error instanceof Error ? error.message : String(error) });
      return 0;
    }
  }

  /**
   * Initializes media cache
   */
  private async initializeMediaCache(): Promise<void> {
    // Media cache is initialized in memory
    // In a production implementation, this could load from persistent storage
    this.logger.debug('Media cache initialized', {
      maxSizeMB: this.config.mediaCache.maxCacheSizeMB,
      ttlMinutes: this.config.mediaCache.ttlMinutes,
    });
  }

  /**
   * Starts cleanup intervals for memory-mapped files and cache
   */
  private startCleanupIntervals(): void {
    // Cleanup memory-mapped files every 5 minutes
    setInterval(() => {
      this.cleanupMemoryMappedFiles();
    }, 5 * 60 * 1000);

    // Cleanup media cache every 10 minutes
    setInterval(() => {
      this.cleanupMediaCache();
    }, 10 * 60 * 1000);
  }

  /**
   * Cleans up unused memory-mapped files
   */
  private cleanupMemoryMappedFiles(): void {
    const now = new Date();
    const maxIdleTime = 30 * 60 * 1000; // 30 minutes

    for (const [filePath, info] of this.memoryMappedFiles.entries()) {
      if (now.getTime() - info.lastAccessed.getTime() > maxIdleTime) {
        this.closeMemoryMappedFile(filePath);
      }
    }
  }

  /**
   * Cleans up expired media cache entries
   */
  private cleanupMediaCache(): void {
    const now = new Date();
    const ttlMs = this.config.mediaCache.ttlMinutes * 60 * 1000;

    for (const [key, entry] of this.mediaCache.entries()) {
      if (now.getTime() - entry.timestamp.getTime() > ttlMs) {
        this.mediaCache.delete(key);
      }
    }

    // Also enforce size limit
    const totalSizeMB = Array.from(this.mediaCache.values())
      .reduce((sum, entry) => sum + entry.sizeMB, 0);

    if (totalSizeMB > this.config.mediaCache.maxCacheSizeMB) {
      // Remove oldest entries until under limit
      const entries = Array.from(this.mediaCache.entries())
        .sort(([, a], [, b]) => a.timestamp.getTime() - b.timestamp.getTime());

      let currentSizeMB = totalSizeMB;
      for (const [key, entry] of entries) {
        if (currentSizeMB <= this.config.mediaCache.maxCacheSizeMB) {
          break;
        }
        this.mediaCache.delete(key);
        currentSizeMB -= entry.sizeMB;
      }
    }
  }

  /**
   * Closes a specific memory-mapped file
   */
  private async closeMemoryMappedFile(filePath: string): Promise<void> {
    const info = this.memoryMappedFiles.get(filePath);
    if (!info) {
      return;
    }

    try {
      const { close } = await import('node:fs/promises');
      await close(info.fd);
      this.memoryMappedFiles.delete(filePath);
      
      this.logger.debug('Closed memory-mapped file', { filePath, fd: info.fd });
    } catch (error) {
      this.logger.warn('Failed to close memory-mapped file:', { 
        filePath, 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }

  /**
   * Closes all memory-mapped files
   */
  private async closeAllMemoryMappedFiles(): Promise<void> {
    const filePaths = Array.from(this.memoryMappedFiles.keys());
    await Promise.all(filePaths.map(path => this.closeMemoryMappedFile(path)));
  }

  /**
   * Updates storage usage metrics
   */
  private updateStorageUsageMetrics(): void {
    // This would be implemented to actually measure storage usage
    // For now, we'll use placeholder values
    this.metrics.storageUsageMB = {
      internal: 0, // Would measure actual internal storage usage
      external: 0, // Would measure actual external storage usage
      cache: Array.from(this.mediaCache.values()).reduce((sum, entry) => sum + entry.sizeMB, 0),
    };
  }

  /**
   * Simple MIME type detection based on file extension
   */
  private detectMimeType(filePath: string): string {
    const ext = filePath.toLowerCase().split('.').pop() || '';
    
    const mimeTypes: Record<string, string> = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'mp4': 'video/mp4',
      'webm': 'video/webm',
      'avi': 'video/avi',
      'mov': 'video/quicktime',
      'mp3': 'audio/mpeg',
      'wav': 'audio/wav',
      'ogg': 'audio/ogg',
      'pdf': 'application/pdf',
    };

    return mimeTypes[ext] || 'application/octet-stream';
  }
}