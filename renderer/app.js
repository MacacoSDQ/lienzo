const api = window.lienzo;
const $ = (s) => document.querySelector(s);

let S = null;
let tab = 'backgrounds';
let armed = null; // id del elemento con "¿borrar?" activo
const fontFamilies = new Map();

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/* ---------- Estado de Discord ---------- */

// Explica qué pasó dentro de Discord si algo no se aplicó
function diagnose() {
  const d = S.discordInfo;
  if (!d) return '';
  if (d.error) return `Error en Discord: ${d.error}`;
  if (!d.applied) return 'Discord todavía no ha recibido el tema';
  const r = d.result || {};
  const g = d.diag || {};
  if (S.config.background && !g.state) return 'Discord no encuentra la configuración de Lienzo';
  if (S.config.background && g.bgRequested && !g.bgRead)
    return `Discord no puede leer la imagen (${g.bgReadError || 'error'})`;
  if (S.config.background && !g.bgRequested) return 'Aplicando…';
  if (S.config.background && !r.bg) return 'Discord no pudo dibujar el fondo';
  if (S.config.font && !r.font) return `Discord no pudo cargar la fuente${r.fontError ? `: ${r.fontError}` : ''}`;
  if (S.config.background) return r.animated ? 'Fondo animado aplicado ✓' : 'Fondo aplicado ✓';
  return '';
}

function renderStatus() {
  const box = $('#status');
  box.dataset.s = S.status;
  const btn = $('#connect');
  const title = $('#statusTitle');
  const sub = $('#statusSub');

  if (S.status === 'connected') {
    title.textContent = 'Conectado a Discord';
    sub.textContent = diagnose() || 'Los cambios se aplican al instante';
    btn.hidden = true;
  } else if (S.status === 'launching') {
    title.textContent = 'Abriendo Discord…';
    sub.textContent = 'Espera a que cargue';
    btn.hidden = true;
  } else if (S.status === 'needs-restart') {
    title.textContent = 'Falta reiniciar Discord';
    sub.textContent = S.lastError || 'Solo hace falta una vez';
    btn.textContent = 'Reiniciar Discord';
    btn.hidden = false;
  } else if (!S.discordFound) {
    title.textContent = 'No encontré Discord';
    sub.textContent = S.lastError || 'Instala Discord de escritorio';
    btn.hidden = true;
  } else {
    title.textContent = 'Discord no conectado';
    sub.textContent = S.lastError || 'Ábrelo desde aquí o como siempre';
    btn.textContent = 'Abrir Discord';
    btn.hidden = false;
  }
  sub.title = sub.textContent;
}

/* ---------- Borrado en dos clicks ---------- */

function deleteButton(kind, id) {
  const b = el('button', 'del', '✕');
  b.title = 'Eliminar';
  if (armed === id) {
    b.classList.add('armed');
    b.textContent = '¿Borrar?';
  }
  b.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (armed === id) {
      armed = null;
      update(await api.remove(kind, id));
    } else {
      armed = id;
      render();
    }
  });
  return b;
}

/* ---------- Fondos ---------- */

// Tamaño real de cada imagen, para avisar si es demasiado pequeña para la pantalla
const sizes = new Map();
function screenPx() {
  const r = window.devicePixelRatio || 1;
  return { w: Math.round(screen.width * r), h: Math.round(screen.height * r) };
}
function quality(id) {
  const sz = sizes.get(id);
  if (!sz) return null;
  const scr = screenPx();
  const ratio = Math.max(scr.w / sz.w, scr.h / sz.h);
  return { ...sz, scr, low: ratio > 1.6 };
}
function measure(bg) {
  if (sizes.has(bg.id)) return;
  sizes.set(bg.id, null);
  const im = new Image();
  im.onload = () => {
    sizes.set(bg.id, { w: im.naturalWidth, h: im.naturalHeight });
    render();
  };
  im.src = bg.url;
}

