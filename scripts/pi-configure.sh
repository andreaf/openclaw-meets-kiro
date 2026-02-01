#!/bin/bash

# OpenClaw Raspberry Pi Configuration Script
# 
# Configures OpenClaw for optimal performance on Raspberry Pi hardware.
# Detects hardware capabilities and applies appropriate optimizations.

set -euo pipefail

# Script configuration
SCRIPT_VERSION="1.0.0"
INSTALL_DIR="/opt/openclaw"
SERVICE_USER="openclaw"
CONFIG_DIR="$INSTALL_DIR/.openclaw"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log() {
    echo -e "${BLUE}[INFO] $1${NC}"
}

log_success() {
    echo -e "${GREEN}[SUCCESS] $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}[WARNING] $1${NC}"
}

log_error() {
    echo -e "${RED}[ERROR] $1${NC}"
}

# Check if running as OpenClaw user or root
check_permissions() {
    if [[ $EUID -eq 0 ]]; then
        # Running as root, switch to service user for file operations
        SUDO_CMD="sudo -u $SERVICE_USER"
    elif [[ "$(whoami)" == "$SERVICE_USER" ]]; then
        # Running as service user
        SUDO_CMD=""
    else
        log_error "This script must be run as root or as the $SERVICE_USER user"
        exit 1
    fi
}

# Detect Pi hardware configuration
detect_hardware() {
    log "Detecting Raspberry Pi hardware configuration..."
    
    # Get Pi model
    PI_MODEL=$(grep "Model" /proc/cpuinfo | cut -d: -f2 | xargs)
    
    # Get architecture
    PI_ARCH=$(uname -m)
    
    # Get memory info
    PI_MEMORY_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}')
    PI_MEMORY_MB=$((PI_MEMORY_KB / 1024))
    
    # Get CPU info
    PI_CPU_COUNT=$(nproc)
    PI_CPU_FREQ=$(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_max_freq 2>/dev/null || echo "unknown")
    
    # Get temperature
    PI_TEMP=$(cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo "0")
    PI_TEMP_C=$((PI_TEMP / 1000))
    
    # Detect Pi generation
    if echo "$PI_MODEL" | grep -q "Pi 5"; then
        PI_GENERATION="5"
        PI_CLASS="latest"
    elif echo "$PI_MODEL" | grep -q "Pi 4"; then
        PI_GENERATION="4"
        PI_CLASS="modern"
    elif echo "$PI_MODEL" | grep -q "Pi 3"; then
        PI_GENERATION="3"
        PI_CLASS="standard"
    elif echo "$PI_MODEL" | grep -q "Pi 2"; then
        PI_GENERATION="2"
        PI_CLASS="legacy"
    else
        PI_GENERATION="1"
        PI_CLASS="legacy"
    fi
    
    # Check for hardware features
    HAS_WIFI=$(iwconfig 2>/dev/null | grep -q "IEEE 802.11" && echo "true" || echo "false")
    HAS_BLUETOOTH=$(hciconfig 2>/dev/null | grep -q "hci" && echo "true" || echo "false")
    HAS_CAMERA=$(vcgencmd get_camera 2>/dev/null | grep -q "detected=1" && echo "true" || echo "false")
    
    log_success "Hardware detection completed:"
    log "  Model: $PI_MODEL"
    log "  Generation: Pi $PI_GENERATION ($PI_CLASS)"
    log "  Architecture: $PI_ARCH"
    log "  Memory: ${PI_MEMORY_MB}MB"
    log "  CPU Cores: $PI_CPU_COUNT"
    log "  Current Temperature: ${PI_TEMP_C}°C"
    log "  WiFi: $HAS_WIFI"
    log "  Bluetooth: $HAS_BLUETOOTH"
    log "  Camera: $HAS_CAMERA"
}

