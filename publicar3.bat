@echo off
cd /d "%~dp0"
copy /Y release-v3.yml .github\workflows\release.yml
findstr /C:"shell: bash" .github\workflows\release.yml
if errorlevel 1 (echo ERROR: el release.yml no se actualizo & pause & exit /b 1)
del release-v3.yml
del publicar2.bat 2>NUL
git add -A
git commit -m "Publicar release con bash"
git push
git tag -f v1.4.0
git push -f origin v1.4.0
echo.
echo Listo. Mira la pestana Actions en GitHub.
pause
