@echo off
echo ===============================================
echo  BioNexus Digital - Configurando Agendamento Diario
echo ===============================================
echo.

REM Caminho do Node.js
set NODE="C:\Program Files\nodejs\node.exe"

REM Caminho do script
set SCRIPT="C:\Users\lelus\OneDrive\Pictures\BioNexus Digital\squads\leandro-instagram\automation\daily-generator.cjs"

REM Nome da tarefa no Task Scheduler
set TASK_NAME=BioNexus_Daily_Instagram

REM Remove tarefa antiga se existir
schtasks /delete /tn "%TASK_NAME%" /f >nul 2>&1

REM Cria nova tarefa — roda todo dia as 05:00
schtasks /create ^
  /tn "%TASK_NAME%" ^
  /tr "%NODE% %SCRIPT%" ^
  /sc daily ^
  /st 05:00 ^
  /ru "%USERNAME%" ^
  /rl HIGHEST ^
  /f

if %ERRORLEVEL% EQU 0 (
  echo.
  echo Agendamento configurado com sucesso!
  echo    Tarefa: %TASK_NAME%
  echo    Horario: Todo dia as 05:00
  echo    Script: %SCRIPT%
  echo.
  echo O computador precisa estar ligado as 05:00
  echo para a geracao automatica funcionar.
  echo.
) else (
  echo.
  echo Erro ao configurar o agendamento.
  echo    Tente executar este arquivo como Administrador.
  echo    Clique com botao direito -> "Executar como administrador"
  echo.
)

pause
