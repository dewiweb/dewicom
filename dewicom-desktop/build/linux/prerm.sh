#!/bin/bash
# Script pré-désinstallation DewiCom (deb)
# Supprime les raccourcis menu supplémentaires

DESKTOP_DIR="/usr/share/applications"

rm -f "$DESKTOP_DIR/dewicom-server.desktop"
rm -f "$DESKTOP_DIR/dewicom-server-headless.desktop"

if command -v update-desktop-database &>/dev/null; then
  update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true
fi

exit 0