# Generate optimized configuration
generate_config() {
    log "Generating optimized configuration..."
    
    # Create config directory
    $SUDO_CMD mkdir -p "$CONFIG_DIR"
    
    # Calculate optimal settings based on hardware
    local memory_limit
    if [[ $PI_MEMORY_MB -le 512 ]]; then
        memory_limit=$((PI_MEMORY_MB * 2 / 3))  # Use 2/3 of available memory
    elif [[ $PI_MEMORY_MB -le 1024 ]]; then
        memory_limit=$((PI_MEMORY_MB * 3 / 4))  # Use 3/4 of available memory
    else
        memory_limit=$((PI_MEMORY_MB - 512))    # Leave 512MB for system
    fi
    
    local max_concurrent_agents
    if [[ $PI_MEMORY_MB -le 512 ]]; then
        max_concurrent_agents=1
    elif [[ $PI_MEMORY_MB -le 1024 ]]; then
        max_concurrent_agents=1
    else
        max_concurrent_agents=2
    fi
    
    local thermal_thresholds
    if [[ "$PI_CLASS" == "latest" ]]; then
        thermal_thresholds="[75, 80, 85]"  # Pi 5 can handle higher temps
    elif [[ "$PI_CLASS" == "modern" ]]; then
        thermal_thresholds="[70, 75, 80]"  # Pi 4 standard thresholds
    else
        thermal_thresholds="[65, 70, 75]"  # Older Pi models run hotter
    fi
    
    # Generate main Pi configuration
    cat > "$CONFIG_DIR/pi-config.json" << EOF
{
  "model": "$PI_MODEL",
  "generation": "$PI_GENERATION",
  "class": "$PI_CLASS",
  "architecture": "$PI_ARCH",
  "memory": {
    "total": $PI_MEMORY_MB,
    "limit": $memory_limit
  },
  "cpu": {
    "cores": $PI_CPU_COUNT,
    "maxFrequency": "$PI_CPU_FREQ"
  },
  "thermal": {
    "thresholds": $thermal_thresholds,
    "monitoringInterval": 5000
  },
  "storage": {
    "type": "sd",
    "wearLeveling": true,
    "tmpfsSize": "$([ $PI_MEMORY_MB -le 512 ] && echo "32M" || [ $PI_MEMORY_MB -le 1024 ] && echo "64M" || echo "128M")"
  },
  "gpio": {
    "available": [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27],
    "reserved": [0, 1]
  },
  "hardware": {
    "wifi": $HAS_WIFI,
    "bluetooth": $HAS_BLUETOOTH,
    "camera": $HAS_CAMERA
  },
  "optimizations": {
    "resourceMonitoring": {
      "enabled": true,
      "interval": 10000,
      "memoryThreshold": 0.8,
      "cpuThreshold": 0.85
    },
    "thermalManagement": {
      "enabled": true,
      "interval": 5000,
      "throttleTemperature": $(echo "$thermal_thresholds" | jq '.[0]'),
      "pauseTemperature": $(echo "$thermal_thresholds" | jq '.[2]')
    },
    "storageOptimization": {
      "enabled": true,
      "maxLogSize": "50MB",
      "rotationInterval": "daily",
      "compressionEnabled": true
    },
    "memoryMappedFiles": {
      "enabled": $([ $PI_MEMORY_MB -gt 1024 ] && echo "true" || echo "false"),
      "minFileSize": "50MB",
      "maxMappedSize": "$([ $PI_MEMORY_MB -le 1024 ] && echo "100MB" || echo "200MB")"
    },
    "agentOptimization": {
      "maxConcurrentAgents": $max_concurrent_agents,
      "preferLightweightModels": $([ $PI_MEMORY_MB -le 1024 ] && echo "true" || echo "false"),
      "reduceContextWindow": $([ $PI_MEMORY_MB -le 512 ] && echo "true" || echo "false")
    }
  }
}
EOF
    
    # Set proper ownership
    if [[ $EUID -eq 0 ]]; then
        chown -R "$SERVICE_USER:$SERVICE_USER" "$CONFIG_DIR"
    fi
    
    log_success "Configuration generated at $CONFIG_DIR/pi-config.json"
}

# Generate performance tuning configuration
generate_performance_config() {
    log "Generating performance tuning configuration..."
    
    cat > "$CONFIG_DIR/performance.json" << EOF
{
  "cpu": {
    "governor": "$([ "$PI_CLASS" == "latest" ] && echo "performance" || echo "ondemand")",
    "scaling": {
      "enabled": true,
      "upThreshold": 80,
      "downThreshold": 20
    }
  },
  "memory": {
    "swappiness": $([ $PI_MEMORY_MB -le 1024 ] && echo "10" || echo "60"),
    "cacheStrategy": "$([ $PI_MEMORY_MB -le 512 ] && echo "conservative" || echo "aggressive")",
    "gcSettings": {
      "maxOldSpaceSize": $([ $PI_MEMORY_MB -le 512 ] && echo "256" || [ $PI_MEMORY_MB -le 1024 ] && echo "512" || echo "1024")
    }
  },
  "network": {
    "tcpOptimization": true,
    "bufferSizes": {
      "receive": $([ $PI_MEMORY_MB -le 512 ] && echo "65536" || echo "131072"),
      "send": $([ $PI_MEMORY_MB -le 512 ] && echo "65536" || echo "131072")
    }
  },
  "io": {
    "scheduler": "$([ "$PI_CLASS" == "latest" ] && echo "mq-deadline" || echo "deadline")",
    "readAhead": $([ $PI_MEMORY_MB -le 512 ] && echo "128" || echo "256")
  }
}
EOF
    
    log_success "Performance configuration generated"
}