function renderBackgrounds() {
  const grid = $('#bgGrid');
  grid.replaceChildren();

  const none = el('button', 'tile none', 'Ninguno');
  if (!S.config.background) none.classList.add('selected');
  none.addEventListener('click', async () => update(await api.select('backgrounds', null)));
  grid.append(none);

  for (const bg of S.backgrounds) {
    const t = el('button', 'tile');
    t.title = bg.name;
    if (bg.id === S.config.background) t.classList.add('selected');
    const img = el('img');
    img.src = bg.url;
    img.loading = 'lazy';
    img.decoding = 'async';
    t.append(img, deleteButton('backgrounds', bg.id));
    measure(bg);
    const q = quality(bg.id);
    if (q) {
      t.title = `${bg.name} — ${q.w}×${q.h}`;
      if (q.low) t.append(el('span', 'lowres', 'Baja calidad'));
    }
    t.addEventListener('click', async () => update(await api.select('backgrounds', bg.id)));
    grid.append(t);
  }

  const add = el('button', 'tile add', '+');
  add.title = 'Agregar fondos';
  add.addEventListener('click', async () => update(await api.add('backgrounds')));
  grid.append(add);

  const hint = $('#bgHint');
  const q = S.config.background && quality(S.config.background);
  if (q && q.low) {
    hint.hidden = false;
    hint.textContent =
      `Esta imagen mide ${q.w}×${q.h} y tu pantalla ${q.scr.w}×${q.scr.h}, así que se ve estirada. ` +
      `Para que salga nítida, usa una de al menos ${Math.round(q.scr.w * 0.75)}×${Math.round(q.scr.h * 0.75)} ` +
      `(en Google Imágenes: Herramientas → Tamaño → Grande, y descarga la imagen original, no la miniatura).`;
  } else {
    hint.hidden = true;
  }

  $('#bgControls').classList.toggle('disabled', !S.config.background);
  if (document.activeElement !== $('#dim')) $('#dim').value = S.config.dim;
  if (document.activeElement !== $('#blur')) $('#blur').value = S.config.blur;
  showSliderValues();
}

function showSliderValues() {
  $('#dimVal').textContent = `${Math.round($('#dim').value * 100)}%`;
  $('#blurVal').textContent = `${$('#blur').value}px`;
}

let sliderTimer;
for (const id of ['dim', 'blur']) {
  $(`#${id}`).addEventListener('input', (e) => {
    showSliderValues();
    clearTimeout(sliderTimer);
    const value = Number(e.target.value);
    sliderTimer = setTimeout(async () => (S = await api.option(id, value)), 120);
  });
}

/* ---------- Fuentes ---------- */

function familyFor(font) {
  if (!fontFamilies.has(font.id)) {
    const fam = `pv${fontFamilies.size}`;
    const ff = new FontFace(fam, `url("${font.url}")`);
    document.fonts.add(ff);
    ff.load().catch(() => {});
    fontFamilies.set(font.id, fam);
  }
  return fontFamilies.get(font.id);
}

function renderFonts() {
  const list = $('#fontList');
  list.replaceChildren();

  const def = el('button', 'font-row');
  if (!S.config.font) def.classList.add('selected');
  const dp = el('div', 'preview', 'Aa — Así se ve tu Discord');
  def.append(dp, el('small', null, 'Predeterminada de Discord'));
  def.addEventListener('click', async () => update(await api.select('fonts', null)));
  list.append(def);

  for (const f of S.fonts) {
    const row = el('button', 'font-row');
    if (f.id === S.config.font) row.classList.add('selected');
    const p = el('div', 'preview', 'Aa — Así se ve tu Discord');
    p.style.fontFamily = `"${familyFor(f)}", sans-serif`;
    row.append(p, el('small', null, f.name), deleteButton('fonts', f.id));
    row.addEventListener('click', async () => update(await api.select('fonts', f.id)));
    list.append(row);
  }

  const add = el('button', 'font-row add', '+ Agregar fuente (.ttf, .otf, .woff)');
  add.addEventListener('click', async () => update(await api.add('fonts')));
  list.append(add);
}

/* ---------- General ---------- */

function renderUpdate() {
  const u = S.update || {};
  $('#appVersion').textContent = `Lienzo v${S.appVersion}`;
  const mini = $('#updateMini');
  mini.textContent =
    u.status === 'downloading' ? `Descargando v${u.version}… ${u.percent || 0}%`
    : u.status === 'checking' ? 'Buscando actualizaciones…'
    : u.status === 'idle' ? 'Al día ✓'
    : '';

  const box = $('#update');
  box.hidden = u.status !== 'ready';
  if (u.status === 'ready') {
    $('#updateVersion').textContent = `v${u.version}`;
    $('#updateNotes').textContent = u.notes || '';
  }
}

$('#updateBtn').addEventListener('click', () => {
  $('#updateBtn').disabled = true;
  $('#updateBtn').textContent = 'Reiniciando…';
  api.installUpdate();
});

function render() {
  if (!S) return;
  renderUpdate();
  renderStatus();
  renderBackgrounds();
  renderFonts();
  $('#pane-backgrounds').hidden = tab !== 'backgrounds';
  $('#pane-fonts').hidden = tab !== 'fonts';
  document.querySelectorAll('.tabs button').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
}

function update(next) {
  S = next;
  render();
}

document.querySelectorAll('.tabs button').forEach((b) =>
  b.addEventListener('click', () => {
    tab = b.dataset.tab;
    armed = null;
    render();
  })
);

$('#connect').addEventListener('click', async () => update(await api.connect()));
$('#close').addEventListener('click', () => api.hide());
document.addEventListener('keydown', (e) => e.key === 'Escape' && api.hide());
document.addEventListener('click', (e) => {
  if (armed && !e.target.closest('.del')) {
    armed = null;
    render();
  }
});

api.onState(update);
api.state().then(update);
