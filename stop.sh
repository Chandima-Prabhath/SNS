#!/bin/bash
# Stop Adoo production server
cd "$(dirname "$0")"
if [ -f .adoo.pid ]; then
  PID=$(cat .adoo.pid)
  if kill -0 "$PID" 2>/dev/null; then
    echo "Stopping Adoo (PID: $PID)..."
    kill "$PID"
    sleep 1
    if kill -0 "$PID" 2>/dev/null; then
      echo "Force killing..."
      kill -9 "$PID"
    fi
    echo "Adoo stopped."
  else
    echo "Adoo is not running."
  fi
  rm -f .adoo.pid
else
  echo "No PID file found. Adoo is not running."
fi
