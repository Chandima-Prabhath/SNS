#!/bin/bash
# Setup swap space for low-RAM VPS (1GB Azure VM)
# Run once: sudo bash scripts/setup-swap.sh

set -e

SWAP_SIZE="${1:-2G}"
SWAP_FILE="/swapfile"

echo "=== Setting up ${SWAP_SIZE} swap file at ${SWAP_FILE} ==="

# Check if swap already exists
if swapon --show | grep -q "${SWAP_FILE}"; then
  echo "Swap already active at ${SWAP_FILE}:"
  swapon --show
  exit 0
fi

# Create swap file
sudo fallocate -l "${SWAP_SIZE}" "${SWAP_FILE}"
sudo chmod 600 "${SWAP_FILE}"
sudo mkswap "${SWAP_FILE}"
sudo swapon "${SWAP_FILE}"

# Make it persistent across reboots
if ! grep -q "${SWAP_FILE}" /etc/fstab; then
  echo "${SWAP_FILE} none swap sw 0 0" | sudo tee -a /etc/fstab > /dev/null
fi

# Optimize swap settings for low-RAM server
echo "vm.swappiness=10" | sudo tee -a /etc/sysctl.conf > /dev/null
echo "vm.vfs_cache_pressure=50" | sudo tee -a /etc/sysctl.conf > /dev/null
sudo sysctl -p

echo ""
echo "=== Swap is now active ==="
swapon --show
free -h
echo ""
echo "Done. Next.js builds should no longer OOM."
