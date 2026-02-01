#!/bin/bash

# OpenClaw Raspberry Pi Installation Script
# 
# Automated installation script for OpenClaw on Raspberry Pi.
# Supports all Raspberry Pi OS versions with hardware detection and
# automatic configuration optimization.
# 
# Requirements: 10.1, 10.2 - Installation scripts with hardware detection

set -euo pipefail

# Script configuration
SCRIPT_VERSION="1.0.0"
OPENCLAW_REPO="https://github.com/openclaw/openclaw.git"
INSTALL_DIR="/opt/openclaw"
SERVICE_USER="openclaw"
LOG_FILE="/var/log/openclaw-install.log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}" | tee -a "$LOG_FILE"
}

log_success() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] ✓ $1${NC}" | tee -a "$LOG_FILE"
}

log_warning() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] ⚠ $1${NC}" | tee -a "$LOG_FILE"
}

log_error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ✗ $1${NC}" | tee -a "$LOG_FILE"
}

# Error handling
error_exit() {
    log_error "$1"
    log_error "Installation failed. Check $LOG_FILE for details."
    exit 1
}

# Check if running as root
check_root() {
    if [[ $EUID -ne 0 ]]; then
        error_exit "This script must be run as root. Use: sudo $0"
    fi
}

# Detect Raspberry Pi hardware
detect_pi_hardware() {
    log "Detecting Raspberry Pi hardware..."
    
    # Check if running on Raspberry Pi
    if ! grep -q "Raspberry Pi" /proc/cpuinfo 2>/dev/null; then
        error_exit "This script is designed for Raspberry Pi hardware only"
    fi
    
    # Get Pi model
    PI_MODEL=$(grep "Model" /proc/cpuinfo | cut -d: -f2 | xargs)
    
    # Get architecture
    PI_ARCH=$(uname -m)
    
    # Get memory info
    PI_MEMORY_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}')
    PI_MEMORY_MB=$((PI_MEMORY_KB / 1024))
    
    # Get CPU info
    PI_CPU_COUNT=$(nproc)
    
    # Detect Pi version for optimization
    if echo "$PI_MODEL" | grep -q "Pi 5"; then
        PI_VERSION="5"
        PI_GENERATION="latest"
    elif echo "$PI_MODEL" | grep -q "Pi 4"; then
        PI_VERSION="4"
        PI_GENERATION="modern"
    elif echo "$PI_MODEL" | grep -q "Pi 3"; then
        PI_VERSION="3"
        PI_GENERATION="standard"
    elif echo "$PI_MODEL" | grep -q "Pi 2"; then
        PI_VERSION="2"
        PI_GENERATION="legacy"
    else
        PI_VERSION="1"
        PI_GENERATION="legacy"
    fi
    
    log_success "Hardware detected:"
    log "  Model: $PI_MODEL"
    log "  Architecture: $PI_ARCH"
    log "  Memory: ${PI_MEMORY_MB}MB"
    log "  CPU Cores: $PI_CPU_COUNT"
    log "  Pi Version: $PI_VERSION ($PI_GENERATION)"
}

# Check system requirements
check_requirements() {
    log "Checking system requirements..."
    
    # Check OS version
    if ! command -v lsb_release &> /dev/null; then
        error_exit "lsb_release not found. Please install lsb-release package."
    fi
    
    OS_ID=$(lsb_release -si)
    OS_VERSION=$(lsb_release -sr)
    OS_CODENAME=$(lsb_release -sc)
    
    log "Operating System: $OS_ID $OS_VERSION ($OS_CODENAME)"
    
    # Check if supported OS
    if [[ "$OS_ID" != "Raspbian" && "$OS_ID" != "Debian" ]]; then
        log_warning "Unsupported OS detected. This script is optimized for Raspberry Pi OS/Raspbian."
    fi
    
    # Check minimum memory requirements
    if [[ $PI_MEMORY_MB -lt 512 ]]; then
        log_warning "Low memory detected (${PI_MEMORY_MB}MB). OpenClaw may run slowly."
    fi
    
    # Check available disk space
    AVAILABLE_SPACE_KB=$(df / | tail -1 | awk '{print $4}')
    AVAILABLE_SPACE_MB=$((AVAILABLE_SPACE_KB / 1024))
    
    if [[ $AVAILABLE_SPACE_MB -lt 2048 ]]; then
        error_exit "Insufficient disk space. At least 2GB free space required, found ${AVAILABLE_SPACE_MB}MB"
    fi
    
    log_success "System requirements check passed"
}

# Update system packages
update_system() {
    log "Updating system packages..."
    
    apt-get update -y || error_exit "Failed to update package lists"
    apt-get upgrade -y || error_exit "Failed to upgrade system packages"
    
    log_success "System packages updated"
}

