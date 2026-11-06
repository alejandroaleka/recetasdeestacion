import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  filterVisibleRecipes,
  createCatalogNavigator,
  groupRecipesAlphabetically,
  resolveSimpleReadingMode
} from '../src/lib/navigation.mjs';

import {
  renderPortaficheroPage,
  renderIndicePage,
  renderRecipePage
} from '../src/lib/render-pages.mjs';

import { buildSite } from '../scripts/build.mjs';
import { assertNoKeystaticInDist } from '../src/lib/keystatic-guard.mjs';

function sampleRecipes() {
  return [
    {
      slug: 'locro-criollo',
      titulo: 'Locro Criollo de Zapallo Cabutia',
      descripcionBreve: 'Guiso espeso de maíz blanco y zapallo cabutia.',
      imagenPrincipal: {
        archivo: 'plato.webp',
        origen: 'Archivo propio',
        autor: 'A. Aleka',
        licencia: 'Dominio público (CC0)',
        alt: 'Cazuela de locro criollo'
      },
      tiempoTotalMin: 160,
      porciones: 6,
      dificultad: 'Media',
      categoriaPrincipal: 'Guisos',
      tags: ['Guisos', 'Olla'],
      estaciones: ['Otoño', 'Invierno'],
      productosEstacion: ['zapallo-cabutia'],
      ingredientes: [
        { cantidad: 400, unidad: 'g', nombre: 'maíz blanco pisado' },
        { texto: 'Sal gruesa a gusto' }
      ],
      pasos: [{ texto: 'Hervir el maíz una hora.' }],
      estado: 'publicada'
    },
    {
      slug: 'pure-zapallo',
      titulo: 'Puré Rústico de Zapallo Asado',
      descripcionBreve: 'Zapallo cabutia horneado con salvia.',
      imagenPrincipal: {
        archivo: 'plato.webp',
        origen: 'Archivo propio',
        autor: 'A. Aleka',
        licencia: 'CC0',
        alt: 'Fuente con puré de zapallo'
      },
      tiempoTotalMin: 45,
      porciones: 4,
      dificultad: 'Fácil',
      categoriaPrincipal: 'Guarniciones',
      tags: ['Horno', 'Vegetariano'],
      estaciones: ['Invierno'],
      productosEstacion: ['zapallo-cabutia'],
      ingredientes: [{ cantidad: 1200, unidad: 'g', nombre: 'zapallo cabutia' }],
      pasos: [{ texto: 'Hornear 35 minutos.' }],
      estado: 'publicada'
    },
    {
      slug: 'ragu-bolognesa',
      titulo: 'Ragú Bolognesa Tradicional',
      descripcionBreve: 'Cocción lenta de carne cortada a cuchillo.',
      imagenPrincipal: {
        archivo: 'plato.webp',
        origen: 'Archivo propio',
        autor: 'A. Aleka',
        licencia: 'Dominio público (CC0)',
        alt: 'Plato de tagliatelle con ragú'
      },
      tiempoTotalMin: 210,
      porciones: 4,
      dificultad: 'Media',
      categoriaPrincipal: 'Pastas',
      tags: ['Pastas', 'Olla'],
      estaciones: ['Otoño', 'Invierno'],
      productosEstacion: ['puerro'],
      ingredientes: [
        { cantidad: 400, unidad: 'g', nombre: 'carne vacuna', nota: 'cortada a cuchillo' },
        { texto: 'Sal gruesa a gusto' }
      ],
      pasos: [
        { texto: 'Dorar la carne.' },
        {
          texto: 'Sumar el tomate y cocinar tapado.',
          foto: {
            archivo: 'paso-1.webp',
            origen: 'Archivo propio',
            autor: 'A. Aleka',
            licencia: 'CC0',
            alt: 'Olla con ragú'
          }
        }
      ],
      fuente: { tipo: 'propia', detalle: 'Cuaderno familiar' },
      notas: 'Mejor al día siguiente.',
      estado: 'publicada'
    },
    {
      slug: 'tarta-manzanas',
      titulo: 'Tarta Rústica de Manzanas',
      descripcionBreve: 'Masa quebrada con manzanas criollas.',
      imagenPrincipal: {
        archivo: 'plato.webp',
        origen: 'Archivo propio',
        autor: 'A. Aleka',
        licencia: 'CC BY 4.0',
        alt: 'Tarta de manzanas'
      },
      tiempoTotalMin: 65,
      porciones: 6,
      dificultad: 'Fácil',
      categoriaPrincipal: 'Dulces',
      tags: ['Dulces', 'Horno'],
      estaciones: ['Otoño'],
      productosEstacion: ['manzana'],
      ingredientes: [{ cantidad: 3, unidad: 'unidades', nombre: 'manzanas criollas' }],
      pasos: [{ texto: 'Hornear 40 minutos.' }],
      estado: 'publicada'
    }
  ];
}

