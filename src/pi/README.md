# Raspberry Pi Port

This directory contains the Raspberry Pi-specific implementation of OpenClaw, providing optimized performance and hardware integration for ARM-based Raspberry Pi systems.

## Overview

The Raspberry Pi port maintains full OpenClaw functionality while implementing ARM-specific optimizations, resource management, and embedded system features tailored for Raspberry Pi hardware constraints and capabilities.

## Architecture

```
src/pi/
├── types/                    # TypeScript interfaces and type definitions
│   ├── system-metrics.ts     # SystemMetrics interface
│   ├── pi-configuration.ts   # PiConfiguration interface
│   ├── thermal-policy.ts     # ThermalPolicy interface
│   └── gpio-configuration.ts # GPIOConfiguration interface
├── hardware/                 # Hardware detection and configuration
│   ├── detection.ts          # Pi model and capability detection
│   └── configuration.ts      # Hardware configuration utilities
├── resource-monitor/         # System resource monitoring
├── thermal-controller/       # Temperature management and throttling
├── storage-manager/          # SD card optimization and wear leveling
├── power-manager/           # Power optimization and battery management
├── gpio-interface/          # GPIO access and hardware protocols
├── service-manager/         # systemd integration and service management
├── network-optimizer/       # Network optimization and adaptive networking
└── test-setup.ts           # Property-based testing utilities
```

## Key Features

### Hardware Detection
- Automatic Raspberry Pi model detection
- ARM architecture identification (ARM64/ARMv7)
- Memory configuration and limit enforcement
- GPIO pin availability mapping

### Resource Management
- Hardware-adaptive memory limits (512MB/1GB/2GB based on Pi model)
- CPU, memory, disk I/O, and network monitoring
- Automatic garbage collection triggering at 80% memory usage
- Performance threshold management

### Thermal Management
- Temperature monitoring every 5 seconds
- Progressive CPU throttling (25% at 70°C, 50% at 75°C, pause at 80°C)
- Optional GPIO fan control with PWM
- Thermal event logging and notifications

### Storage Optimization
- SD card wear leveling and write optimization
- RAM-based caching with SD card fallback
- Automatic log rotation (100MB limit)
- tmpfs setup for temporary files
- External USB storage support

### Power Management
- Idle detection and CPU frequency reduction
- Battery power detection and power-saving mode
- Dynamic service scaling based on workload
- Power consumption monitoring

### GPIO Integration
- Secure GPIO pin access with validation
- I2C, SPI, and UART protocol support
- Real-time sensor data integration
- Hardware safety limits and protection

### Service Management
- systemd service file generation
- Dependency-ordered service startup
- Automatic restart with exponential backoff
- Health checks and graceful shutdown (30s timeout)

### Network Optimization
- Connection pooling and keep-alive optimization
- Data compression and QoS prioritization
- Automatic WiFi/Ethernet failover
- Offline message queuing and retry

## Property-Based Testing

The Pi port uses [fast-check](https://github.com/dubzzz/fast-check) for property-based testing to ensure correctness across all possible inputs and configurations.

### Test Categories

1. **Hardware Detection Properties**
   - Model detection consistency
   - Architecture normalization
   - Memory limit enforcement rules
   - GPIO pin validation

2. **Configuration Properties**
   - Thermal policy consistency
   - GPIO configuration validation
   - Memory limit relationships
   - Hardware optimization effects

3. **System Properties**
   - Resource metric consistency
   - Temperature range validation
   - Pin availability relationships
   - Service lifecycle properties

### Running Tests

```bash
# Run all Pi-specific tests
npm test src/pi/

# Run property-based tests with verbose output
npx vitest run src/pi/ --reporter=verbose

# Run specific test files
npx vitest run src/pi/hardware/detection-simple.test.ts
```

## Usage Examples

### Basic Hardware Detection

```typescript
import { detectPiHardware } from './hardware/detection.js';
import { createDefaultThermalPolicy } from './hardware/configuration.js';

// Detect Pi hardware automatically
const config = detectPiHardware();
console.log(`Detected: ${config.model} with ${config.memory.total}MB RAM`);

// Create thermal policy
const thermalPolicy = createDefaultThermalPolicy(config);
```

### Resource Monitoring

```typescript
import { ResourceMonitor } from './resource-monitor/index.js';

const monitor = new ResourceMonitor(config);
monitor.startMonitoring();

const metrics = await monitor.getSystemMetrics();
console.log(`CPU: ${metrics.cpu.usage}%, Temp: ${metrics.cpu.temperature}°C`);
```

### GPIO Control

```typescript
import { GPIOInterface } from './gpio-interface/index.js';
import { createDefaultGPIOConfiguration } from './hardware/configuration.js';

const gpioConfig = createDefaultGPIOConfiguration(config);
const gpio = new GPIOInterface(gpioConfig);

await gpio.initializeGPIO();
await gpio.configurePin(18, 'output');
const sensorValue = await gpio.readSensor(4);
```

## Requirements Mapping

This implementation addresses the following requirements from the design document:

- **Requirement 1.4**: ARM architecture compatibility and native execution
- **Requirement 10.2**: Hardware detection and automatic configuration optimization
- **Requirements 2.1-2.6**: Memory management and optimization
- **Requirements 3.1-3.6**: Storage optimization and wear leveling
- **Requirements 4.1-4.5**: Thermal management and monitoring
- **Requirements 5.1-5.5**: Power efficiency and optimization
- **Requirements 6.1-6.5**: GPIO integration and hardware protocols
- **Requirements 7.1-7.5**: Service management and systemd integration
- **Requirements 8.1-8.5**: Network optimization and failover
- **Requirements 9.1-9.5**: Performance monitoring and alerting

## Development Status

This is the initial project structure setup for Task 1. The following components are implemented as placeholders and will be fully developed in subsequent tasks:

- ✅ Pi-specific directory structure (`src/pi/`)
- ✅ TypeScript interfaces (SystemMetrics, PiConfiguration, ThermalPolicy, GPIOConfiguration)
- ✅ Property-based testing framework with fast-check
- ✅ Pi hardware detection utilities
- 🚧 Resource Monitor component (placeholder)
- 🚧 Thermal Controller component (placeholder)
- 🚧 Storage Manager component (placeholder)
- 🚧 Power Manager component (placeholder)
- 🚧 GPIO Interface component (placeholder)
- 🚧 Service Manager component (placeholder)
- 🚧 Network Optimizer component (placeholder)

## Next Steps

The next tasks will implement the full functionality for each component:

1. **Task 2**: Implement Resource Monitor with system metrics collection
2. **Task 3**: Implement Thermal Controller with temperature monitoring
3. **Task 4**: Implement Storage Manager with SD card optimization
4. **Task 5**: Complete optimization layer checkpoint
5. **Tasks 6-9**: Implement remaining components (Power, GPIO, Service, Network)
6. **Tasks 10-17**: Integration, ARM optimizations, and final system verification

## Contributing

When contributing to the Pi port:

1. Follow the existing TypeScript interfaces and patterns
2. Write property-based tests for all new functionality
3. Ensure hardware detection works across different Pi models
4. Test on actual Raspberry Pi hardware when possible
5. Document any Pi-specific requirements or limitations