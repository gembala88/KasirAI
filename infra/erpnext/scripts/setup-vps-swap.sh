#!/usr/bin/env bash
# Adds a 2 GB swap file as a safety buffer against memory spikes on the
# 2 vCPU / 2 GB RAM VPS (spec §13). Run once during VPS provisioning, before
# `docker compose up`. Requires root (sudo).
#
# Usage: sudo bash infra/erpnext/scripts/setup-vps-swap.sh
set -euo pipefail

SWAP_FILE="/swapfile"
SWAP_SIZE_GB=2

if swapon --show | grep -q "$SWAP_FILE"; then
  echo "Swap file $SWAP_FILE is already active, nothing to do."
  exit 0
fi

if [ -f "$SWAP_FILE" ]; then
  echo "Found existing $SWAP_FILE but it is not active — enabling it."
else
  echo "Allocating ${SWAP_SIZE_GB}G swap file at $SWAP_FILE..."
  fallocate -l "${SWAP_SIZE_GB}G" "$SWAP_FILE" || dd if=/dev/zero of="$SWAP_FILE" bs=1M count=$((SWAP_SIZE_GB * 1024))
  chmod 600 "$SWAP_FILE"
  mkswap "$SWAP_FILE"
fi

swapon "$SWAP_FILE"

if ! grep -q "^$SWAP_FILE " /etc/fstab; then
  echo "$SWAP_FILE none swap sw 0 0" >> /etc/fstab
  echo "Added $SWAP_FILE to /etc/fstab so it persists across reboots."
fi

# Conservative swappiness: prefer RAM, only swap under real pressure.
sysctl -w vm.swappiness=10
if ! grep -q "^vm.swappiness" /etc/sysctl.conf 2>/dev/null; then
  echo "vm.swappiness=10" >> /etc/sysctl.conf
fi

echo "Swap enabled:"
swapon --show
