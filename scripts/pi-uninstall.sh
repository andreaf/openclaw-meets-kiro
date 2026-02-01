#!/bin/bash

# OpenClaw Raspberry Pi Uninstallation Script
# 
# Safely removes OpenClaw from Raspberry Pi with cleanup of all
# Pi-specific configurations and optimizations.

set -euo pipefail

# Script configuration
SCRIPT_VERSION="1.0.0"
INSTALL_DIR="/opt/openclaw"
SERVICE_USER="openclaw"
LOG_FILE="/var/log/openclaw-uninstall.log"

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
    log_error "Uninstallation failed. Check $LOG_FILE for details."
    exit 1
}

# Check if running as root
check_root() {
    if [[ $EUID -ne 0 ]]; then
        error_exit "This script must be run as root. Use: sudo $0"
    fi
}

# Confirm uninstallation
confirm_uninstall() {
    echo -e "${YELLOW}WARNING: This will completely remove OpenClaw and all its data.${NC}"
    echo -e "${YELLOW}This action cannot be undone.${NC}"
    echo
    read -p "Are you sure you want to uninstall OpenClaw? (yes/no): " -r
    echo
    
    if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
        log "Uninstallation cancelled by user"
        exit 0
    fi
}

# Stop and disable service
stop_service() {
    log "Stopping OpenClaw service..."
    
    if systemctl is-active openclaw.service &>/dev/null; then
        systemctl stop openclaw.service || log_warning "Failed to stop service"
        log_success "Service stopped"
    else
        log "Service is not running"
    fi
    
    if systemctl is-enabled openclaw.service &>/dev/null; then
        systemctl disable openclaw.service || log_warning "Failed to disable service"
        log_success "Service disabled"
    else
        log "Service is not enabled"
    fi
}

# Remove systemd service
remove_systemd_service() {
    log "Removing systemd service..."
    
    if [[ -f /etc/systemd/system/openclaw.service ]]; then
        rm -f /etc/systemd/system/openclaw.service || log_warning "Failed to remove service file"
        systemctl daemon-reload || log_warning "Failed to reload systemd"
        log_success "Systemd service removed"
    else
        log "Systemd service file not found"
    fi
}

# Remove installation directory
remove_installation() {
    log "Removing OpenClaw installation..."
    
    if [[ -d "$INSTALL_DIR" ]]; then
        # Create backup if requested
        read -p "Create backup of configuration files? (y/n): " -r
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            local backup_dir="/tmp/openclaw-backup-$(date +%Y%m%d-%H%M%S)"
            mkdir -p "$backup_dir"
            
            if [[ -d "$INSTALL_DIR/.openclaw" ]]; then
                cp -r "$INSTALL_DIR/.openclaw" "$backup_dir/" || log_warning "Failed to backup configuration"
                log_success "Configuration backed up to $backup_dir"
            fi
        fi
        
        rm -rf "$INSTALL_DIR" || error_exit "Failed to remove installation directory"
        log_success "Installation directory removed"
    else
        log "Installation directory not found"
    fi
}

# Remove system user
remove_user() {
    log "Removing system user..."
    
    if id "$SERVICE_USER" &>/dev/null; then
        userdel "$SERVICE_USER" || log_warning "Failed to remove user"
        log_success "User $SERVICE_USER removed"
    else
        log "User $SERVICE_USER not found"
    fi
}

# Remove log files
remove_logs() {
    log "Removing log files..."
    
    if [[ -d /var/log/openclaw ]]; then
        rm -rf /var/log/openclaw || log_warning "Failed to remove log directory"
        log_success "Log directory removed"
    fi
    
    # Remove logrotate configuration
    if [[ -f /etc/logrotate.d/openclaw ]]; then
        rm -f /etc/logrotate.d/openclaw || log_warning "Failed to remove logrotate configuration"
        log_success "Logrotate configuration removed"
    fi
}

