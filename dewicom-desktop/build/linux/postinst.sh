#!/bin/bash
# Script post-installation DewiCom (deb)
# Installe les raccourcis menu supplémentaires pour les modes serveur

DESKTOP_DIR="/usr/share/applications"
ICON_DIR="/usr/share/icons/hicolor/512x512/apps"

# Raccourci mode --server
cat > "$DESKTOP_DIR/dewicom-server.desktop" << 'EOF'
[Desktop Entry]
Name=DewiCom Server
GenericName=PTT Server
Comment=DewiCom — serveur dédié (mode --server)
Exec=/usr/bin/dewicom --server
Icon=dewicom
Terminal=false
Type=Application
Categories=AudioVideo;Audio;Network;
Keywords=PTT;radio;intercom;server;
StartupNotify=false
EOF

# Raccourci mode --server --headless
cat > "$DESKTOP_DIR/dewicom-server-headless.desktop" << 'EOF'
[Desktop Entry]
Name=DewiCom Server (headless)
GenericName=PTT Server Daemon
Comment=DewiCom — serveur daemon sans fenêtre (mode --server --headless)
Exec=/usr/bin/dewicom --server --headless
Icon=dewicom
Terminal=false
Type=Application
Categories=AudioVideo;Audio;Network;
Keywords=PTT;radio;intercom;server;daemon;headless;
StartupNotify=false
EOF

# Met à jour le cache des entrées du menu
if command -v update-desktop-database &>/dev/null; then
  update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true
fi

exit 0
