@echo off
cd /d "%~dp0"
findstr /C:"\"version\": \"1.5.0\"" package.json >NUL
if errorlevel 1 (echo ERROR: package.json no esta en la 1.5.0 & pause & exit /b 1)
git add -A
git commit -m "Lienzo v1.5.0: fondos mas nitidos y aviso de baja calidad"
git push
git tag v1.5.0
git push origin v1.5.0
echo.
echo Listo. En unos minutos Lienzo te mostrara NEW UPDATE AVAILABLE.
pause
