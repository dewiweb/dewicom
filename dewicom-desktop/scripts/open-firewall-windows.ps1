# Script PowerShell — Ouvre les ports réseau nécessaires à DewiCom
# À lancer UNE FOIS en tant qu'Administrateur avant de tester la release Windows
# Usage : Right-click > "Exécuter avec PowerShell" ou :
#   Start-Process powershell -Verb RunAs -ArgumentList "-File open-firewall-windows.ps1"

$ErrorActionPreference = "SilentlyContinue"

Write-Host "=== DewiCom — Configuration pare-feu Windows ===" -ForegroundColor Cyan

# UDP 9999 — Découverte multicast
Remove-NetFirewallRule -DisplayName "DewiCom UDP 9999 IN" 2>$null
New-NetFirewallRule -DisplayName "DewiCom UDP 9999 IN" `
    -Direction Inbound -Action Allow -Protocol UDP -LocalPort 9999 `
    -Description "DewiCom multicast discovery" | Out-Null
Write-Host "[OK] UDP 9999 IN (multicast discovery)" -ForegroundColor Green

# UDP 9998 — Élection de leader
Remove-NetFirewallRule -DisplayName "DewiCom UDP 9998 IN" 2>$null
New-NetFirewallRule -DisplayName "DewiCom UDP 9998 IN" `
    -Direction Inbound -Action Allow -Protocol UDP -LocalPort 9998 `
    -Description "DewiCom leader election" | Out-Null
Write-Host "[OK] UDP 9998 IN (leader election)" -ForegroundColor Green

# TCP 3001 — Serveur HTTP local
Remove-NetFirewallRule -DisplayName "DewiCom TCP 3001 IN" 2>$null
New-NetFirewallRule -DisplayName "DewiCom TCP 3001 IN" `
    -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3001 `
    -Description "DewiCom local server" | Out-Null
Write-Host "[OK] TCP 3001 IN (local server)" -ForegroundColor Green

# Vérification — affiche les règles créées
Write-Host ""
Write-Host "=== Règles créées ===" -ForegroundColor Cyan
Get-NetFirewallRule -DisplayName "DewiCom*" | Select-Object DisplayName, Direction, Action, Enabled | Format-Table -AutoSize

Write-Host "Terminé. Relancez DewiCom." -ForegroundColor Yellow