# Install dependencies
install_dependencies() {
    log "Installing dependencies..."
    
    # Essential packages
    local packages=(
        "curl"
        "wget"
        "git"
        "build-essential"
        "python3"
        "python3-pip"
        "nodejs"
        "npm"
        "systemd"
        "sudo"
        "htop"
        "iotop"
        "lsof"
    )
    
    # Pi-specific packages
    if [[ "$PI_GENERATION" == "modern" || "$PI_GENERATION" == "latest" ]]; then
        packages+=("libraspberrypi-dev" "raspberrypi-kernel-headers")
    fi
    
    # Install packages
    for package in "${packages[@]}"; do
        log "Installing $package..."
        if ! apt-get install -y "$package"; then
            log_warning "Failed to install $package, continuing..."
        fi
    done
    
    # Install Node.js LTS if needed
    NODE_VERSION=$(node --version 2>/dev/null | cut -d'v' -f2 | cut -d'.' -f1 || echo "0")
    if [[ $NODE_VERSION -lt 18 ]]; then
        log "Installing Node.js LTS..."
        curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
        apt-get install -y nodejs || error_exit "Failed to install Node.js"
    fi
    
    log_success "Dependencies installed"
}

# Create system user
create_user() {
    log "Creating OpenClaw system user..."
    
    if ! id "$SERVICE_USER" &>/dev/null; then
        useradd --system --home-dir "$INSTALL_DIR" --shell /bin/bash --create-home "$SERVICE_USER" || error_exit "Failed to create user"
        usermod -a -G gpio,i2c,spi "$SERVICE_USER" 2>/dev/null || log_warning "Failed to add user to Pi hardware groups"
        log_success "User $SERVICE_USER created"
    else
        log "User $SERVICE_USER already exists"
    fi
}

# Clone and install OpenClaw
install_openclaw() {
    log "Installing OpenClaw..."
    
    # Create installation directory
    mkdir -p "$INSTALL_DIR"
    
    # Clone repository
    if [[ -d "$INSTALL_DIR/.git" ]]; then
        log "Updating existing OpenClaw installation..."
        cd "$INSTALL_DIR"
        sudo -u "$SERVICE_USER" git pull || error_exit "Failed to update OpenClaw"
    else
        log "Cloning OpenClaw repository..."
        sudo -u "$SERVICE_USER" git clone "$OPENCLAW_REPO" "$INSTALL_DIR" || error_exit "Failed to clone OpenClaw"
        cd "$INSTALL_DIR"
    fi
    
    # Install npm dependencies
    log "Installing Node.js dependencies..."
    sudo -u "$SERVICE_USER" npm ci --production || error_exit "Failed to install npm dependencies"
    
    # Build OpenClaw
    log "Building OpenClaw..."
    sudo -u "$SERVICE_USER" npm run build || error_exit "Failed to build OpenClaw"
    
    log_success "OpenClaw installed"
}

# Configure Pi-specific optimizations
configure_pi_optimizations() {
    log "Configuring Pi-specific optimizations..."
    
    # Create Pi configuration file
    local pi_config_file="$INSTALL_DIR/.openclaw/pi-config.json"
    mkdir -p "$(dirname "$pi_config_file")"
    
    cat > "$pi_config_file" << EOF
{
  "model": "$PI_MODEL",
  "architecture": "$PI_ARCH",
  "memory": {
    "total": $PI_MEMORY_MB,
    "limit": $((PI_MEMORY_MB > 1024 ? PI_MEMORY_MB - 512 : PI_MEMORY_MB * 3 / 4))
  },
  "thermal": {
    "thresholds": [70, 75, 80]
  },
  "storage": {
    "type": "sd",
    "wearLeveling": true
  },
  "gpio": {
    "available": [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27],
    "reserved": [0, 1]
  },
  "optimizations": {
    "resourceMonitoring": true,
    "thermalManagement": true,
    "storageOptimization": true,
    "memoryMappedFiles": $([ $PI_MEMORY_MB -gt 1024 ] && echo "true" || echo "false"),
    "maxConcurrentAgents": $([ $PI_MEMORY_MB -gt 1024 ] && echo "2" || echo "1")
  }
}
EOF
    
    chown "$SERVICE_USER:$SERVICE_USER" "$pi_config_file"
    
    # Configure memory split for GPU (if applicable)
    if [[ "$PI_GENERATION" == "modern" || "$PI_GENERATION" == "latest" ]]; then
        if ! grep -q "gpu_mem=" /boot/config.txt; then
            echo "gpu_mem=64" >> /boot/config.txt
            log "GPU memory split configured"
        fi
    fi
    
    # Configure swap settings for low-memory Pi
    if [[ $PI_MEMORY_MB -le 1024 ]]; then
        log "Configuring swap for low-memory Pi..."
        
        # Reduce swappiness
        echo "vm.swappiness=10" >> /etc/sysctl.conf
        
        # Configure zram if available
        if command -v zramctl &> /dev/null; then
            systemctl enable zramswap 2>/dev/null || true
        fi
    fi
    
    log_success "Pi optimizations configured"
}

