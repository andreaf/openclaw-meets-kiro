/**
 * Gateway Pi Media Integration
 * 
 * Integrates Pi media processing optimization with OpenClaw Gateway service.
 * Provides memory-mapped file handling, external storage support, and Pi-specific
 * media processing optimizations through the Gateway.
 * 
 * Requirements: 2.6 - Memory-mapped file handling for large media files
 * Requirements: 3.6 - External USB storage support for media operations
 */

import { createSubsystemLogger } from '../logging/subsystem.js';
import { PiMediaIntegration } from '../pi/media-integration.js';
import { StorageManager } from '../pi/storage-manager/storage-manager.js';
import type { PiConfiguration } from '../pi/types/pi-configuration.js';

const log = createSubsystemLogger('gateway/media-pi-integration');

export interface GatewayMediaPiIntegrationOptions {
  /** Enable Pi media optimization */
  enabled?: boolean;
  /** Memory-mapped file handling settings */
  memoryMappedFiles?: {
    enabled?: boolean;
    minFileSizeMB?: number;
    maxMappedSizeMB?: number;
  };
  /** External storage settings */
  externalStorage?: {
    enabled?: boolean;
    autoDetect?: boolean;
    preferredMountPoints?: string[];
    minFreeSpaceGB?: number;
  };
  /** Processing optimization settings */
  processingOptimizations?: {
    enabled?: boolean;
    maxConcurrentProcessing?: number;
    useHardwareAcceleration?: boolean;
    compressionLevel?: number;
  };
}

export interface GatewayMediaPiIntegrationState {
  enabled: boolean;
  integration: PiMediaIntegration | null;
  lastMetrics?: ReturnType<PiMediaIntegration['getMetrics']>;
  lastCacheStats?: ReturnType<PiMediaIntegration['getMediaCacheStats']>;
}

/**
 * Initializes Pi media integration for Gateway
 */
export async function initializeGatewayMediaPiIntegration(
  piConfig: PiConfiguration,
  storageManager: StorageManager,
  options: GatewayMediaPiIntegrationOptions = {}
): Promise<GatewayMediaPiIntegrationState> {
  const {
    enabled = true,
    memoryMappedFiles = {},
    externalStorage = {},
    processingOptimizations = {},
  } = options;

  log.info('Initializing Gateway Pi media integration...', {
    enabled,
    piModel: piConfig.model,
    memoryLimit: piConfig.memory.limit,
  });

  if (!enabled) {
    log.info('Pi media integration disabled');
    return {
      enabled: false,
      integration: null,
    };
  }

  try {
    // Create Pi media integration instance
    const integration = new PiMediaIntegration(piConfig, storageManager, {
      enabled: true,
      memoryMappedFiles: {
        enabled: memoryMappedFiles.enabled !== false,
        minFileSizeMB: memoryMappedFiles.minFileSizeMB || 50,
        maxMappedSizeMB: memoryMappedFiles.maxMappedSizeMB || (piConfig.memory.total <= 1024 ? 100 : 200),
      },
      externalStorage: {
        enabled: externalStorage.enabled !== false,
        autoDetect: externalStorage.autoDetect !== false,
        preferredMountPoints: externalStorage.preferredMountPoints || ['/media', '/mnt', '/usb'],
        minFreeSpaceGB: externalStorage.minFreeSpaceGB || 1,
      },
      processingOptimizations: {
        enabled: processingOptimizations.enabled !== false,
        maxConcurrentProcessing: processingOptimizations.maxConcurrentProcessing || (piConfig.memory.total <= 1024 ? 1 : 2),
        useHardwareAcceleration: processingOptimizations.useHardwareAcceleration !== false,
        compressionLevel: processingOptimizations.compressionLevel || 6,
      },
      mediaCache: {
        enabled: true,
        maxCacheSizeMB: piConfig.memory.total <= 1024 ? 50 : 100,
        ttlMinutes: 30,
        useExternalStorage: true,
      },
    });

    // Start the integration
    await integration.start();

    log.info('Gateway Pi media integration initialized successfully');

    return {
      enabled: true,
      integration,
    };
  } catch (error) {
    log.error('Failed to initialize Gateway Pi media integration:', { error: error instanceof Error ? error.message : String(error) });
    
    return {
      enabled: false,
      integration: null,
    };
  }
}

/**
 * Sets up Pi media integration with Gateway WebSocket handlers and broadcasting
 */
