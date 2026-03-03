; Script NSIS personnalisé — DewiCom
; Crée les règles pare-feu Windows nécessaires au multicast UDP

!macro customInstall
  ; Règle entrante UDP 9999 — découverte multicast DewiCom
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="DewiCom UDP 9999 IN"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="DewiCom UDP 9999 IN" dir=in action=allow protocol=UDP localport=9999 description="DewiCom multicast discovery"'

  ; Règle entrante UDP 9998 — élection de leader DewiCom
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="DewiCom UDP 9998 IN"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="DewiCom UDP 9998 IN" dir=in action=allow protocol=UDP localport=9998 description="DewiCom leader election"'

  ; Règle entrante TCP 3001 — serveur HTTP DewiCom
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="DewiCom TCP 3001 IN"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="DewiCom TCP 3001 IN" dir=in action=allow protocol=TCP localport=3001 description="DewiCom local server"'

  ; Règle pour l'exécutable lui-même (sortante + entrante)
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="DewiCom App"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="DewiCom App" dir=in action=allow program="$INSTDIR\DewiCom.exe" enable=yes description="DewiCom application"'

  ; Raccourcis Menu Démarrer supplémentaires (modes serveur)
  ; electron-builder crée déjà "DewiCom" dans $SMPROGRAMS\DewiCom\
  CreateShortCut "$SMPROGRAMS\DewiCom\DewiCom Server.lnk" "$INSTDIR\DewiCom.exe" "--server" "$INSTDIR\DewiCom.exe" 0 SW_SHOWNORMAL
  CreateShortCut "$SMPROGRAMS\DewiCom\DewiCom Server (headless).lnk" "$INSTDIR\DewiCom.exe" "--server --headless" "$INSTDIR\DewiCom.exe" 0 SW_SHOWNORMAL
!macroend

!macro customUnInstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="DewiCom UDP 9999 IN"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="DewiCom UDP 9998 IN"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="DewiCom TCP 3001 IN"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="DewiCom App"'
  Delete "$SMPROGRAMS\DewiCom\DewiCom Server.lnk"
  Delete "$SMPROGRAMS\DewiCom\DewiCom Server (headless).lnk"
!macroend