# Install systemd service
install_systemd_service() {
    log "Installing systemd service..."
    
    cat > /etc/systemd/system/openclaw.service << EOF
[Unit]
Description=OpenClaw AI Assistant
Documentation=https://github.com/openclaw/openclaw
After=network.target
Wants=network.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR
Environment=NODE_ENV=production
Environment=OPENCLAW_PI_MODE=true
Environment=OPENCLAW_CONFIG_DIR=$INSTALL_DIR/.openclaw
ExecStart=/usr/bin/node $INSTALL_DIR/openclaw.mjs
ExecReload=/bin/kill -HUP \$MAINPID
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=openclaw

# Security settings
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$INSTALL_DIR /var/log /tmp
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true

# Resource limits (adjusted for Pi)
LimitNOFILE=65536
LimitNPROC=4096
$([ $PI_MEMORY_MB -le 1024 ] && echo "MemoryMax=512M" || echo "MemoryMax=1G")

[Install]
WantedBy=multi-user.target
EOF
    
    # Reload systemd and enable service
    systemctl daemon-reload || error_exit "Failed to reload systemd"
    systemctl enable openclaw.service || error_exit "Failed to enable OpenClaw service"
    
    log_success "Systemd service installed"
}

# Configure log rotation
configure_logging() {
    log "Configuring log rotation..."
    
    # Create log directory
    mkdir -p /var/log/openclaw
    chown "$SERVICE_USER:$SERVICE_USER" /var/log/openclaw
    
    # Configure logrotate
    cat > /etc/logrotate.d/openclaw << EOF
/var/log/openclaw/*.log {
    daily
    missingok
    rotate 7
    compress
    delaycompress
    notifempty
    create 644 $SERVICE_USER $SERVICE_USER
    postrotate
        systemctl reload openclaw.service > /dev/null 2>&1 || true
    endscript
    # Pi-specific: Limit total log size to 50MB
    maxsize 50M
    # Use tmpfs for active logs if available
    copytruncate
}
EOF
    
    log_success "Log rotation configured"
}

# Setup tmpfs for temporary files
setup_tmpfs() {
    log "Setting up tmpfs for temporary files..."
    
    local tmpfs_size
    if [[ $PI_MEMORY_MB -le 512 ]]; then
        tmpfs_size="32M"
    elif [[ $PI_MEMORY_MB -le 1024 ]]; then
        tmpfs_size="64M"
    else
        tmpfs_size="128M"
    fi
    
    # Add tmpfs mount to fstab if not already present
    if ! grep -q "/tmp/openclaw" /etc/fstab; then
        echo "tmpfs /tmp/openclaw tmpfs defaults,size=$tmpfs_size,uid=$(id -u $SERVICE_USER),gid=$(id -g $SERVICE_USER) 0 0" >> /etc/fstab
        mkdir -p /tmp/openclaw
        mount /tmp/openclaw || log_warning "Failed to mount tmpfs, will be available after reboot"
        log_success "Tmpfs configured ($tmpfs_size)"
    else
        log "Tmpfs already configured"
    fi
}

# Perform final checks
final_checks() {
    log "Performing final installation checks..."
    
    # Check if OpenClaw binary exists
    if [[ ! -f "$INSTALL_DIR/openclaw.mjs" ]]; then
        error_exit "OpenClaw binary not found at $INSTALL_DIR/openclaw.mjs"
    fi
    
    # Check if service is properly installed
    if ! systemctl is-enabled openclaw.service &>/dev/null; then
        error_exit "OpenClaw service is not enabled"
    fi
    
    # Test configuration
    if ! sudo -u "$SERVICE_USER" node -c "$INSTALL_DIR/openclaw.mjs" 2>/dev/null; then
        log_warning "OpenClaw configuration test failed, but installation completed"
    fi
    
    log_success "Final checks completed"
}

# Print installation summary
print_summary() {
    log_success "OpenClaw installation completed successfully!"
    echo
    echo "=========================================="
    echo "         Installation Summary"
    echo "=========================================="
    echo "Pi Model: $PI_MODEL"
    echo "Architecture: $PI_ARCH"
    echo "Memory: ${PI_MEMORY_MB}MB"
    echo "Install Directory: $INSTALL_DIR"
    echo "Service User: $SERVICE_USER"
    echo "Log File: $LOG_FILE"
    echo
    echo "Next Steps:"
    echo "1. Configure OpenClaw: sudo -u $SERVICE_USER $INSTALL_DIR/openclaw.mjs configure"
    echo "2. Start the service: sudo systemctl start openclaw"
    echo "3. Check status: sudo systemctl status openclaw"
    echo "4. View logs: sudo journalctl -u openclaw -f"
    echo
    echo "Pi-specific optimizations have been automatically configured."
    echo "Reboot recommended to apply all system changes."
    echo "=========================================="
}

# Main installation function
main() {
    log "Starting OpenClaw Raspberry Pi installation (v$SCRIPT_VERSION)..."
    
    check_root
    detect_pi_hardware
    check_requirements
    update_system
    install_dependencies
    create_user
    install_openclaw
    configure_pi_optimizations
    install_systemd_service
    configure_logging
    setup_tmpfs
    final_checks
    print_summary
    
    log_success "Installation completed successfully!"
}

# Run main function
main "$@"