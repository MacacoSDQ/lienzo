// Esta función se ejecuta DENTRO de Discord (se serializa con toString()).
// Tiene que ser autocontenida: nada de variables de fuera.
//
// El fondo se pinta en un <canvas> detrás de la app: la imagen se decodifica
// en memoria, sin URLs, así que el CSP de Discord no puede bloquearla.
module.exports = async function lienzoInject(p) {
  const S = window.__lienzo || (window.__lienzo = {});
  const info = { bg: false, font: false, animated: false };
  const bytes = (b64) => {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };
  const ROOTS =
    ':root, html, body, .theme-dark, .theme-darker, .theme-midnight, .theme-light, .visual-refresh';
  let css = '';

  /* ----- Limpiar lo anterior ----- */
  if (S.stopAnim) S.stopAnim();
  if (S.onResize) removeEventListener('resize', S.onResize);
  if (S.onScanResize) removeEventListener('resize', S.onScanResize);
  if (S.canvas) S.canvas.remove();
  if (S.observer) S.observer.disconnect();
  clearTimeout(S.scanTimer);
  document.querySelectorAll('[data-lienzo-clear]').forEach((el) => el.removeAttribute('data-lienzo-clear'));
  S.stopAnim = S.onResize = S.onScanResize = S.canvas = S.observer = null;

  /* ----- Solo la ventana principal ----- */
  // El overlay de los juegos y las ventanas emergentes de Discord se abren en
  // /popout: si se les pone el fondo, tapa el juego. Ahí se quita todo.
  const path = location.pathname.toLowerCase();
  if (path.startsWith('/popout') || path.includes('overlay') || window !== window.top) {
    if (S.font) {
      document.fonts.delete(S.font);
      S.font = null;
    }
    if (S.sheet) S.sheet.replaceSync('');
    return { ok: true, skipped: 'popout' };
  }

  /* ----- Fondo ----- */
  if (p.bg) {
    const data = bytes(p.bg.data);
    const dim = Math.min(0.9, Math.max(0, Number(p.dim) || 0));
    const blur = Math.max(0, Number(p.blur) || 0);

    const canvas = document.createElement('canvas');
    canvas.id = 'lienzo-bg';
    canvas.style.cssText =
      'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:-1;pointer-events:none;';
    document.body.prepend(canvas);
    S.canvas = canvas;
    const ctx = canvas.getContext('2d');
    let frame = null;
    let animatedFrames = false;
    let cache = null; // imagen ya escalada a la medida de la ventana

    const smooth = (c) => {
      c.imageSmoothingEnabled = true;
      c.imageSmoothingQuality = 'high';
    };

    // Escalado de alta calidad: en pasos de x2 como máximo (mucho más nítido
    // que estirar de golpe una imagen pequeña a pantalla completa).
    const upscale = (src, sw, sh, tw, th) => {
      let cur = src;
      let cw = sw;
      let chh = sh;
      while (cw * 2 < tw && chh * 2 < th) {
        const step = document.createElement('canvas');
        step.width = cw * 2;
        step.height = chh * 2;
        const sc = step.getContext('2d');
        smooth(sc);
        sc.drawImage(cur, 0, 0, cw, chh, 0, 0, step.width, step.height);
        cur = step;
        cw = step.width;
        chh = step.height;
      }
      return { img: cur, w: cw, h: chh };
    };

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const W = Math.round(innerWidth * dpr);
      const H = Math.round(innerHeight * dpr);
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
      }
      smooth(ctx);
      ctx.clearRect(0, 0, W, H);
      if (!frame) return;
      const fw = frame.displayWidth || frame.width;
      const fh = frame.displayHeight || frame.height;
      const s = Math.max(W / fw, H / fh) * (blur ? 1.08 : 1);
      const tw = Math.round(fw * s);
      const th = Math.round(fh * s);

      let src = { img: frame, w: fw, h: fh };
      if (!animatedFrames && s > 1.5) {
        if (!cache || cache.tw !== tw || cache.th !== th) {
          cache = { tw, th, ...upscale(frame, fw, fh, tw, th) };
        }
        src = cache;
      }

      ctx.filter = blur ? `blur(${blur * dpr}px)` : 'none';
      ctx.drawImage(src.img, 0, 0, src.w, src.h, (W - tw) / 2, (H - th) / 2, tw, th);
      ctx.filter = 'none';
      if (dim) {
        ctx.fillStyle = `rgba(0,0,0,${dim})`;
        ctx.fillRect(0, 0, W, H);
      }
    };
    S.onResize = draw;
    addEventListener('resize', draw);

    // GIF / WebP animados
    if (/gif|webp|avif/.test(p.bg.mime) && 'ImageDecoder' in window) {
      try {
        const dec = new ImageDecoder({ data, type: p.bg.mime });
        await dec.tracks.ready;
        await dec.completed;
        const count = dec.tracks.selectedTrack ? dec.tracks.selectedTrack.frameCount : 1;
        if (count > 1) {
          animatedFrames = true;
          let i = 0;
          let alive = true;
          let timer = null;
          const next = async () => {
            if (!alive) return;
            const { image } = await dec.decode({ frameIndex: i });
            if (!alive) return image.close();
            if (frame && frame.close) frame.close();
            frame = image;
            draw();
            i = (i + 1) % count;
            timer = setTimeout(next, Math.max(20, (image.duration || 100000) / 1000));
          };
          S.stopAnim = () => {
            alive = false;
            clearTimeout(timer);
            try { dec.close(); } catch {}
          };
          await next();
          info.animated = true;
        } else {
          dec.close();
        }
      } catch (e) {
        info.animError = String(e);
      }
    }
    if (!info.animated) {
      animatedFrames = false;
      frame = await createImageBitmap(new Blob([data], { type: p.bg.mime }));
      info.size = [frame.width, frame.height];
      draw();
    }
    info.bg = true;

    // Busca los paneles grandes y opacos de Discord (chat, barras laterales, columnas)
    // y los vuelve transparentes. No depende de nombres de clases ni del tema.
    const SKIP =
      '[role="dialog"],[role="menu"],[role="tooltip"],[role="listbox"],[class*="layerContainer_"],' +
      '[class*="popout"],[class*="tooltip"],[class*="modal"],[class*="menu_"],#lienzo-bg';
    const ROWS =
      'li,a,button,[role="listitem"],[role="row"],[role="button"],[role="link"],[role="tab"],' +
      '[class*="listItem"],[class*="interactive"],[class*="message_"]';
    const opaque = (color) => {
      const m = color.match(/rgba?\(([^)]+)\)/);
      if (!m) return false;
      const parts = m[1].split(/[ ,/]+/).filter(Boolean);
      return parts.length < 4 || parseFloat(parts[3]) > 0.35;
    };
    const scan = () => {
      const vw = innerWidth;
      const vh = innerHeight;
      const minArea = vw * vh * 0.06;
      let n = 0;
      const root = document.getElementById('app-mount') || document.body;
      for (const el of root.querySelectorAll('*')) {
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        const big = w * h >= minArea || (h >= vh * 0.45 && w >= 48) || (w >= vw * 0.5 && h >= 36);
        if (!big || el.hasAttribute('data-lienzo-clear')) continue;
        // filas y botones: su fondo es el resaltado al pasar el ratón, no hay que tocarlo
        if (h < vh * 0.3 && (el.matches(ROWS) || el.matches(':hover'))) continue;
        if (el.closest(SKIP)) continue;
        if (opaque(getComputedStyle(el).backgroundColor)) {
          el.setAttribute('data-lienzo-clear', '');
          n++;
        }
      }
      info.cleared = (info.cleared || 0) + n;
    };
    const schedule = () => {
      if (S.scanTimer) return;
      S.scanTimer = setTimeout(() => {
        S.scanTimer = null;
        scan();
      }, 350);
    };
    scan();
    S.observer = new MutationObserver(schedule);
    S.observer.observe(document.body, { childList: true, subtree: true });
    S.observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    S.onScanResize = schedule;
    addEventListener('resize', schedule);

    const glass = 'rgba(0, 0, 0, 0.22)';
    css += `
${ROOTS} {
  --background-primary: transparent !important;
  --background-secondary: ${glass} !important;
  --background-secondary-alt: rgba(0, 0, 0, 0.28) !important;
  --background-tertiary: transparent !important;
  --background-base-low: transparent !important;
  --background-base-lower: ${glass} !important;
  --background-base-lowest: transparent !important;
  --bg-base-primary: transparent !important;
  --bg-base-secondary: ${glass} !important;
  --bg-base-tertiary: transparent !important;
  --chat-background-default: transparent !important;
  --app-frame-background: transparent !important;
  --channeltextarea-background: rgba(0, 0, 0, 0.35) !important;
}
html, body, #app-mount { background: transparent !important; }
[data-lienzo-clear] { background-color: transparent !important; }
[class^="bg_"], [class*=" bg_"],
[class^="app_"], [class*=" app_"],
[class^="layer_"], [class*=" layer_"], [class*="baseLayer_"],
[class*="chatContent_"], [class^="chat_"], [class*=" chat_"], [class*="page_"],
[class*="container_"][class*="themed_"], [class*="privateChannels_"],
[class*="membersWrap_"], [class^="members_"], [class*=" members_"] {
  background: transparent !important;
}`;
  }

  /* ----- Fuente ----- */
  if (S.font) {
    document.fonts.delete(S.font);
    S.font = null;
  }
  if (p.font) {
    try {
      const ff = new FontFace('LienzoFont', bytes(p.font.data));
      await ff.load();
      document.fonts.add(ff);
      S.font = ff;
      info.font = true;
      const stack = `'LienzoFont', 'gg sans', 'Noto Sans', sans-serif`;
      css += `
${ROOTS} {
  --font-primary: ${stack} !important;
  --font-display: ${stack} !important;
  --font-headline: ${stack} !important;
}
body, input, textarea, button, select { font-family: ${stack} !important; }
code, pre, pre *, [class*="codeBlock"], [class*="inlineCode"] {
  font-family: var(--font-code), Consolas, monospace !important;
}`;
    } catch (e) {
      info.fontError = String(e);
    }
  }

  /* ----- Aplicar (hoja adoptada: no la bloquea el CSP de Discord) ----- */
  if (!S.sheet) S.sheet = new CSSStyleSheet();
  S.sheet.replaceSync(css);
  if (!document.adoptedStyleSheets.includes(S.sheet)) {
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, S.sheet];
  }
  info.ok = true;
  return info;
};
