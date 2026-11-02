/**
 * T3 (S2, S4): Modular HTML generators for Direction 01 —
 * Fichero Clásico de Cocina (Papel y Madera).
 *
 * The artboard `design/recetario-vistas/01-fichero-clasico-editorial.html`
 * is mapped into composable application renderers (header, plaque,
 * folio card, index groups, reading article). Class names follow the
 * Direction 01 vocabulary (`app-header`, `cardbox-drawing`, `dish-photo`)
 * so the static build keeps the visual contract without copying the
 * artboard verbatim.
 */

import { buildDevIncompleteBanner } from './keystatic-guard.mjs';
import { getRecipeSeasonalHighlights } from './seasonality.mjs';
import { groupRecipesAlphabetically } from './navigation.mjs';

const SEARCH_PLACEHOLDER = 'Buscar por plato, ingrediente o tag…';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMinutes(totalMin) {
  const mins = Number(totalMin);
  if (!Number.isFinite(mins) || mins <= 0) return '—';
  const hours = Math.floor(mins / 60);
  const rest = Math.round(mins % 60);
  if (hours <= 0) return `${mins} min`;
  if (rest === 0) return `${hours} h`;
  return `${hours} h ${rest} min`;
}

function ingredientName(item) {
  if (!item || typeof item !== 'object') return '';
  if (typeof item.texto === 'string' && item.texto.trim()) return item.texto.trim();
  return String(item.nombre ?? '').trim();
}

function resolveSimpleMode(catalog) {
  return catalog?.simpleMode === true || catalog?.location?.simpleMode === true;
}

function resolveActiveSlug(recipes, catalog) {
  const wanted = catalog?.activeSlug;
  if (typeof wanted === 'string' && recipes.some((r) => r.slug === wanted)) return wanted;
  return recipes[0]?.slug ?? null;
}

function resolveLocationBadge(catalog) {
  const location = catalog?.location ?? null;
  if (
    !location ||
    location.incertidumbre === true ||
    !location.subregionNombre ||
    !location.estacionActual
  ) {
    const message =
      location?.mensajeIncertidumbre ||
      'Ubicación sin cobertura en la tabla estacional: falta elegir una subregión climática cubierta. Queda el filtro manual por las cuatro estaciones.';
    return { covered: false, badgeText: null, message };
  }
  const pais = location.pais || 'AR';
  return {
    covered: true,
    badgeText: `${pais} · ${location.subregionNombre} · ${location.estacionActual}`,
    message: null
  };
}

function renderDevBanner(catalog, envMode) {
  if (envMode !== 'development') return '';
  const banner = buildDevIncompleteBanner(catalog?.evaluation ?? { omitidas: [] });
  if (!banner.visible) return '';
  const items = banner.items
    .map(
      (item) =>
        `<li><strong>${escapeHtml(item.slug)}</strong> (${escapeHtml(item.titulo)}): faltan [${escapeHtml(item.camposFaltantes.join(', '))}]</li>`
    )
    .join('');
  return `<div class="dev-banner" role="alert"><p>${escapeHtml(banner.message)}</p><ul>${items}</ul></div>`;
}

function renderAppHeader({ catalog, envMode, searchLabel }) {
  const simpleMode = resolveSimpleMode(catalog);
  const pressed = simpleMode ? 'true' : 'false';
  const stateText = simpleMode ? 'Sí' : 'No';
  const badge = resolveLocationBadge(catalog);
  const locationHtml = badge.covered
    ? `<span class="location-chip">${escapeHtml(badge.badgeText)}</span>`
    : `<span class="location-chip location-uncertain">${escapeHtml(badge.message)}</span>`;
  return `<header class="app-header">
  <div class="header-top-row">
    <span class="brand-title">Recetas de Estación</span>
    <button type="button" class="simple-toggle" aria-pressed="${pressed}">Lectura simple: <span class="toggle-state">${stateText}</span></button>
  </div>
  <div class="header-meta-row">${locationHtml}<span class="offline-chip">PWA Offline</span></div>
  <div class="search-bar"><span aria-hidden="true">🔍</span><input type="search" placeholder="${SEARCH_PLACEHOLDER}" aria-label="${escapeHtml(searchLabel ?? 'Buscar en el recetario')}" /></div>
  <div class="a11y-notice" role="status">Lectura simple activa: sin animaciones de extracción, vista de lista y texto ampliado.</div>
  ${renderDevBanner(catalog, envMode)}
</header>`;
}

