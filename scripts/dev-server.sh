#!/usr/bin/env bash
#
# Robust start/stop for the vagus dev server, safe for agents and humans.
#
# Uses `setsid` so the server runs in its own session/process-group, fully
# detached from the calling shell (survives the shell exiting, no nohup/disown).
# A pidfile tracks the session leader; stop signals the whole process group so
# the child processes are cleaned up properly. Logs go to a file (never blocks).
#

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PIDFILE="$ROOT/.dev-server.pid"
LOGFILE="$ROOT/.dev-server.log"

get_port() {
  if [ -n "${PASEO_PORT:-}" ]; then
    echo "$PASEO_PORT"
  elif [ -n "${PORT:-}" ]; then
    echo "$PORT"
  else
    bun "$ROOT/scripts/port-allocator.ts" 2>/dev/null || echo "4324"
  fi
}

SERVER_PORT="$(get_port)"

is_running() {
  [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null
}

is_server_on_port() {
  curl --fail --silent --max-time 1 "http://localhost:$SERVER_PORT/healthz" \
    | grep --quiet '"status":"ok"' 2>/dev/null
}

show_server_info() {
  local pid="${1:-}"

  if [ -n "$pid" ]; then
    echo "dev server already running (pid $pid) -> http://localhost:$SERVER_PORT  port: $SERVER_PORT  logs: $LOGFILE"
  else
    echo "dev server already running -> http://localhost:$SERVER_PORT  port: $SERVER_PORT (unmanaged; no pidfile or log path)"
  fi
}

case "${1:-}" in
  start)
    if is_running; then
      show_server_info "$(cat "$PIDFILE")"
      exit 0
    fi
    rm -f "$PIDFILE"
    if is_server_on_port; then
      show_server_info
      exit 0
    fi
    if [ "${2:-}" = "--foreground" ]; then
      cd "$ROOT"
      exec env PORT="$SERVER_PORT" bun apps/server/src/index.ts
    fi
    : > "$LOGFILE"
    PORT="$SERVER_PORT" setsid bash -c 'cd "'"$ROOT"'" && exec bun apps/server/src/index.ts' \
      >> "$LOGFILE" 2>&1 &
    echo $! > "$PIDFILE"
    
    # Poll for server health (up to 5 seconds)
    HEALTHY=0
    for i in {1..10}; do
      sleep 0.5
      if is_server_on_port; then
        HEALTHY=1
        break
      fi
      if ! is_running; then
        break
      fi
    done

    if [ "$HEALTHY" -eq 1 ]; then
      echo "dev server started (pid $(cat "$PIDFILE")) -> http://localhost:$SERVER_PORT  port: $SERVER_PORT  logs: $LOGFILE"
    else
      echo "dev server failed to start or health check timed out; last log lines:"
      tail -n 20 "$LOGFILE"
      if [ -f "$PIDFILE" ]; then
        pid="$(cat "$PIDFILE")"
        kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
        rm -f "$PIDFILE"
      fi
      exit 1
    fi
    ;;

  stop)
    if [ -f "$PIDFILE" ]; then
      pid="$(cat "$PIDFILE")"
      kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
      rm -f "$PIDFILE"
      echo "dev server stopped"
    elif is_server_on_port; then
      fuser -k "${SERVER_PORT}/tcp" 2>/dev/null || true
      echo "dev server stopped on port $SERVER_PORT"
    else
      echo "dev server not running"
    fi
    ;;

  restart)
    "$0" stop
    "$0" start
    ;;

  status)
    if is_running; then
      show_server_info "$(cat "$PIDFILE")"
    elif is_server_on_port; then
      show_server_info
    else
      echo "stopped"
    fi
    ;;

  logs)
    tail -n "${2:-80}" "$LOGFILE" 2>/dev/null || echo "no log file yet"
    ;;

  *)
    echo "usage: $0 {start [--foreground]|stop|restart|status|logs [N]}"
    exit 1
    ;;
esac
