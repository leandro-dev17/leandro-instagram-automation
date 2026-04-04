@echo off
schtasks /create /tn "BioNexus_Daily_Instagram" /tr "\"C:\Program Files\nodejs\node.exe\" \"C:\Users\lelus\OneDrive\Pictures\BioNexus Digital\squads\leandro-instagram\automation\daily-generator.cjs\"" /sc daily /st 05:00 /rl HIGHEST /f
if %ERRORLEVEL% EQU 0 (
    echo.
    echo Agendamento criado com sucesso!
    echo Todo dia as 05:00 o conteudo sera gerado automaticamente.
) else (
    echo.
    echo Erro! Tente executar como Administrador.
)
pause
