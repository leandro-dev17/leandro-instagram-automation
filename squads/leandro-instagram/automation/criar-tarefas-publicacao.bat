@echo off
echo Criando tarefas de publicacao automatica no Instagram...
echo.

powershell -Command "$action1 = New-ScheduledTaskAction -Execute 'C:\Program Files\nodejs\node.exe' -Argument '\"C:\Users\lelus\OneDrive\Pictures\BioNexus Digital\squads\leandro-instagram\automation\instagram-publisher.cjs\" 1' -WorkingDirectory 'C:\Users\lelus\OneDrive\Pictures\BioNexus Digital\squads\leandro-instagram\automation'; $trigger1 = New-ScheduledTaskTrigger -Daily -At '07:00'; Register-ScheduledTask -TaskName 'BioNexus_Instagram_Post1_Motivacional' -Action $action1 -Trigger $trigger1 -RunLevel Highest -Force"

powershell -Command "$action2 = New-ScheduledTaskAction -Execute 'C:\Program Files\nodejs\node.exe' -Argument '\"C:\Users\lelus\OneDrive\Pictures\BioNexus Digital\squads\leandro-instagram\automation\instagram-publisher.cjs\" 2' -WorkingDirectory 'C:\Users\lelus\OneDrive\Pictures\BioNexus Digital\squads\leandro-instagram\automation'; $trigger2 = New-ScheduledTaskTrigger -Daily -At '12:00'; Register-ScheduledTask -TaskName 'BioNexus_Instagram_Post2_Educativo' -Action $action2 -Trigger $trigger2 -RunLevel Highest -Force"

powershell -Command "$action3 = New-ScheduledTaskAction -Execute 'C:\Program Files\nodejs\node.exe' -Argument '\"C:\Users\lelus\OneDrive\Pictures\BioNexus Digital\squads\leandro-instagram\automation\instagram-publisher.cjs\" 3' -WorkingDirectory 'C:\Users\lelus\OneDrive\Pictures\BioNexus Digital\squads\leandro-instagram\automation'; $trigger3 = New-ScheduledTaskTrigger -Daily -At '18:00'; Register-ScheduledTask -TaskName 'BioNexus_Instagram_Post3_Cientifico' -Action $action3 -Trigger $trigger3 -RunLevel Highest -Force"

echo.
echo ============================================
echo Tarefas criadas:
echo   07:00 - Post 1 (Motivacional)
echo   12:00 - Post 2 (Educativo)
echo   18:00 - Post 3 (Cientifico/Mitos)
echo ============================================
echo.
pause
