@echo off
echo ============================================
echo BioNexus Digital - Criando tarefas de Reels e Stories
echo ============================================

set NODE="C:\Program Files\nodejs\node.exe"
set DIR="C:\Users\lelus\OneDrive\Pictures\BioNexus Digital\squads\leandro-instagram\automation"

:: ─── REELS (09h, 11h, 13h, 16h, 20h) ──────────────────────────────────────

schtasks /create /tn "BioNexus_Reel1_09h" /tr "%NODE% \"%DIR%\reel-publisher.cjs\" 1" /sc daily /st 09:00 /ru %USERNAME% /rl HIGHEST /f
schtasks /change /tn "BioNexus_Reel1_09h" /DELAY 0000:00 /K

schtasks /create /tn "BioNexus_Reel2_11h" /tr "%NODE% \"%DIR%\reel-publisher.cjs\" 2" /sc daily /st 11:00 /ru %USERNAME% /rl HIGHEST /f
schtasks /change /tn "BioNexus_Reel2_11h" /DELAY 0000:00 /K

schtasks /create /tn "BioNexus_Reel3_13h" /tr "%NODE% \"%DIR%\reel-publisher.cjs\" 3" /sc daily /st 13:00 /ru %USERNAME% /rl HIGHEST /f
schtasks /change /tn "BioNexus_Reel3_13h" /DELAY 0000:00 /K

schtasks /create /tn "BioNexus_Reel4_16h" /tr "%NODE% \"%DIR%\reel-publisher.cjs\" 4" /sc daily /st 16:00 /ru %USERNAME% /rl HIGHEST /f
schtasks /change /tn "BioNexus_Reel4_16h" /DELAY 0000:00 /K

schtasks /create /tn "BioNexus_Reel5_20h" /tr "%NODE% \"%DIR%\reel-publisher.cjs\" 5" /sc daily /st 20:00 /ru %USERNAME% /rl HIGHEST /f
schtasks /change /tn "BioNexus_Reel5_20h" /DELAY 0000:00 /K

schtasks /create /tn "BioNexus_ReelDica_14h" /tr "%NODE% \"%DIR%\reel-publisher.cjs\" 6" /sc daily /st 14:00 /ru %USERNAME% /rl HIGHEST /f
schtasks /change /tn "BioNexus_ReelDica_14h" /DELAY 0000:00 /K

:: ─── STORIES (08h, 13:30h, 19h) ────────────────────────────────────────────

schtasks /create /tn "BioNexus_Story1_08h" /tr "%NODE% \"%DIR%\story-publisher.cjs\" 1" /sc daily /st 08:00 /ru %USERNAME% /rl HIGHEST /f
schtasks /change /tn "BioNexus_Story1_08h" /DELAY 0000:00 /K

schtasks /create /tn "BioNexus_Story2_1330h" /tr "%NODE% \"%DIR%\story-publisher.cjs\" 2" /sc daily /st 13:30 /ru %USERNAME% /rl HIGHEST /f
schtasks /change /tn "BioNexus_Story2_1330h" /DELAY 0000:00 /K

schtasks /create /tn "BioNexus_Story3_19h" /tr "%NODE% \"%DIR%\story-publisher.cjs\" 3" /sc daily /st 19:00 /ru %USERNAME% /rl HIGHEST /f
schtasks /change /tn "BioNexus_Story3_19h" /DELAY 0000:00 /K

:: ─── WAKE-UP para Reels e Stories ──────────────────────────────────────────

schtasks /create /tn "BioNexus_WakeUp_0858" /tr "cmd.exe /c echo BioNexus wake-up" /sc daily /st 08:58 /ru %USERNAME% /rl HIGHEST /f
schtasks /create /tn "BioNexus_WakeUp_0858" /tr "cmd.exe /c echo BioNexus wake-up" /sc daily /st 08:58 /ru SYSTEM /rl HIGHEST /f 2>nul

powershell -Command "
$tasks = @('BioNexus_Reel1_09h','BioNexus_Reel2_11h','BioNexus_Reel3_13h','BioNexus_Reel4_16h','BioNexus_Reel5_20h','BioNexus_ReelDica_14h','BioNexus_Story1_08h','BioNexus_Story2_1330h','BioNexus_Story3_19h')
foreach ($t in $tasks) {
  $task = Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue
  if ($task) {
    $settings = $task.Settings
    $settings.DisallowStartIfOnBatteries = $false
    $settings.StopIfGoingOnBatteries = $false
    $settings.WakeToRun = $true
    $settings.RestartCount = 3
    $settings.RestartInterval = 'PT2M'
    Set-ScheduledTask -TaskName $t -Settings $settings
  }
}
Write-Host 'Configuracoes aplicadas!'
"

echo.
echo ============================================
echo Tarefas criadas com sucesso!
echo.
echo REELS:
echo   09:00h - Reel 1
echo   11:00h - Reel 2
echo   13:00h - Reel 3
echo   14:00h - Reel Dica do Personal
echo   16:00h - Reel 4
echo   20:00h - Reel 5
echo.
echo STORIES:
echo   08:00h - Story 1 (motivacional)
echo   13:30h - Story 2 (educativo)
echo   19:00h - Story 3 (cientifico)
echo ============================================
pause
