@echo off

:: Auto-elevacao para Administrador
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Solicitando permissao de administrador...
    powershell -Command "Start-Process -FilePath 'cmd.exe' -ArgumentList '/c \"%~f0\"' -Verb RunAs -Wait"
    exit /b
)

echo Removendo tarefas antigas OpenSquad do Task Scheduler...
echo.

schtasks /delete /tn "OpenSquad_Instagram_Post1_Motivacional" /f
schtasks /delete /tn "OpenSquad_Instagram_Post2_Educativo" /f
schtasks /delete /tn "OpenSquad_Instagram_Post3_Cientifico" /f

echo.
echo ============================================
echo Tarefas removidas!
echo As tarefas BioNexus_ continuam ativas:
echo   05:00 - Daily Generator (gera imagens)
echo   07:00 - Post 1 Motivacional
echo   12:00 - Post 2 Educativo
echo   18:00 - Post 3 Cientifico
echo ============================================
echo.
pause
