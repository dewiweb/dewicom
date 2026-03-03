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

  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="DewiCom App"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="DewiCom App" dir=in action=allow program="$INSTDIR\DewiCom.exe" enable=yes description="DewiCom application"'
  SetShellVarContext all
  StrCpy $0 "$SMPROGRAMS\DewiCom"
  StrCpy $1 "$INSTDIR\DewiCom.exe"
  CreateShortCut "$0\DewiCom Server.lnk" "$1" "--server" "$1" 0 SW_SHOWNORMAL
  CreateShortCut "$0\DewiCom Server Headless.lnk" "$1" "--server --headless" "$1" 0 SW_SHOWMINIMIZED
  SetShellVarContext current
!macroend

!macro customUnInstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="DewiCom UDP 9999 IN"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="DewiCom UDP 9998 IN"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="DewiCom TCP 3001 IN"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="DewiCom App"'
  SetShellVarContext all
  StrCpy $0 "$SMPROGRAMS\DewiCom"
  Delete "$0\DewiCom Server.lnk"
  Delete "$0\DewiCom Server Headless.lnk"
  SetShellVarContext current
!macroend