# Generate monitoring configuration
generate_monitoring_config() {
    log "Generating monitoring configuration..."
    
    cat > "$CONFIG_DIR/monitoring.json" << EOF
{
  "metrics": {
    "enabled": true,
    "interval": 30000,
    "retention": "7d"
  },
  "alerts": {
    "temperature": {
      "warning": $(echo "$thermal_thresholds" | jq '.[0]'),
      "critical": $(echo "$thermal_thresholds" | jq '.[1]')
    },
    "memory": {
      "warning": 0.8,
      "critical": 0.9
    },
    "cpu": {
      "warning": 0.8,
      "critical": 0.9
    },
    "storage": {
      "warning": 0.8,
      "critical": 0.9
    }
  },
  "logging": {
    "level": "$([ "$PI_CLASS" == "legacy" ] && echo "warn" || echo "info")",
    "maxSize": "10MB",
    "maxFiles": 5,
    "compress": true
  }
}
EOF
    
    log_success "Monitoring configuration generated"
}

# Apply system-level optimizations
apply_system_optimizations() {
    if [[ $EUID -ne 0 ]]; then
        log_warning "Skipping system optimizations (requires root privileges)"
        return
    fi
    
    log "Applying system-level optimizations..."
    
    # CPU governor
    local cpu_governor
    if [[ "$PI_CLASS" == "latest" ]]; then
        cpu_governor="performance"
    else
        cpu_governor="ondemand"
    fi
    
    echo "$cpu_governor" > /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor 2>/dev/null || log_warning "Failed to set CPU governor"
    
    # Memory optimizations
    if [[ $PI_MEMORY_MB -le 1024 ]]; then
        echo 10 > /proc/sys/vm/swappiness 2>/dev/null || log_warning "Failed to set swappiness"
    fi
    
    # I/O scheduler
    local io_scheduler
    if [[ "$PI_CLASS" == "latest" ]]; then
        io_scheduler="mq-deadline"
    else
        io_scheduler="deadline"
    fi
    
    echo "$io_scheduler" > /sys/block/mmcblk0/queue/scheduler 2>/dev/null || log_warning "Failed to set I/O scheduler"
    
    log_success "System optimizations applied"
}

# Test configuration
test_configuration() {
    log "Testing configuration..."
    
    # Check if config files are valid JSON
    for config_file in "$CONFIG_DIR"/*.json; do
        if [[ -f "$config_file" ]]; then
            if ! $SUDO_CMD python3 -m json.tool "$config_file" > /dev/null 2>&1; then
                log_error "Invalid JSON in $config_file"
                return 1
            fi
        fi
    done
    
    # Test if OpenClaw can load the configuration
    if [[ -f "$INSTALL_DIR/openclaw.mjs" ]]; then
        if ! $SUDO_CMD timeout 10s node -e "
            process.env.OPENCLAW_PI_MODE = 'true';
            process.env.OPENCLAW_CONFIG_DIR = '$CONFIG_DIR';
            require('$INSTALL_DIR/openclaw.mjs');
            console.log('Configuration test passed');
        " 2>/dev/null; then
            log_warning "Configuration test failed, but files were generated"
        else
            log_success "Configuration test passed"
        fi
    fi
}

# Print configuration summary
print_summary() {
    log_success "Pi configuration completed!"
    echo
    echo "=========================================="
    echo "      Configuration Summary"
    echo "=========================================="
    echo "Pi Model: $PI_MODEL"
    echo "Generation: Pi $PI_GENERATION ($PI_CLASS)"
    echo "Memory Limit: ${memory_limit}MB (of ${PI_MEMORY_MB}MB total)"
    echo "Max Concurrent Agents: $max_concurrent_agents"
    echo "Thermal Thresholds: $thermal_thresholds"
    echo "Memory-Mapped Files: $([ $PI_MEMORY_MB -gt 1024 ] && echo "Enabled" || echo "Disabled")"
    echo
    echo "Configuration files created:"
    echo "  - $CONFIG_DIR/pi-config.json"
    echo "  - $CONFIG_DIR/performance.json"
    echo "  - $CONFIG_DIR/monitoring.json"
    echo
    echo "To apply the configuration:"
    echo "  sudo systemctl restart openclaw"
    echo "=========================================="
}

# Main configuration function
main() {
    log "Starting OpenClaw Pi configuration (v$SCRIPT_VERSION)..."
    
    check_permissions
    detect_hardware
    generate_config
    generate_performance_config
    generate_monitoring_config
    apply_system_optimizations
    test_configuration
    print_summary
    
    log_success "Configuration completed successfully!"
}

# Run main function
main "$@"