$NODE = 'C:\Program Files\nodejs\node.exe'
$DIR  = 'C:\Users\lelus\OneDrive\Pictures\BioNexus Digital\squads\leandro-instagram\automation'

$tasks = @(
  @{Name='BioNexus_Story1_08h';   Script='story-publisher.cjs'; Arg='1'; Time='08:00'},
  @{Name='BioNexus_Reel1_09h';    Script='reel-publisher.cjs';  Arg='1'; Time='09:00'},
  @{Name='BioNexus_Reel2_11h';    Script='reel-publisher.cjs';  Arg='2'; Time='11:00'},
  @{Name='BioNexus_Reel3_13h';    Script='reel-publisher.cjs';  Arg='3'; Time='13:00'},
  @{Name='BioNexus_Story2_1330h'; Script='story-publisher.cjs'; Arg='2'; Time='13:30'},
  @{Name='BioNexus_ReelDica_14h'; Script='reel-publisher.cjs';  Arg='6'; Time='14:00'},
  @{Name='BioNexus_Reel4_16h';    Script='reel-publisher.cjs';  Arg='4'; Time='16:00'},
  @{Name='BioNexus_Story3_19h';   Script='story-publisher.cjs'; Arg='3'; Time='19:00'},
  @{Name='BioNexus_Reel5_20h';    Script='reel-publisher.cjs';  Arg='5'; Time='20:00'}
)

foreach ($t in $tasks) {
  try {
    $action  = New-ScheduledTaskAction -Execute $NODE -Argument "`"$DIR\$($t.Script)`" $($t.Arg)" -WorkingDirectory $DIR
    $trigger = New-ScheduledTaskTrigger -Daily -At $t.Time
    $settings = New-ScheduledTaskSettingsSet -WakeToRun -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 2)
    $settings.DisallowStartIfOnBatteries = $false
    $settings.StopIfGoingOnBatteries = $false
    Register-ScheduledTask -TaskName $t.Name -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest -Force -ErrorAction Stop | Out-Null
    Write-Host "OK: $($t.Name) - $($t.Time)h" -ForegroundColor Green
  } catch {
    Write-Host "ERRO: $($t.Name) - $_" -ForegroundColor Red
  }
}

Write-Host ""
Write-Host "=== VERIFICANDO ===" -ForegroundColor Cyan
Get-ScheduledTask | Where-Object { $_.TaskName -match 'BioNexus_Reel|BioNexus_Story' } | ForEach-Object {
  Write-Host "$($_.TaskName) - $($_.State)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Pressione qualquer tecla para fechar..."
$null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