# Remove tmpfs configuration
remove_tmpfs() {
    log "Removing tmpfs configuration..."
    
    # Unmount tmpfs if mounted
    if mountpoint -q /tmp/openclaw 2>/dev/null; then
        umount /tmp/openclaw || log_warning "Failed to unmount tmpfs"
        log_success "Tmpfs unmounted"
    fi
    
    # Remove from fstab
    if grep -q "/tmp/openclaw" /etc/fstab; then
        sed -i '/\/tmp\/openclaw/d' /etc/fstab || log_warning "Failed to remove tmpfs from fstab"
        log_success "Tmpfs removed from fstab"
    fi
    
    # Remove directory
    if [[ -d /tmp/openclaw ]]; then
        rmdir /tmp/openclaw 2>/dev/null || log_warning "Failed to remove tmpfs directory"
    fi
}

# Clean up Pi-specific configurations
cleanup_pi_config() {
    log "Cleaning up Pi-specific configurations..."
    
    # Remove GPU memory split if we added it
    if grep -q "^gpu_mem=64$" /boot/config.txt; then
        read -p "Remove GPU memory configuration from /boot/config.txt? (y/n): " -r
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            sed -i '/^gpu_mem=64$/d' /boot/config.txt || log_warning "Failed to remove GPU memory configuration"
            log_success "GPU memory configuration removed"
        fi
    fi
    
    # Remove swappiness setting if we added it
    if grep -q "vm.swappiness=10" /etc/sysctl.conf; then
        read -p "Remove swappiness configuration from /etc/sysctl.conf? (y/n): " -r
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            sed -i '/vm.swappiness=10/d' /etc/sysctl.conf || log_warning "Failed to remove swappiness configuration"
            log_success "Swappiness configuration removed"
        fi
    fi
}

# Remove dependencies (optional)
remove_dependencies() {
    read -p "Remove installed dependencies? This may affect other applications. (y/n): " -r
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log "Skipping dependency removal"
        return
    fi
    
    log "Removing dependencies..."
    
    local packages=(
        "nodejs"
        "npm"
    )
    
    for package in "${packages[@]}"; do
        if dpkg -l | grep -q "^ii.*$package"; then
            apt-get remove -y "$package" || log_warning "Failed to remove $package"
            log "Removed $package"
        fi
    done
    
    # Clean up unused packages
    apt-get autoremove -y || log_warning "Failed to autoremove packages"
    log_success "Dependencies cleaned up"
}

# Final cleanup
final_cleanup() {
    log "Performing final cleanup..."
    
    # Remove any remaining OpenClaw processes
    pkill -f openclaw 2>/dev/null || true
    
    # Clean up any remaining temporary files
    find /tmp -name "*openclaw*" -type f -delete 2>/dev/null || true
    
    log_success "Final cleanup completed"
}

# Print uninstallation summary
print_summary() {
    log_success "OpenClaw uninstallation completed!"
    echo
    echo "=========================================="
    echo "       Uninstallation Summary"
    echo "=========================================="
    echo "✓ Service stopped and disabled"
    echo "✓ Installation directory removed"
    echo "✓ System user removed"
    echo "✓ Log files removed"
    echo "✓ Tmpfs configuration removed"
    echo "✓ Pi-specific configurations cleaned"
    echo
    echo "OpenClaw has been completely removed from your system."
    echo "A reboot is recommended to ensure all changes take effect."
    echo "=========================================="
}

# Main uninstallation function
main() {
    log "Starting OpenClaw Raspberry Pi uninstallation (v$SCRIPT_VERSION)..."
    
    check_root
    confirm_uninstall
    stop_service
    remove_systemd_service
    remove_installation
    remove_user
    remove_logs
    remove_tmpfs
    cleanup_pi_config
    remove_dependencies
    final_cleanup
    print_summary
    
    log_success "Uninstallation completed successfully!"
}

# Run main function
main "$@"