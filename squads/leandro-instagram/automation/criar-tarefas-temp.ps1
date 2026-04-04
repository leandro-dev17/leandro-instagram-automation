$node = 'C:\Program Files\nodejs\node.exe'
$base = 'C:\Users\lelus\OneDrive\Pictures\BioNexus Digital\squads\leandro-instagram\automation'

# Remover tarefas antigas
schtasks /delete /tn 'OpenSquad_Instagram_Post1_Motivacional' /f 2>$null
schtasks /delete /tn 'OpenSquad_Instagram_Post2_Educativo' /f 2>$null
schtasks /delete /tn 'OpenSquad_Instagram_Post3_Cientifico' /f 2>$null
schtasks /delete /tn 'OpenSquad_Daily_Instagram' /f 2>$null

$action1 = New-ScheduledTaskAction -Execute $node -Argument ('"' + $base + '\instagram-publisher.cjs" 1') -WorkingDirectory $base
$trigger1 = New-ScheduledTaskTrigger -Daily -At '07:00'
Register-ScheduledTask -TaskName 'BioNexus_Instagram_Post1_Motivacional' -Action $action1 -Trigger $trigger1 -RunLevel Highest -Force | Out-Null

$action2 = New-ScheduledTaskAction -Execute $node -Argument ('"' + $base + '\instagram-publisher.cjs" 2') -WorkingDirectory $base
$trigger2 = New-ScheduledTaskTrigger -Daily -At '12:00'
Register-ScheduledTask -TaskName 'BioNexus_Instagram_Post2_Educativo' -Action $action2 -Trigger $trigger2 -RunLevel Highest -Force | Out-Null

$action3 = New-ScheduledTaskAction -Execute $node -Argument ('"' + $base + '\instagram-publisher.cjs" 3') -WorkingDirectory $base
$trigger3 = New-ScheduledTaskTrigger -Daily -At '18:00'
Register-ScheduledTask -TaskName 'BioNexus_Instagram_Post3_Cientifico' -Action $action3 -Trigger $trigger3 -RunLevel Highest -Force | Out-Null

$actionD = New-ScheduledTaskAction -Execute $node -Argument ('"' + $base + '\daily-generator.cjs"') -WorkingDirectory $base
$triggerD = New-ScheduledTaskTrigger -Daily -At '05:00'
Register-ScheduledTask -TaskName 'BioNexus_Daily_Instagram' -Action $actionD -Trigger $triggerD -RunLevel Highest -Force | Out-Null

Write-Host "4 tarefas BioNexus criadas com sucesso!"
