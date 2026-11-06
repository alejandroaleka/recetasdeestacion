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

test('S4: indice renders the same collection as a book-style A–Z list', () => {
  const html = renderIndicePage({ recipes: sampleRecipes(), catalog: catalogForTests(), envMode: 'production' });
  for (const letter of ['L', 'P', 'R', 'T']) {
    assert.ok(html.includes(`>${letter}<`), `expected group ${letter}`);
  }
  assert.match(html, /Locro Criollo de Zapallo Cabutia/);
  assert.match(html, /Ragú Bolognesa Tradicional/);
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
