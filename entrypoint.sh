#!/bin/sh
set -e

PUID=${PUID:-0}
PGID=${PGID:-0}

if [ "$PUID" != "0" ] || [ "$PGID" != "0" ]; then
  # Create group if the GID doesn't already exist
  if ! getent group "$PGID" > /dev/null 2>&1; then
    addgroup -g "$PGID" appgroup
  fi

  # Create user if the UID doesn't already exist
  if ! getent passwd "$PUID" > /dev/null 2>&1; then
    GNAME=$(getent group "$PGID" | cut -d: -f1)
    adduser -u "$PUID" -G "$GNAME" -H -D appuser
  fi

  # Fix ownership of writable volumes
  chown -R "$PUID:$PGID" /app/data /app/uploads

  exec su-exec "$PUID:$PGID" node /app/src/server.js
else
  exec node /app/src/server.js
fi
