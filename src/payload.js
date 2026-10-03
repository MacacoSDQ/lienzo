// Lo que lee Discord: rutas del fondo/fuente elegidos + ajustes
const MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  avif: 'image/avif',
};

function buildState(store) {
  const c = store.config;
  const bg = store.get('backgrounds', c.background);
  const font = store.get('fonts', c.font);
  return {
    bg: bg ? { path: bg.path, mime: MIME[bg.ext] || 'image/png' } : null,
    font: font ? { path: font.path } : null,
    dim: c.dim,
    blur: c.blur,
  };
}

module.exports = { buildState };
