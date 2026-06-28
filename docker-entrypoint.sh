#!/bin/sh
set -e

# Default assets location (bundled in the image)
DEFAULT_CANDIDATES="/usr/share/nginx/html/default-assets/candidates"
# Mounted volume location
MOUNTED_CANDIDATES="/usr/share/nginx/html/assets/candidates"

# If the mounted candidates directory is empty, copy default images
if [ -d "$MOUNTED_CANDIDATES" ] && [ -z "$(ls -A "$MOUNTED_CANDIDATES")" ]; then
  echo "Empty candidates directory detected. Copying default images..."
  cp -r "$DEFAULT_CANDIDATES"/* "$MOUNTED_CANDIDATES"/ 2>/dev/null || true
fi

# Execute the main command (nginx)
exec "$@"