function catalogForTests(overrides = {}) {
  return {
    location: {
      pais: 'AR',
      subregionNombre: 'Región Pampeana',
      estacionActual: 'Otoño',
      incertidumbre: false,
      mensajeIncertidumbre: null
    },
    seasonalityCatalog: null,
    subregionId: 'pampeana',
    estacionActual: 'Otoño',
    ...overrides
  };
}

test('S2: filterVisibleRecipes preserves alphabetical order and never reorders when filtering', () => {
  const recipes = sampleRecipes();
  const filtered = filterVisibleRecipes(recipes, { estacion: 'Otoño' });
  assert.deepEqual(
    filtered.map((r) => r.slug),
    ['locro-criollo', 'ragu-bolognesa', 'tarta-manzanas']
  );
  // Same relative order as input: alphabetical input stays alphabetical after filter.
  const titles = filtered.map((r) => r.titulo);
  assert.deepEqual([...titles].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' })), titles);

  const byTag = filterVisibleRecipes(recipes, { tag: 'Horno' });
  assert.deepEqual(
    byTag.map((r) => r.slug),
    ['pure-zapallo', 'tarta-manzanas']
  );

  const byCategoria = filterVisibleRecipes(recipes, { categoria: 'Pastas' });
  assert.deepEqual(
    byCategoria.map((r) => r.slug),
    ['ragu-bolognesa']
  );

  const all = filterVisibleRecipes(recipes, {});
  assert.deepEqual(
    all.map((r) => r.slug),
    recipes.map((r) => r.slug)
  );
});

test('S4: navigator next/prev step ONLY through visible recipes (filtered-out are skipped)', () => {
  const nav = createCatalogNavigator(sampleRecipes(), { estacion: 'Otoño' });
  assert.deepEqual(
    nav.getVisible().map((r) => r.slug),
    ['locro-criollo', 'ragu-bolognesa', 'tarta-manzanas']
  );
  assert.equal(nav.getActive().slug, 'locro-criollo');
  assert.equal(nav.next().slug, 'ragu-bolognesa');
  assert.equal(nav.next().slug, 'tarta-manzanas');
  // pure-zapallo (Invierno only) is never visited while the Otoño filter is on.
  assert.equal(nav.next().slug, 'locro-criollo');
  assert.equal(nav.prev().slug, 'tarta-manzanas');
});

test('S4: single shared activeSlug between Portafichero and Reading (A -> C stays C)', () => {
  const nav = createCatalogNavigator(sampleRecipes(), {});
  nav.setActive('locro-criollo');
  assert.equal(nav.getActiveSlug(), 'locro-criollo');
  // Simulate opening A in Portafichero, advancing twice in Reading.
  nav.next(); // pure-zapallo
  nav.next(); // ragu-bolognesa (C)
  assert.equal(nav.getActiveSlug(), 'ragu-bolognesa');
  // Returning to Portafichero keeps C active.
  assert.equal(nav.getActive().titulo, 'Ragú Bolognesa Tradicional');
});

test('S4: getActiveBoxTitle shows Índice in index mode and recipe title otherwise', () => {
  const nav = createCatalogNavigator(sampleRecipes(), {});
  nav.setActive('ragu-bolognesa');
  assert.equal(nav.getActiveBoxTitle('indice'), 'Índice');
  assert.equal(nav.getActiveBoxTitle('index'), 'Índice');
  assert.equal(nav.getActiveBoxTitle('portafichero'), 'Ragú Bolognesa Tradicional');
  assert.equal(nav.getActiveBoxTitle('reading'), 'Ragú Bolognesa Tradicional');
});

test('S4: groupRecipesAlphabetically groups A–Z with accent-normalized initials', () => {
  const groups = groupRecipesAlphabetically([
    { slug: 'a', titulo: 'Éclair de Vainilla' },
    { slug: 'b', titulo: 'Locro Criollo' },
    { slug: 'c', titulo: 'Ragú Bolognesa' },
    { slug: 'd', titulo: 'Ñoquis del 29' }
  ]);
  const letters = groups.map((g) => g.letter);
  assert.deepEqual(letters, ['E', 'L', 'N', 'R']);
  assert.deepEqual(groups[0].items.map((r) => r.slug), ['a']);
});

test('S4: resolveSimpleReadingMode hybrid activation (system auto + manual override, Sí/No)', () => {
  const def = resolveSimpleReadingMode({});
  assert.equal(def.active, false);
  assert.equal(def.source, 'default');
  assert.equal(def.label, 'Lectura simple');
  assert.equal(def.stateText, 'No');
  assert.equal(def.ariaPressed, 'false');
  assert.equal(def.notice, null);

  const sysMotion = resolveSimpleReadingMode({ prefersReducedMotion: true });
  assert.equal(sysMotion.active, true);
  assert.equal(sysMotion.source, 'system');
  assert.equal(sysMotion.stateText, 'Sí');
  assert.equal(sysMotion.ariaPressed, 'true');
  assert.ok(typeof sysMotion.notice === 'string' && sysMotion.notice.length > 0);

  const sysContrast = resolveSimpleReadingMode({ prefersHighContrast: true });
  assert.equal(sysContrast.active, true);
  assert.equal(sysContrast.source, 'system');

  // Manual override always prevails over system detection.
  const manualOff = resolveSimpleReadingMode({
    storedValue: false,
    prefersReducedMotion: true,
    prefersHighContrast: true
  });
  assert.equal(manualOff.active, false);
  assert.equal(manualOff.source, 'manual');
  assert.equal(manualOff.stateText, 'No');

  const manualOn = resolveSimpleReadingMode({ storedValue: true });
  assert.equal(manualOn.active, true);
  assert.equal(manualOn.source, 'manual');
  assert.equal(manualOn.stateText, 'Sí');
  assert.equal(manualOn.ariaPressed, 'true');
});

test('S4: fixed top header present in all views with search, location badge and Lectura simple toggle', () => {
  const recipes = sampleRecipes();
  const catalog = catalogForTests();
  const pages = [
    renderPortaficheroPage({ recipes, catalog, envMode: 'production' }),
    renderIndicePage({ recipes, catalog, envMode: 'production' }),
    renderRecipePage({ recipe: recipes[2], recipes, catalog, envMode: 'production' })
  ];
  for (const html of pages) {
    assert.match(html, /class="app-header"/);
    assert.match(html, /Buscar por plato, ingrediente o tag/);
    assert.match(html, /Lectura simple/);
    assert.match(html, /aria-pressed="(true|false)"/);
    assert.match(html, /AR · Región Pampeana · Otoño/);
  }
  const simpleOn = renderPortaficheroPage({
    recipes,
    catalog: catalogForTests({ simpleMode: true }),
    envMode: 'production'
  });
  assert.match(simpleOn, /aria-pressed="true"/);
  assert.match(simpleOn, /Sí/);

  const uncertain = renderPortaficheroPage({
    recipes,
    catalog: catalogForTests({
      location: {
        pais: 'AR',
        subregionNombre: null,
        estacionActual: null,
        incertidumbre: true,
        mensajeIncertidumbre: 'Falta elegir una subregión climática cubierta.'
      }
    }),
    envMode: 'production'
  });
  assert.match(uncertain, /subregión/i);
});

test('S4: development banner renders from buildDevIncompleteBanner when published recipes are incomplete', () => {
  const recipes = sampleRecipes();
  const catalog = catalogForTests({
    evaluation: {
      omitidas: [{ slug: 'guiso-roto', titulo: 'Guiso Roto', camposFaltantes: ['imagenPrincipal.licencia'] }]
    }
  });
  const dev = renderPortaficheroPage({ recipes, catalog, envMode: 'development' });
  assert.match(dev, /guiso-roto/);
  const prod = renderPortaficheroPage({ recipes, catalog, envMode: 'production' });
  assert.ok(!prod.includes('guiso-roto'), 'production must not render the dev banner');
});

test('S4: portafichero shows active drawer plaque, folio card, navigation and Índice link + simple fallback', () => {
  const recipes = sampleRecipes();
  const html = renderPortaficheroPage({
    recipes,
    catalog: catalogForTests({ activeSlug: 'ragu-bolognesa' }),
    envMode: 'production'
  });
  assert.match(html, /id="boxActiveTitle"/);
  assert.match(html, /Ragú Bolognesa Tradicional/);
  assert.match(html, /← Anterior/);
  assert.match(html, /Sacar ficha/);
  assert.match(html, /Siguiente →/);
  assert.match(html, /Índice/);
  assert.match(html, /Cocción lenta/);
  // Accessible fallback list exists for Lectura simple: Sí.
  const simple = renderPortaficheroPage({
    recipes,
    catalog: catalogForTests({ simpleMode: true }),
    envMode: 'production'
  });
  assert.match(simple, /simple-list-fallback/);
});

function renderedCssRule(html, selector) {
  const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
  const rule = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .find((match) => match[1].trim() === selector);
  assert.ok(rule, `expected rendered CSS rule: ${selector}`);
  return Object.fromEntries(rule[2].split(';').filter(Boolean).map((declaration) => {
    const separator = declaration.indexOf(':');
    return [declaration.slice(0, separator).trim(), declaration.slice(separator + 1).trim()];
  }));
}

const visualStage = 'body:not(.simple-mode) .cardbox-stage';

test('S4: portafichero illustration has 12px of breathing room before the tabs', () => {
  const html = renderPortaficheroPage({ recipes: sampleRecipes(), catalog: catalogForTests() });
  assert.match(html, /class="cardbox-stage cardbox-visual-only">\s*<div class="cardbox-drawing" aria-label="Dibujo del portafichero">[\s\S]*?<\/div>\s*<\/div>\s*<div class="tabs-stack" role="tablist" aria-label="Pestañas del fichero">/);
  assert.equal(renderedCssRule(html, `${visualStage} > .cardbox-drawing`)['margin-bottom'], '12px');
});

test('S4: selected tab hides its lower seam and covers the folio top border with paper', () => {
  const recipes = sampleRecipes();
  for (const activeSlug of recipes.map((recipe) => recipe.slug)) {
    const html = renderPortaficheroPage({ recipes, catalog: catalogForTests({ activeSlug }) });
    const selected = [...html.matchAll(/<a class="folder-tab active" href="([^"]+)">/g)];
    assert.deepEqual(selected.map((match) => match[1]), [`/recetas/${activeSlug}/`]);
    assert.match(html, /<\/a><\/div>\s*<article class="recipe-folio-card" aria-live="polite">/);
    const active = renderedCssRule(html, `${visualStage} > .tabs-stack > .folder-tab.active`);
    assert.equal(active['border-bottom-color'], 'var(--bg-paper)', 'hide the tab border without changing its height');
    assert.equal(active['box-shadow'], '0 2px 0 var(--bg-paper)', 'cover the entire 2px folio border, not just the tab border');
    assert.equal(active.position, 'relative');
    assert.equal(active['z-index'], '1', 'paint the seam cover above the following folio');
    assert.equal(renderedCssRule(html, '.folder-tab.active').background, 'var(--bg-paper)');
    assert.equal(renderedCssRule(html, '.recipe-folio-card').border, '2px solid var(--border-strong)');
    assert.equal(active.outline, undefined, 'retain the native keyboard focus outline');
  }
});

test('S4: folio styling preserves tab links, sizes, inactive borders and simple-reading isolation', () => {
  const recipes = sampleRecipes();
  const html = renderPortaficheroPage({ recipes, catalog: catalogForTests() });
  const tabs = [...html.matchAll(/<a class="folder-tab( active)?" href="([^"]+)">([^<]+)<\/a>/g)];
  assert.deepEqual(tabs.map((match) => [match[1] ?? '', match[2], match[3]]), [
    ['', '/indice/', 'Índice'],
    [' active', '/recetas/locro-criollo/', 'L · Cabutia'],
    ['', '/recetas/pure-zapallo/', 'P · Asado'],
    ['', '/recetas/ragu-bolognesa/', 'R · Tradicional'],
    ['', '/recetas/tarta-manzanas/', 'T · Manzanas']
  ]);
  assert.deepEqual(renderedCssRule(html, '.folder-tab'), {
    background: 'var(--bg-card-back)', border: '1.5px solid var(--border-strong)',
    'border-radius': '8px 8px 0 0', padding: '4px 10px', 'font-size': '11.5px',
    'font-weight': '700', color: 'var(--ink-secondary)', cursor: 'pointer'
  });
  assert.deepEqual(renderedCssRule(html, '.tabs-stack'), {
    display: 'flex', gap: '4px', padding: '0 6px', 'flex-wrap': 'wrap'
  });
  const simple = renderPortaficheroPage({ recipes, catalog: catalogForTests({ simpleMode: true }) });
  assert.match(simple, /<body class="simple-mode">/);
  assert.equal(renderedCssRule(simple, 'body.simple-mode .cardbox-visual-only').display, 'none');
  assert.equal(renderedCssRule(simple, 'body.simple-mode .simple-list-fallback').display, 'flex');
  assert.equal((simple.match(/>Abrir receta<\/a>/g) ?? []).length, recipes.length);
  for (const otherView of [
    renderIndicePage({ recipes, catalog: catalogForTests() }),
    renderRecipePage({ recipe: recipes[0], recipes, catalog: catalogForTests() })
  ]) {
    assert.doesNotMatch(otherView, /class="(?:cardbox-stage|cardbox-drawing|tabs-stack|folder-tab)[^"]*"/);
  }
});

test('S4: indice renders the same collection as a book-style A–Z list', () => {
  const html = renderIndicePage({ recipes: sampleRecipes(), catalog: catalogForTests(), envMode: 'production' });
  for (const letter of ['L', 'P', 'R', 'T']) {
    assert.ok(html.includes(`>${letter}<`), `expected group ${letter}`);
  }
  assert.match(html, /Locro Criollo de Zapallo Cabutia/);
  assert.match(html, /Ragú Bolognesa Tradicional/);
});

test('S8: Direction 03 high-contrast magazine typography and user scales (1.02 / 0.94) apply across views', () => {
  const recipes = sampleRecipes();
  const catalog = catalogForTests({ activeSlug: 'ragu-bolognesa' });
  const portafichero = renderPortaficheroPage({ recipes, catalog, envMode: 'production' });
  const indice = renderIndicePage({ recipes, catalog, envMode: 'production' });
  const reading = renderRecipePage({ recipe: recipes[2], recipes, catalog, envMode: 'production' });

  for (const html of [portafichero, indice, reading]) {
    const root = renderedCssRule(html, ':root');
    assert.match(root['--font-serif'], /Instrument Serif/);
    assert.match(root['--font-serif'], /Baskerville Old Face/);
    assert.match(root['--font-sans'], /DM Sans/);
    assert.match(root['--font-sans'], /Verdana/);
    assert.equal(root['--title-scale'], '1.02');
    assert.equal(root['--body-scale'], '0.94');

    const bodyRule = renderedCssRule(html, 'body');
    assert.equal(bodyRule['font-family'], 'var(--font-sans)');
    assert.equal(bodyRule['font-size'], 'calc(14.5px * var(--body-scale))');
    assert.equal(bodyRule['line-height'], '1.55');
  }

  const plaque = renderedCssRule(portafichero, '.cardbox-active-plaque');
  assert.equal(plaque.background, 'var(--ink-primary)');
  assert.equal(plaque.color, '#fffdf8');
  assert.equal(plaque['font-family'], 'var(--font-serif)');
  assert.equal(plaque['font-size'], 'calc(22px * var(--title-scale))');

  const cardTitle = renderedCssRule(portafichero, '.card-title');
  assert.equal(cardTitle['font-family'], 'var(--font-serif)');
  assert.equal(cardTitle['font-size'], 'calc(28px * var(--title-scale))');
  assert.equal(cardTitle['letter-spacing'], '-.02em');

  const headerTitle = renderedCssRule(reading, '.recipe-header-title');
  assert.equal(headerTitle['font-family'], 'var(--font-serif)');
  assert.equal(headerTitle['font-size'], 'calc(33px * var(--title-scale))');
  assert.equal(headerTitle['letter-spacing'], '-.02em');

  const alphaLetter = renderedCssRule(indice, '.alpha-letter');
  assert.equal(alphaLetter['font-family'], 'var(--font-serif)');
  assert.equal(alphaLetter['font-size'], 'calc(28px * var(--title-scale))');

  const ingCard = renderedCssRule(reading, '.ingredients-list li');
  assert.equal(ingCard.background, 'var(--bg-header)');
  assert.equal(ingCard['border-radius'], '8px');

  const stepNum = renderedCssRule(reading, '.steps-list > li::before');
  assert.equal(stepNum['font-family'], 'var(--font-serif)');
  assert.equal(stepNum.color, 'var(--accent)');
});

test('S4: recipe reading marks Pagefind scope, mandatory dish photo right after title, seasonal box, hybrid ingredients and ignored steps', () => {
  const recipes = sampleRecipes();
  const html = renderRecipePage({ recipe: recipes[2], recipes, catalog: catalogForTests(), envMode: 'production' });
  assert.match(html, /Buscador/);
  assert.match(html, /Anterior/);
  assert.match(html, /Siguiente/);
  assert.match(html, /Índice/);
  assert.match(html, /Volver al portafichero/);
  assert.match(html, /data-pagefind-body/);
  assert.match(html, /data-pagefind-weight="10"/);
  assert.match(html, /data-pagefind-weight="8"/);
  assert.match(html, /data-pagefind-ignore="all"/);

  // Dish photo figure immediately after the title element.
  const titleIdx = html.search(/data-pagefind-weight="10"/);
  const figureIdx = html.indexOf('<figure class="dish-photo');
  assert.ok(titleIdx !== -1 && figureIdx !== -1 && figureIdx > titleIdx, 'figure must follow the title');
  const between = html.slice(titleIdx, figureIdx);
  assert.ok(!between.includes('<h3') && !between.includes('season-highlight'), 'no section may sit between title and photo');
  assert.match(html, /<figure class="dish-photo/);
  assert.match(html, /Dominio público \(CC0\)/);
  assert.match(html, /A\. Aleka/);
  assert.match(html, /alt="Plato de tagliatelle con ragú"/);

  // Hybrid ingredients: structured + free text.
  assert.match(html, /carne vacuna/);
  assert.match(html, /Sal gruesa a gusto/);

  // Steps and notes/source are ignored by Pagefind (T4 indexes only title/tags/category/desc/ingredients).
  const stepsSection = html.match(/<section[^>]*data-pagefind-ignore="all"[^>]*>[\s\S]*?<\/section>/);
  assert.ok(stepsSection, 'numbered steps live inside a data-pagefind-ignore section');
  assert.match(html, /Cuaderno familiar/);
});

test('S2+S4: buildSite generates static views, catalogo.json, build report and images, and passes the Keystatic guard', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'recetario-t3-'));
  const outDir = path.join(tmpRoot, 'dist');
  const reportPath = path.join(tmpRoot, '.astro', 'build-report.json');
  try {
    const result = await buildSite({ outDir, reportPath, envMode: 'production' });
    assert.ok(result.publicadas.length >= 3, 'expected at least 3 published recipes from disk');
    assert.ok(fs.existsSync(path.join(outDir, 'index.html')));
    assert.ok(fs.existsSync(path.join(outDir, 'indice', 'index.html')));
    for (const slug of result.publicadas.map((r) => r.slug)) {
      assert.ok(fs.existsSync(path.join(outDir, 'recetas', slug, 'index.html')), `missing page for ${slug}`);
      assert.ok(fs.existsSync(path.join(outDir, 'recetas', slug, 'plato.webp')), `missing image for ${slug}`);
    }
    const portafichero = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
    assert.match(portafichero, /id="boxActiveTitle"/);
    const reading = fs.readFileSync(
      path.join(outDir, 'recetas', result.publicadas[0].slug, 'index.html'),
      'utf8'
    );
    assert.match(reading, /<figure class="dish-photo/);
    assert.match(reading, /data-pagefind-body/);

    const catalogo = JSON.parse(fs.readFileSync(path.join(outDir, 'catalogo.json'), 'utf8'));
    assert.ok(Array.isArray(catalogo) && catalogo.length >= 3);
    assert.ok(catalogo[0].ingredientesNombres.length > 0, 'catalogo.json carries ingredient names');

    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    assert.ok(report.totalPublicadas >= 3);
    assert.ok(fs.existsSync(reportPath));

    const guard = assertNoKeystaticInDist(outDir);
    assert.equal(guard.clean, true);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