function pageShell({ title, catalog, envMode, bodyClass, body }) {
  const simpleMode = resolveSimpleMode(catalog);
  const cls = [bodyClass, simpleMode ? 'simple-mode' : ''].filter(Boolean).join(' ');
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)}</title>
<style>
:root{--bg-canvas:#f2ece1;--bg-paper:#fffdf8;--bg-card-back:#f5ebd9;--bg-wood:#5b3a24;--bg-wood-dark:#3d2516;--bg-header:#fdf9f0;--ink-primary:#231912;--ink-secondary:#5a4638;--ink-muted:#755e4e;--accent:#8f3418;--accent-soft:#f9e6df;--season-bg:#e7f0e4;--season-ink:#234d20;--border-warm:#d6c5ae;--border-strong:#6e523d;--focus-ring:#0b5cab;--font-serif:Georgia,'Times New Roman',serif;--font-sans:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
body.simple-mode{--bg-canvas:#fff;--bg-paper:#fff;--bg-header:#f4f4f4;--ink-primary:#111;--ink-secondary:#222;--ink-muted:#444;--border-warm:#222;--border-strong:#000}
*{box-sizing:border-box}
body{margin:0;padding:24px;background:var(--bg-canvas);color:var(--ink-primary);font-family:var(--font-sans);font-size:15px;line-height:1.5}
body.simple-mode{font-size:17px}
.app-header{position:sticky;top:0;z-index:20;background:var(--bg-header);border-bottom:2px solid var(--border-warm);padding:10px 14px;display:flex;flex-direction:column;gap:8px;max-width:860px;margin:0 auto 16px;border-radius:12px}
.header-top-row{display:flex;align-items:center;justify-content:space-between;gap:8px}
.brand-title{font-family:var(--font-serif);font-weight:700;font-size:16px}
.simple-toggle{appearance:none;background:var(--bg-paper);color:var(--ink-primary);border:2px solid var(--border-strong);border-radius:999px;padding:5px 11px;font-size:12.5px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.simple-toggle[aria-pressed="true"]{background:var(--ink-primary);color:var(--bg-paper)}
.toggle-state{padding:1px 6px;border-radius:999px;background:var(--accent-soft);color:var(--accent);font-size:11.5px}
.header-meta-row{display:flex;gap:6px;flex-wrap:wrap;font-size:11.5px}
.location-chip{background:var(--season-bg);color:var(--season-ink);padding:3px 8px;border-radius:6px;font-weight:600;border:1px solid rgba(35,77,32,.25)}
.location-uncertain{background:#fff4cc;color:#332400;border-color:#8a6d1b}
.offline-chip{color:var(--ink-secondary);background:rgba(90,70,56,.08);padding:3px 8px;border-radius:6px;font-weight:600}
.search-bar{display:flex;align-items:center;background:var(--bg-paper);border:1.5px solid var(--border-strong);border-radius:8px;padding:5px 10px;gap:6px}
.search-bar input{border:none;background:transparent;width:100%;font-size:13px;color:var(--ink-primary);font-family:inherit}
.a11y-notice{display:none;background:#fff4cc;color:#332400;border:1px solid #8a6d1b;padding:6px 10px;border-radius:6px;font-size:12px;font-weight:600}
body.simple-mode .a11y-notice{display:block}
.dev-banner{background:#fff4cc;color:#332400;border:2px solid #8a6d1b;border-radius:8px;padding:8px 10px;font-size:12.5px}
.page{max-width:860px;margin:0 auto;display:flex;flex-direction:column;gap:12px}
.cardbox-drawing{background:linear-gradient(180deg,var(--bg-wood) 0%,var(--bg-wood-dark) 100%);color:#fdf8ee;border-radius:14px 14px 8px 8px;padding:12px 14px;border:2px solid #2b180d}
.cardbox-slot-label{font-size:10.5px;text-transform:uppercase;letter-spacing:.08em;color:#e4cfb6;margin-bottom:4px;display:flex;justify-content:space-between}
.cardbox-active-plaque{background:#f7eedc;color:#231912;border:2px solid #b59772;border-radius:6px;padding:6px 12px;font-family:var(--font-serif);font-weight:700;font-size:16px;text-align:center}
.tabs-stack{display:flex;gap:4px;padding:0 6px;flex-wrap:wrap}
.folder-tab{background:var(--bg-card-back);border:1.5px solid var(--border-strong);border-radius:8px 8px 0 0;padding:4px 10px;font-size:11.5px;font-weight:700;color:var(--ink-secondary);cursor:pointer}
.folder-tab.active{background:var(--bg-paper);color:var(--accent)}
.recipe-folio-card{background:var(--bg-paper);border:2px solid var(--border-strong);border-radius:0 12px 12px 12px;padding:14px;display:flex;flex-direction:column;gap:10px}
.simple-list-fallback{display:none;flex-direction:column;gap:10px}
body.simple-mode .cardbox-visual-only{display:none}
body.simple-mode .simple-list-fallback{display:flex}
.card-photo-wrap{border-radius:8px;overflow:hidden;border:1px solid var(--border-warm);background:#efe5d5;margin:0}
.card-photo-wrap img{display:block;width:100%;height:auto}
.card-title{margin:0;font-family:var(--font-serif);font-size:19px}
.card-desc{margin:0;color:var(--ink-secondary);font-size:13.5px}
.card-meta-line{display:flex;justify-content:space-between;gap:8px;padding-top:6px;border-top:1px dashed var(--border-warm);font-size:12.5px;font-weight:600}
.tag-list{display:flex;flex-wrap:wrap;gap:5px}
.tag{background:var(--bg-card-back);color:var(--ink-primary);padding:2px 8px;border-radius:4px;font-size:11.5px;font-weight:600;border:1px solid var(--border-warm)}
.tag.season{background:var(--season-bg);color:var(--season-ink);border-color:rgba(35,77,32,.3)}
.card-actions{display:grid;grid-template-columns:1fr 1.4fr 1fr;gap:6px}
.btn{appearance:none;border:1.5px solid var(--border-strong);background:var(--bg-paper);color:var(--ink-primary);padding:8px 10px;border-radius:8px;font-weight:700;font-size:12.5px;cursor:pointer;text-align:center;text-decoration:none;display:inline-block}
.btn-primary{background:var(--accent);color:#fff;border-color:var(--accent)}
.cardbox-footer-link{margin-top:auto;text-align:center;padding:10px;border-top:1px solid var(--border-warm);font-size:13px;font-weight:700;color:var(--accent)}
.alpha-letter{font-family:var(--font-serif);font-size:16px;font-weight:700;color:var(--accent);border-bottom:2px solid var(--border-warm);padding-bottom:2px;margin:12px 0 8px}
.index-item{padding:10px;background:var(--bg-paper);border:1px solid var(--border-warm);border-radius:8px;margin-bottom:8px}
.index-item-title{font-family:var(--font-serif);font-weight:700;font-size:15px;margin:0}
.reading-nav-bar{display:flex;flex-wrap:wrap;gap:5px;padding:8px;background:var(--bg-card-back);border:1px solid var(--border-warm);border-radius:8px}
.reading-nav-bar .btn{padding:5px 8px;font-size:11.5px;flex:1}
.recipe-header-title{font-family:var(--font-serif);font-size:21px;margin:4px 0 2px}
.license-caption{font-size:11px;color:var(--ink-muted);padding:5px 8px;background:var(--bg-card-back);border-top:1px solid var(--border-warm)}
.season-highlight-box{background:var(--season-bg);color:var(--season-ink);border:1px solid rgba(35,77,32,.35);border-radius:8px;padding:8px 10px;font-size:12.5px}
.section-subtitle{font-family:var(--font-serif);font-size:15px;margin:8px 0 4px;border-bottom:1px solid var(--border-warm);padding-bottom:3px}
</style>
</head>
<body class="${escapeHtml(cls)}">
${renderAppHeader({ catalog, envMode })}
<main class="page">
${body}
</main>
</body>
</html>`;
}

function folioImageSrc(recipe, pageKind) {
  const file = recipe?.imagenPrincipal?.archivo || 'plato.webp';
  if (pageKind === 'home') return `recetas/${recipe.slug}/${file}`;
  return file;
}

function renderTags(recipe) {
  const seasons = Array.isArray(recipe.estaciones) ? recipe.estaciones.join(' · ') : '';
  const tags = [
    ...(seasons ? [`<span class="tag season">${escapeHtml(seasons)}</span>`] : []),
    ...(Array.isArray(recipe.tags) ? recipe.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`) : [])
  ];
  return `<div class="tag-list">${tags.join('')}</div>`;
}

function renderTabs(recipes, activeSlug) {
  const indexTab = `<a class="folder-tab" href="/indice/">Índice</a>`;
  const tabs = recipes
    .map((r) => {
      const initial = String(r.titulo ?? r.slug).trim().charAt(0).toUpperCase();
      const short = String(r.titulo ?? r.slug).split(' ').pop() ?? r.slug;
      const active = r.slug === activeSlug ? ' active' : '';
      return `<a class="folder-tab${active}" href="/recetas/${escapeHtml(r.slug)}/">${escapeHtml(initial)} · ${escapeHtml(short)}</a>`;
    })
    .join('');
  return `<div class="tabs-stack" role="tablist" aria-label="Pestañas del fichero">${indexTab}${tabs}</div>`;
}

function renderSimpleFallback(recipes, pageKind) {
  const items = recipes
    .map(
      (r, i) => `<div class="index-item">
  <div class="index-item-header"><h3 class="index-item-title">${i + 1}. ${escapeHtml(r.titulo)}</h3><span>${escapeHtml(formatMinutes(r.tiempoTotalMin))}</span></div>
  <p class="card-desc">${escapeHtml(r.descripcionBreve ?? '')}</p>
  <a class="btn btn-primary" href="/recetas/${escapeHtml(r.slug)}/">Abrir receta</a>
</div>`
    )
    .join('');
  return `<div class="simple-list-fallback" aria-label="Navegación de lista accesible">${items}</div>`;
}

/**
 * Portafichero view: wooden drawer plaque with the active title,
 * staggered folder tabs, folio summary card and Índice footer link.
 */
export function renderPortaficheroPage({ recipes, catalog = {}, envMode = 'production' }) {
  const list = Array.isArray(recipes) ? recipes : [];
  const activeSlug = resolveActiveSlug(list, catalog);
  const active = list.find((r) => r.slug === activeSlug) ?? list[0] ?? null;
  const activeTitle = active?.titulo ?? 'Índice';
  const position = active ? list.findIndex((r) => r.slug === active.slug) + 1 : 0;

  const folio = active
    ? `<article class="recipe-folio-card" aria-live="polite">
  <figure class="card-photo-wrap"><img src="${escapeHtml(folioImageSrc(active, 'home'))}" alt="${escapeHtml(active.imagenPrincipal?.alt ?? active.titulo)}" /></figure>
  <h3 class="card-title">${escapeHtml(active.titulo)}</h3>
  <p class="card-desc">${escapeHtml(active.descripcionBreve ?? '')}</p>
  <div class="card-meta-line"><span>⏱ Tiempo total: ${escapeHtml(formatMinutes(active.tiempoTotalMin))}</span><span>${escapeHtml(String(active.porciones ?? ''))} porciones</span></div>
  ${renderTags(active)}
  <div class="card-actions"><a class="btn" href="/">← Anterior</a><a class="btn btn-primary" href="/recetas/${escapeHtml(active.slug)}/">Sacar ficha</a><a class="btn" href="/">Siguiente →</a></div>
</article>`
    : '<p class="card-desc">Todavía no hay fichas publicadas.</p>';

  const body = `<div class="cardbox-stage cardbox-visual-only">
  <div class="cardbox-drawing" aria-label="Dibujo del portafichero">
    <div class="cardbox-slot-label"><span>CAJÓN DE FICHAS · ORDEN ALFABÉTICO</span><span>Ficha ${position} de ${list.length} visibles</span></div>
    <div class="cardbox-active-plaque" id="boxActiveTitle">${escapeHtml(activeTitle)}</div>
  </div>
  ${renderTabs(list, activeSlug)}
  ${folio}
</div>
${renderSimpleFallback(list, 'home')}
<div class="cardbox-footer-link"><a href="/indice/">Ir al Índice alfabético completo (A–Z) →</a></div>`;

  return pageShell({ title: 'Recetas de Estación — Portafichero', catalog, envMode, bodyClass: '', body });
}

/**
 * Book-style alphabetical Index (A–Z) of the same collection.
 */
export function renderIndicePage({ recipes, catalog = {}, envMode = 'production' }) {
  const list = Array.isArray(recipes) ? recipes : [];
  const groups = groupRecipesAlphabetically(list);
  const groupsHtml = groups
    .map(
      (group) => `<section class="alpha-group"><div class="alpha-letter">${escapeHtml(group.letter)}</div>
${group.items
  .map(
    (r) => `<article class="index-item">
  <div class="index-item-header"><h3 class="index-item-title">${escapeHtml(r.titulo)}</h3><span style="font-size:12px;">${escapeHtml(formatMinutes(r.tiempoTotalMin))}</span></div>
  <p class="card-desc">${escapeHtml(r.descripcionBreve ?? '')}</p>
  ${renderTags(r)}
  <p><a class="btn" href="/recetas/${escapeHtml(r.slug)}/">Abrir ficha</a></p>
</article>`
  )
  .join('')}
</section>`
    )
    .join('');

  const body = `<h2 class="recipe-header-title">Índice</h2>
<p class="card-desc">Lista tipo índice de libro, agrupada alfabéticamente (A–Z) sobre la misma colección del portafichero.</p>
${groupsHtml || '<p class="card-desc">Todavía no hay fichas publicadas.</p>'}
<div class="cardbox-footer-link"><a href="/">← Volver al portafichero</a></div>`;

  return pageShell({ title: 'Recetas de Estación — Índice', catalog, envMode, bodyClass: '', body });
}

function renderIngredientItem(item) {
  if (item && typeof item.texto === 'string' && item.texto.trim()) {
    return `<li>${escapeHtml(item.texto.trim())}</li>`;
  }
  const parts = [item?.cantidad, item?.unidad, item?.nombre].filter((p) => p !== undefined && p !== null && String(p).trim() !== '');
  const nombre = parts.map((p) => escapeHtml(String(p))).join(' ');
  const nota = item?.nota ? `, <em>${escapeHtml(item.nota)}</em>` : '';
  return `<li><strong>${nombre}</strong>${nota}</li>`;
}

function renderSeasonHighlight(recipe, catalog) {
  const seasonalityCatalog = catalog?.seasonalityCatalog ?? null;
  const subregionId = catalog?.subregionId ?? catalog?.location?.subregion ?? null;
  const estacion = catalog?.estacionActual ?? catalog?.location?.estacionActual ?? null;
  let names = [];
  if (seasonalityCatalog && subregionId && estacion) {
    try {
      names = getRecipeSeasonalHighlights(recipe, seasonalityCatalog, subregionId, estacion).map((p) => p.nombre ?? p.id);
    } catch {
      names = [];
    }
  }
  if (names.length === 0 && Array.isArray(recipe?.productosEstacion)) {
    names = recipe.productosEstacion.map((id) => {
      const found = seasonalityCatalog?.productos?.find((p) => p.id === id);
      return found?.nombre ?? id;
    });
  }
  if (names.length === 0) return '';
  const place = catalog?.location?.subregionNombre && estacion
    ? ` (AR · ${catalog.location.subregionNombre} · ${estacion})`
    : '';
  return `<div class="season-highlight-box"><strong>En estación ahora${escapeHtml(place)}:</strong> ${escapeHtml(names.join(', '))} (vínculo explícito al catálogo estacional).</div>`;
}

/**
 * Recipe Reading view: nav bar, Pagefind-scoped article, mandatory dish
 * photo immediately after the title, seasonal box, hybrid ingredients and
 * Pagefind-ignored steps/notes/source.
 */
export function renderRecipePage({ recipe, recipes, catalog = {}, envMode = 'production' }) {
  if (!recipe) throw new Error('renderRecipePage requiere una receta publicada');
  const list = Array.isArray(recipes) ? recipes : [recipe];
  const img = recipe.imagenPrincipal ?? {};
  const photoSrc = img.archivo || 'plato.webp';
  const caption = [img.origen, img.autor ? `Autor: ${img.autor}` : null, img.licencia ? `Licencia: ${img.licencia}` : null, 'Sin IA']
    .filter(Boolean)
    .join(' · ');

  const ingredientes = Array.isArray(recipe.ingredientes) ? recipe.ingredientes.map(renderIngredientItem).join('') : '';
  const pasos = Array.isArray(recipe.pasos)
    ? recipe.pasos
        .map((paso) => {
          const photo = paso?.foto
            ? `<figure class="card-photo-wrap"><img src="${escapeHtml(paso.foto.archivo)}" alt="${escapeHtml(paso.foto.alt ?? '')}" /><figcaption class="license-caption">${escapeHtml([paso.foto.origen, paso.foto.autor, paso.foto.licencia].filter(Boolean).join(' · '))}</figcaption></figure>`
            : '';
          return `<li>${escapeHtml(paso?.texto ?? '')}${photo}</li>`;
        })
        .join('')
    : '';

  const body = `<nav class="reading-nav-bar" aria-label="Navegación dentro de la lectura">
  <a class="btn" href="/indice/">Buscador</a>
  <a class="btn" href="/">← Anterior</a>
  <a class="btn" href="/">Siguiente →</a>
  <a class="btn" href="/indice/">Índice</a>
  <a class="btn btn-primary" href="/">Volver al portafichero</a>
</nav>
<article data-pagefind-body>
<h2 class="recipe-header-title" data-pagefind-weight="10">${escapeHtml(recipe.titulo)}</h2><figure class="dish-photo card-photo-wrap"><img src="${escapeHtml(photoSrc)}" alt="${escapeHtml(img.alt ?? recipe.titulo)}" /><figcaption class="license-caption">${escapeHtml(img.origen ?? '')} · Autor: ${escapeHtml(img.autor ?? '')} · Licencia: ${escapeHtml(img.licencia ?? '')} · ${escapeHtml(caption.includes('Sin IA') ? 'Sin IA' : 'Sin IA')}</figcaption></figure>
<div style="font-size:12px;color:var(--ink-secondary);">Prep: ${escapeHtml(formatMinutes(recipe.tiempoPreparacionMin))} · Cocción: ${escapeHtml(formatMinutes(recipe.tiempoCoccionMin))} · Total: <strong>${escapeHtml(formatMinutes(recipe.tiempoTotalMin))}</strong> · ${escapeHtml(String(recipe.porciones ?? ''))} porciones · ${escapeHtml(recipe.dificultad ?? '')}</div>
${renderSeasonHighlight(recipe, catalog)}
<div data-pagefind-weight="8"><p class="card-desc">${escapeHtml(recipe.categoriaPrincipal ?? '')}</p>${renderTags(recipe)}</div>
<p class="card-desc">${escapeHtml(recipe.descripcionBreve ?? '')}</p>
<h3 class="section-subtitle">Ingredientes (${escapeHtml(String(recipe.porciones ?? ''))} porciones)</h3>
<ul class="ingredients-list">${ingredientes}</ul>
<section data-pagefind-ignore="all">
<h3 class="section-subtitle">Pasos de preparación</h3>
<ol class="steps-list">${pasos}</ol>
</section>
<div data-pagefind-ignore="all">
${recipe.notas ? `<p class="card-desc">Notas: ${escapeHtml(recipe.notas)}</p>` : ''}
${recipe.fuente ? `<p class="card-desc">Fuente: ${escapeHtml(recipe.fuente.detalle ?? recipe.fuente.tipo ?? '')}</p>` : ''}
</div>
</article>`;

  void list;
  return pageShell({ title: `${recipe.titulo} — Recetas de Estación`, catalog, envMode, bodyClass: '', body });
}

export { SEARCH_PLACEHOLDER };
