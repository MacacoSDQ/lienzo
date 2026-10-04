@echo off
cd /d "%~dp0"
if exist release.yml move /Y release.yml .github\workflows\release.yml >nul
git add .
git commit -m "Arreglar publicacion de la release"
git push
git tag -f v1.4.0
git push -f origin v1.4.0
echo.
echo Listo. Mira la pestana Actions en GitHub.
pause
