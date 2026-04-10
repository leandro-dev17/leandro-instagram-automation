# desabilitar-tarefas-antigas.ps1
# Execute como ADMINISTRADOR no PowerShell
# Clique com botão direito no PowerShell -> "Executar como administrador"
# Depois cole: cd "C:\Users\lelus\OneDrive\Pictures\BioNexus Digital\squads\leandro-instagram\automation"
# E rode: powershell -ExecutionPolicy Bypass -File desabilitar-tarefas-antigas.ps1

$toDisable = @(
  'BioNexus_Reel1_09h',
  'BioNexus_Reel2_11h',
  'BioNexus_Reel3_13h',
  'BioNexus_Reel4_16h',
  'BioNexus_Reel5_20h',
  'BioNexus_ReelDica_14h',
  'BioNexus_Story1_08h',
  'BioNexus_Story2_1330h',
  'BioNexus_Story3_19h'
)

Write-Host "Desabilitando tarefas antigas do sistema antigo..." -ForegroundColor Yellow
foreach ($name in $toDisable) {
  $t = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  if ($t) {
    $t | Disable-ScheduledTask | Out-Null
    $status = (Get-ScheduledTask -TaskName $name).State
    Write-Host "  $name -> $status" -ForegroundColor Green
  } else {
    Write-Host "  $name -> nao encontrado" -ForegroundColor Gray
  }
}

Write-Host ""
Write-Host "Tarefas ATIVAS apos correcao:" -ForegroundColor Cyan
Get-ScheduledTask | Where-Object { $_.TaskName -like '*BioNexus*' -and $_.State -eq 'Ready' } | ForEach-Object {
  $trigger = $_.Triggers | Select-Object -First 1
  $time = if ($trigger.StartBoundary) { $trigger.StartBoundary.Substring(11,5) } else { 'N/A' }
  Write-Host "  $time | $($_.TaskName)" -ForegroundColor White
}

Write-Host ""
Write-Host "Concluido!" -ForegroundColor Green
