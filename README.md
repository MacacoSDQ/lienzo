# Lienzo 🎨

Fondos y fuentes personalizados para Discord de escritorio, desde la bandeja del sistema. Sin BetterDiscord.

## Cómo se usa

1. Click en el icono de Lienzo en la bandeja (al lado del reloj).
2. La primera vez pulsa **Reiniciar Discord** para que cargue Lienzo.
3. Pestaña **Fondos** → `+` para elegir imágenes (png, jpg, gif, webp…). Click en una para aplicarla.
4. Pestaña **Fuentes** → `+ Agregar fuente` (.ttf, .otf, .woff, .woff2).
5. Ajusta **Oscuridad** y **Desenfoque** para que el texto se lea bien.

Click derecho en el icono: quitar personalización, iniciar con Windows, abrir la carpeta de la biblioteca, salir.

## Actualizaciones

Lienzo busca versiones nuevas en las Releases de GitHub (`MacacoSDQ/lienzo`) al abrirse y cada 30 minutos.
Las descarga en segundo plano y muestra **NEW UPDATE AVAILABLE** con un botón para reiniciar ya actualizado.
También aparece en el menú del icono (click derecho).

Publicar una versión nueva:

```bash
# 1. sube "version" en package.json y escribe las novedades en build/release-notes.md
git commit -am "v1.5.0"
git tag v1.5.0
git push && git push --tags
```

GitHub Actions compila el instalador en Windows y publica la Release (`.github/workflows/release.yml`).
El repositorio tiene que ser **público** para que las apps instaladas puedan descargar las actualizaciones.

## Ejecutar desde el código

```bash
npm install
npm start
```

## Crear el .exe

```bash
npm run dist
```

Sale en `dist/` como `Lienzo-Setup-<versión>.exe`.

## Cómo funciona

- Lienzo añade una línea a `discord_desktop_core/index.js` (como BetterDiscord/Vencord) que carga `lienzo-core.js` dentro de Discord.
- Ese código lee tu selección de `%APPDATA%\Lienzo\discord\state.json` y la aplica al momento cuando cambia.
- El fondo se dibuja en un `<canvas>` detrás de la app y los paneles grandes y opacos se vuelven transparentes; la fuente se carga con `FontFace`. Nada de esto usa URLs, así que el CSP de Discord no lo bloquea.
- Funciona aunque Lienzo esté cerrado. Si Discord se actualiza, Lienzo vuelve a añadir la línea y pide reiniciar Discord.
- Tu biblioteca y ajustes se guardan en `%APPDATA%\Lienzo`.

## Cosas a tener en cuenta

- **Términos de Discord:** modificar el cliente técnicamente va contra sus términos, igual que BetterDiscord. En la práctica no se ha baneado a nadie por temas visuales, pero es bajo tu responsabilidad.
- Para dejar Discord como estaba: click derecho en el icono → *Quitar Lienzo de Discord*.

## Estructura

```
main.js            bandeja, ventana emergente, IPC
preload.js         puente seguro hacia la UI
src/discord.js     integración con Discord (parche + código que corre dentro)
src/inject.js      lo que dibuja el fondo y la fuente dentro de Discord
src/payload.js     qué fondo/fuente están elegidos
src/store.js       biblioteca y config
src/updater.js     actualizaciones desde GitHub Releases
renderer/          la galería (HTML/CSS/JS)
```