export function setupGatewayMediaPiIntegration(
  state: GatewayMediaPiIntegrationState,
  broadcast: (event: string, payload: unknown, options?: { dropIfSlow?: boolean }) => void,
  registerHandlers: (handlers: Record<string, (...args: any[]) => any>) => void
): void {
  log.info('Setting up Gateway Pi media integration handlers', {
    enabled: state.enabled,
    hasIntegration: !!state.integration,
  });

  if (!state.integration) {
    log.info('Pi media integration not available');
    return;
  }

  // Register Pi media WebSocket handlers
  const mediaHandlers = createPiMediaHandlers(state.integration);
  registerHandlers(mediaHandlers);

  // Set up event listeners for broadcasting
  setupPiMediaEventBroadcasting(state.integration, broadcast);

  log.info('Gateway Pi media integration setup completed');
}

/**
 * Creates Pi media handlers for Gateway WebSocket methods
 */
function createPiMediaHandlers(
  integration: PiMediaIntegration
): Record<string, (...args: any[]) => any> {
  return {
    /**
     * Gets current media processing metrics
     */
    'pi.media.getMetrics': async (): Promise<ReturnType<PiMediaIntegration['getMetrics']>> => {
      log.debug('Getting Pi media processing metrics');
      
      try {
        const metrics = integration.getMetrics();
        
        log.debug('Pi media processing metrics retrieved', {
          totalFilesProcessed: metrics.totalFilesProcessed,
          memoryMappedFiles: metrics.memoryMappedFiles,
          externalStorageFiles: metrics.externalStorageFiles,
        });
        
        return metrics;
      } catch (error) {
        log.error('Failed to get Pi media processing metrics:', { error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    },

    /**
     * Gets media cache statistics
     */
    'pi.media.getCacheStats': async (): Promise<ReturnType<PiMediaIntegration['getMediaCacheStats']>> => {
      log.debug('Getting Pi media cache statistics');
      
      try {
        const stats = integration.getMediaCacheStats();
        
        log.debug('Pi media cache statistics retrieved', {
          entries: stats.entries,
          totalSizeMB: stats.totalSizeMB,
          hitRate: stats.hitRate,
        });
        
        return stats;
      } catch (error) {
        log.error('Failed to get Pi media cache statistics:', { error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    },

    /**
     * Gets available external storage paths
     */
    'pi.media.getExternalStoragePaths': async (): Promise<string[]> => {
      log.debug('Getting Pi external storage paths');
      
      try {
        const paths = integration.getExternalStoragePaths();
        
        log.debug('Pi external storage paths retrieved', {
          pathCount: paths.length,
          paths,
        });
        
        return paths;
      } catch (error) {
        log.error('Failed to get Pi external storage paths:', { error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    },

    /**
     * Gets optimal storage location for a media file
     */
    'pi.media.getOptimalStorageLocation': async (params: {
      fileSizeMB: number;
      mimeType: string;
    }): Promise<ReturnType<PiMediaIntegration['getOptimalStorageLocation']>> => {
      const { fileSizeMB, mimeType } = params;
      log.debug('Getting optimal storage location', { fileSizeMB, mimeType });
      
      try {
        const location = await integration.getOptimalStorageLocation(fileSizeMB, mimeType);
        
        log.debug('Optimal storage location determined', {
          path: location.path,
          isExternal: location.isExternal,
          useMemoryMapping: location.useMemoryMapping,
          reason: location.reason,
        });
        
        return location;
      } catch (error) {
        log.error('Failed to get optimal storage location:', { error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    },

    /**
     * Processes a media file with Pi optimizations
     */
    'pi.media.processFile': async (params: {
      filePath: string;
      priority?: number;
      useMemoryMapping?: boolean;
      preferExternalStorage?: boolean;
      enableCaching?: boolean;
    }): Promise<{ success: boolean; fileInfo?: Awaited<ReturnType<PiMediaIntegration['processMediaFile']>>; message: string }> => {
      const { filePath, priority = 1, useMemoryMapping = true, preferExternalStorage = true, enableCaching = true } = params;
      log.debug('Processing media file with Pi optimizations', {
        filePath,
        priority,
        useMemoryMapping,
        preferExternalStorage,
        enableCaching,
      });
      
      try {
        const fileInfo = await integration.processMediaFile(filePath, {
          priority,
          useMemoryMapping,
          preferExternalStorage,
          enableCaching,
        });
        
        const message = `Media file processed successfully: ${fileInfo.sizeMB.toFixed(1)}MB, ${fileInfo.isMemoryMapped ? 'memory-mapped' : 'regular'}, ${fileInfo.isOnExternalStorage ? 'external' : 'internal'} storage`;
        log.info(message, { filePath, fileInfo });
        
        return {
          success: true,
          fileInfo,
          message,
        };
      } catch (error) {
        const message = `Failed to process media file: ${error instanceof Error ? error.message : 'Unknown error'}`;
        log.error(message, { filePath, error: error instanceof Error ? error.message : String(error) });
        
        return {
          success: false,
          message,
        };
      }
    },

    /**
     * Creates a memory-mapped file handle
     */
    'pi.media.createMemoryMappedFile': async (params: {
      filePath: string;
    }): Promise<{ success: boolean; fileHandle?: { fd: number; size: number }; message: string }> => {
      const { filePath } = params;
      log.debug('Creating memory-mapped file handle', { filePath });
      
      try {
        const fileHandle = await integration.createMemoryMappedFile(filePath);
        
        const message = `Memory-mapped file created successfully: ${(fileHandle.size / (1024 * 1024)).toFixed(1)}MB`;
        log.info(message, { filePath, fd: fileHandle.fd, size: fileHandle.size });
        
        return {
          success: true,
          fileHandle,
          message,
        };
      } catch (error) {
        const message = `Failed to create memory-mapped file: ${error instanceof Error ? error.message : 'Unknown error'}`;
        log.error(message, { filePath, error: error instanceof Error ? error.message : String(error) });
        
        return {
          success: false,
          message,
        };
      }
    },
  };
}

/**
 * Sets up Pi media event broadcasting to Gateway clients
 */
function setupPiMediaEventBroadcasting(
  integration: PiMediaIntegration,
  broadcast: (event: string, payload: unknown, options?: { dropIfSlow?: boolean }) => void
): void {
  // Broadcast media processing events to connected clients
  integration.on('mediaFileProcessed', (event) => {
    log.debug('Broadcasting media file processed event', event);
    broadcast('pi.media.fileProcessed', event, { dropIfSlow: true });
  });

  integration.on('memoryMappedFileCreated', (event) => {
    log.debug('Broadcasting memory-mapped file created event', event);
    broadcast('pi.media.memoryMappedFileCreated', event, { dropIfSlow: true });
  });

  integration.on('started', () => {
    log.info('Pi media integration started, broadcasting status change');
    broadcast('pi.media.statusChanged', {
      started: true,
      timestamp: new Date(),
    }, { dropIfSlow: true });
  });

  integration.on('stopped', () => {
    log.info('Pi media integration stopped, broadcasting status change');
    broadcast('pi.media.statusChanged', {
      started: false,
      timestamp: new Date(),
    }, { dropIfSlow: true });
  });

  integration.on('error', (error) => {
    log.error('Pi media integration error:', { error: error instanceof Error ? error.message : String(error) });
    broadcast('pi.media.error', {
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date(),
    }, { dropIfSlow: true });
  });
}

/**
 * Stops Pi media integration and cleans up resources
 */
export async function stopGatewayMediaPiIntegration(
  state: GatewayMediaPiIntegrationState
): Promise<void> {
  if (!state.integration) {
    return;
  }

  try {
    log.info('Stopping Gateway Pi media integration...');
    await state.integration.stop();
    log.info('Gateway Pi media integration stopped');
  } catch (error) {
    log.error('Error stopping Gateway Pi media integration:', { error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Gets Pi media integration health status
 */
export function getPiMediaIntegrationHealth(
  state: GatewayMediaPiIntegrationState
): {
  enabled: boolean;
  integrationActive: boolean;
  metrics?: ReturnType<PiMediaIntegration['getMetrics']>;
  cacheStats?: ReturnType<PiMediaIntegration['getMediaCacheStats']>;
  externalStoragePaths?: string[];
} {
  return {
    enabled: state.enabled,
    integrationActive: !!state.integration,
    metrics: state.integration?.getMetrics(),
    cacheStats: state.integration?.getMediaCacheStats(),
    externalStoragePaths: state.integration?.getExternalStoragePaths(),
  };
}

/**
 * Pi media integration event types for Gateway
 */
export const GATEWAY_PI_MEDIA_EVENTS = {
  FILE_PROCESSED: 'pi.media.fileProcessed',
  MEMORY_MAPPED_FILE_CREATED: 'pi.media.memoryMappedFileCreated',
  STATUS_CHANGED: 'pi.media.statusChanged',
  ERROR: 'pi.media.error',
} as const;