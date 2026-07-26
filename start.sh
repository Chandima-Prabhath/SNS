#!/bin/bash
# Start Adoo in production mode (background)
cd "$(dirname "$0")"
echo "Starting Adoo production server..."
NODE_ENV=production nohup bun run server.ts > server.log 2>&1 &
echo $! > .adoo.pid
sleep 2
if kill -0 $(cat .adoo.pid) 2>/dev/null; then
  echo "Adoo is running (PID: $(cat .adoo.pid))"
  echo "Log: server.log"
  echo "Stop: ./stop.sh"
else
  echo "Failed to start. Check server.log"
  exit 1
fi
