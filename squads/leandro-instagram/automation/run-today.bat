@echo off
echo ===============================================
echo  BioNexus Digital - Gerando conteudo de hoje
echo ===============================================
echo.
"C:\Program Files\nodejs\node.exe" "%~dp0daily-generator.cjs"
echo.
pause
