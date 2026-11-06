import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  normalizeSearchText,
  createNormalizedHtmlCopy,
  buildPagefindIndex,
  resolveMatchedField,
  searchCatalog
} from '../src/lib/search.mjs';

import { buildSite } from '../scripts/build.mjs';
import {
  filterVisibleRecipes,
  createCatalogNavigator
} from '../src/lib/navigation.mjs';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function listFilesRecursive(root, base = root) {
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(full, base));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}

async function buildTmpSite() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'recetario-t4-'));
  const outDir = path.join(tmpRoot, 'dist');
  const reportPath = path.join(tmpRoot, '.astro', 'build-report.json');
  const result = await buildSite({ outDir, reportPath, envMode: 'production' });
  const catalogo = readJson(path.join(outDir, 'catalogo.json'));
  const bundle = readJson(path.join(outDir, 'pagefind', 'pagefind-entry.json'));
  return { tmpRoot, outDir, reportPath, result, catalogo, bundle };
}

function recipeMetaBySlug(catalogo, slug) {
  const entry = catalogo.find((item) => item.slug === slug);
  assert.ok(entry, `catalogo.json must contain recipe ${slug}`);
  return entry;
}

// ---------------------------------------------------------------------------
// normalizeSearchText: accent-insensitive normalization on both sides.
// ---------------------------------------------------------------------------

test('S5: normalizeSearchText removes diacritics and normalizes case/whitespace', () => {
  assert.equal(normalizeSearchText('Ragú'), 'ragu');
  assert.equal(normalizeSearchText('puré'), 'pure');
  assert.equal(normalizeSearchText('Otoño'), 'otono');
  assert.equal(normalizeSearchText('Puré Rústico de Zapallo'), 'pure rustico de zapallo');
  assert.equal(normalizeSearchText('  Cocción   LENTA '), 'coccion lenta');
  assert.equal(normalizeSearchText('PASTAS'), 'pastas');
  assert.equal(normalizeSearchText(''), '');
  assert.equal(normalizeSearchText(null), '');
});

// ---------------------------------------------------------------------------
// createNormalizedHtmlCopy: in-memory normalized copy for the indexer.
// ---------------------------------------------------------------------------

test('S5: createNormalizedHtmlCopy strips ignored sections and normalizes text nodes only', () => {
  const html = `<!DOCTYPE html>
<html lang="es"><head><title>Ragú Bolognesa Tradicional</title></head>
<body><article data-pagefind-body>
<h2 data-pagefind-weight="10">Ragú Bolognesa Tradicional</h2>
<img src="/recetas/ragu-bolognesa/plato.webp" alt="Ragú en plato" />
<p class="card-desc">Cocción lenta de carne cortada a cuchillo.</p>
<section data-pagefind-ignore="all"><h3>Pasos</h3><ol><li>Desglasar con vino.</li></ol></section>
<div data-pagefind-ignore="all"><p>Notas: secreta con arenar y cuchara.</p></div>
</article></body></html>`;
  const copy = createNormalizedHtmlCopy(html);

  // Input is untouched (strings are immutable; the served HTML keeps tildes).
  assert.ok(html.includes('Ragú'));

  // Ignored steps/notes/source sections are gone from the indexing copy.
  assert.ok(!copy.toLowerCase().includes('desglasar'), 'steps-only word must not leak into the index copy');
  assert.ok(!copy.includes('arenar'), 'notes-only word must not leak into the index copy');

  // Text nodes are accent-normalized in the copy.
  assert.ok(copy.includes('Ragu Bolognesa Tradicional'), 'title text node loses tildes in the copy');
  assert.ok(copy.includes('Coccion lenta'), 'description text node loses tildes in the copy');

  // Tags, attributes and URLs stay byte-identical.
  assert.ok(copy.includes('data-pagefind-body'), 'indexing scope marker is preserved');
  assert.ok(copy.includes('data-pagefind-weight="10"'), 'weight attributes are preserved');
  assert.ok(copy.includes('src="/recetas/ragu-bolognesa/plato.webp"'), 'URLs are preserved');
  assert.ok(copy.includes('alt="Ragú en plato"'), 'attribute values are not text nodes: preserved verbatim');
  assert.ok(copy.includes('<section') === false, 'ignored section tags are removed with their content');
});

test('S5: createNormalizedHtmlCopy only normalizes inside data-pagefind-body', () => {
  const html = '<html><head><title>Puré de Otoño</title></head>'
    + '<body><article data-pagefind-body><p class="card-desc">Puré tibio</p></article></body></html>';
  const copy = createNormalizedHtmlCopy(html);
  assert.ok(copy.includes('<title>Puré de Otoño</title>'), 'head outside the body scope is preserved verbatim');
  assert.ok(copy.includes('Pure tibio'), 'text inside data-pagefind-body is normalized');
});

// ---------------------------------------------------------------------------
// buildSite + buildPagefindIndex: offline-precacheable Pagefind bundle.
// ---------------------------------------------------------------------------

test('S5: buildSite emits dist/pagefind/ with version, languages, page count and normalized records', async () => {
  const { tmpRoot, outDir, result, bundle } = await buildTmpSite();
  try {
    assert.ok(result.pagefind, 'buildSite must return a pagefind summary');
    assert.equal(result.pagefind.pageCount, result.publicadas.length);

    assert.ok(fs.existsSync(path.join(outDir, 'pagefind', 'pagefind-entry.json')));
    assert.ok(fs.existsSync(path.join(outDir, 'pagefind', 'pagefind.js')));

    assert.equal(typeof bundle.version, 'number');
    assert.ok(Array.isArray(bundle.languages) && bundle.languages.includes('es'));
    assert.equal(bundle.pageCount, result.publicadas.length);
    assert.equal(bundle.records.length, result.publicadas.length);

    for (const record of bundle.records) {
      assert.match(record.url, /^\/recetas\/[^/]+\/$/);
      assert.ok(record.slug, 'record carries its slug');
      assert.ok(record.titleNorm, 'record carries the normalized title');
      assert.ok(record.excerpt, 'record carries a normalized excerpt');
      assert.equal(/[áéíóúüñÁÉÍÓÚÜÑ]/.test(record.excerpt), false, 'excerpt comes from normalized text');
      assert.equal(/[áéíóúüñÁÉÍÓÚÜÑ]/.test(record.titleNorm), false, 'weighted title field is normalized');
    }

    // Only recipe pages are indexed: portafichero and índice never appear.
    const urls = bundle.records.map((record) => record.url);
    assert.ok(!urls.includes('/'), 'portafichero /index.html is not indexed');
    assert.ok(!urls.includes('/indice/'), '/indice/ is not indexed');
    assert.ok(urls.every((url) => url.startsWith('/recetas/')));

    const home = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
    const indice = fs.readFileSync(path.join(outDir, 'indice', 'index.html'), 'utf8');
    assert.ok(!home.includes('data-pagefind-body'), 'portafichero carries no indexing scope');
    assert.ok(!indice.includes('data-pagefind-body'), 'índice carries no indexing scope');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('S5: buildSite output set is T3-identical plus dist/pagefind/ (differential check)', async () => {
  const { tmpRoot, outDir, result } = await buildTmpSite();
  try {
    const files = listFilesRecursive(outDir);
    const nonPagefind = files.filter((file) => !file.startsWith('pagefind/'));
    const pagefindFiles = files.filter((file) => file.startsWith('pagefind/'));

    assert.deepEqual(pagefindFiles, ['pagefind/pagefind-entry.json', 'pagefind/pagefind.js']);

    const expected = new Set(['index.html', 'indice/index.html', 'catalogo.json']);
    for (const recipe of result.publicadas) {
      expected.add(`recetas/${recipe.slug}/index.html`);
      expected.add(`recetas/${recipe.slug}/plato.webp`);
      if (recipe.slug === 'ragu-bolognesa') expected.add('recetas/ragu-bolognesa/paso-1.webp');
    }
    const nonPagefindSet = new Set(nonPagefind);
    for (const item of expected) {
      assert.ok(nonPagefindSet.has(item), `T3 output ${item} must remain present`);
    }

    const catalogo = readJson(path.join(outDir, 'catalogo.json'));
    for (const entry of catalogo) {
      assert.deepEqual(
        Object.keys(entry).sort(),
        ['categoriaPrincipal', 'descripcionBreve', 'estaciones', 'imagen', 'ingredientesNombres', 'porciones', 'productosEstacion', 'slug', 'tags', 'tiempoTotalMin', 'titulo'].sort(),
        'catalogo.json keeps the T3 metadata shape for the search attribution'
      );
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// §11 mandatory verification checks.
// ---------------------------------------------------------------------------

test('S5 §11 check 1: data-pagefind-ignore excludes steps/notes/source without losing metadata', async () => {
  const { tmpRoot, catalogo, bundle } = await buildTmpSite();
  try {
    // Words present ONLY in steps/notes/source return zero matches.
    for (const query of ['desglasar', 'cuchara', 'arenar']) {
      const found = searchCatalog(query, { bundle, catalogo });
      assert.equal(found.total, 0, `"${query}" lives only in ignored sections and must match nothing`);
    }
    // Positive controls from ingredients still match.
    const panceta = searchCatalog('panceta', { bundle, catalogo });
    assert.ok(panceta.total >= 1, 'ingredients are indexed');
    assert.ok(panceta.results.some((item) => item.slug === 'ragu-bolognesa'));
    const cabutia = searchCatalog('cabutia', { bundle, catalogo });
    assert.ok(cabutia.results.some((item) => item.slug === 'pure-zapallo-asado'));
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('S5 §11 check 2: search works fully offline from the generated dist/pagefind/ bundle', async () => {
  const { tmpRoot, outDir } = await buildTmpSite();
  try {
    const bundlePath = path.join(outDir, 'pagefind', 'pagefind.js');
    const source = fs.readFileSync(bundlePath, 'utf8');
    assert.ok(!source.includes('fetch('), 'offline bundle must not depend on network fetch');

    // Imported straight from disk: no server, no network, precached ESM only.
    const pagefind = await import(pathToFileURL(bundlePath).href);
    assert.equal(typeof pagefind.search, 'function');
    assert.equal(typeof pagefind.debouncedSearch, 'function');

    const pure = pagefind.search('pure');
    assert.ok(pure.some((item) => item.url.includes('pure-zapallo-asado')), 'offline search finds Puré');

    const ragu = pagefind.search('ragu');
    assert.ok(ragu.some((item) => item.url.includes('ragu-bolognesa')), 'offline search finds Ragú');

    const delayed = await pagefind.debouncedSearch('cabutia', {}, 5);
    assert.ok(delayed.length >= 1, 'debouncedSearch resolves through the same precached bundle');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('S5 §11 check 3: normalized copy introduces zero URL/metadata drift; served HTML keeps tildes', async () => {
  const { tmpRoot, outDir, catalogo, bundle } = await buildTmpSite();
  try {
    for (const record of bundle.records) {
      const relative = record.url.replace(/^\//, '');
      const servedPath = path.join(outDir, relative, 'index.html');
      assert.ok(fs.existsSync(servedPath), `bundle URL ${record.url} must match a published file`);
      const served = fs.readFileSync(servedPath, 'utf8');

      // Served HTML keeps its tildes.
      assert.ok(/[áéíóúüñ]/i.test(served), `${record.url} keeps accented characters`);

      // The normalized record title matches the served title once normalized.
      const servedTitle = served.match(/<h2[^>]*data-pagefind-weight="10"[^>]*>([\s\S]*?)<\/h2>/);
      assert.ok(servedTitle, `${record.url} keeps the weighted title element`);
      assert.equal(normalizeSearchText(servedTitle[1].replace(/<[^>]*>/g, '')), record.titleNorm);

      // Metadata agrees with catalogo.json once normalized.
      const meta = catalogo.find((item) => item.slug === record.slug);
      assert.ok(meta, `bundle record ${record.slug} matches a catalogo.json entry`);
      assert.equal(normalizeSearchText(meta.titulo), record.titleNorm);
    }

    const raguServed = fs.readFileSync(path.join(outDir, 'recetas', 'ragu-bolognesa', 'index.html'), 'utf8');
    assert.ok(raguServed.includes('Ragú'), 'served Ragú page keeps its tilde');
    const pureServed = fs.readFileSync(path.join(outDir, 'recetas', 'pure-zapallo-asado', 'index.html'), 'utf8');
    assert.ok(pureServed.includes('Puré'), 'served Puré page keeps its tilde');
    assert.ok(pureServed.includes('Otoño'), 'served seasons keep their tildes');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Accent-insensitive matching in both directions.
// ---------------------------------------------------------------------------

test('S5: accent-insensitive matching in both directions', async () => {
  const { tmpRoot, catalogo, bundle } = await buildTmpSite();
  try {
    const pure = searchCatalog('pure', { bundle, catalogo });
    assert.ok(pure.results.some((item) => item.titulo === 'Puré Rústico de Zapallo Asado y Salvia'));

    const pureAccented = searchCatalog('puré', { bundle, catalogo });
    assert.deepEqual(
      pureAccented.visibleSlugs,
      pure.visibleSlugs,
      'accented and unaccented queries return the same set'
    );

    const ragu = searchCatalog('ragu', { bundle, catalogo });
    assert.ok(ragu.results.some((item) => item.titulo === 'Ragú Bolognesa Tradicional'));

    const raguUpper = searchCatalog('RAGÚ', { bundle, catalogo });
    assert.ok(raguUpper.results.some((item) => item.titulo === 'Ragú Bolognesa Tradicional'));

    const otono = searchCatalog('otono', { bundle, catalogo });
    assert.ok(
      otono.results.some((item) => item.titulo === 'Tarta Rústica de Manzanas y Membrillo'),
      '"otono" finds the autumn tarta through its seasonal metadata'
    );

    const manzana = searchCatalog('manzana', { bundle, catalogo });
    assert.ok(manzana.results.some((item) => item.titulo === 'Tarta Rústica de Manzanas y Membrillo'));
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Relevance ordering + alphabetical tie-break.
// ---------------------------------------------------------------------------

test('S5: results sort by relevance score descending', async () => {
  const { tmpRoot, catalogo, bundle } = await buildTmpSite();
  try {
    const found = searchCatalog('zapallo cabutia', { bundle, catalogo });
    assert.ok(found.total >= 2, 'zapallo cabutia matches pure and locro');
    const scores = found.results.map((item) => item.score);
    assert.deepEqual([...scores].sort((a, b) => b - a), scores, 'scores descend');
    assert.equal(found.results[0].slug, 'locro-criollo', 'title hit outranks description-only hit');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('S5: at equal relevance, results tie-break alphabetically by titulo', () => {
  const catalogo = [
    { slug: 'beta-tarta', titulo: 'Beta Tarta', descripcionBreve: 'x', categoriaPrincipal: 'Dulces', tags: ['Dulces'], estaciones: ['Otoño'], tiempoTotalMin: 10, porciones: 2, ingredientesNombres: ['azucar'] },
    { slug: 'alfa-tarta', titulo: 'Alfa Tarta', descripcionBreve: 'x', categoriaPrincipal: 'Dulces', tags: ['Dulces'], estaciones: ['Otoño'], tiempoTotalMin: 10, porciones: 2, ingredientesNombres: ['azucar'] }
  ];
  const bundle = {
    version: 1,
    languages: ['es'],
    pageCount: 2,
    records: [
      { slug: 'beta-tarta', url: '/recetas/beta-tarta/', title: 'Beta Tarta', titleNorm: 'beta tarta', highNorm: 'dulces', descriptionNorm: 'x', ingredientsNorm: 'azucar', excerpt: 'Beta Tarta · x' },
      { slug: 'alfa-tarta', url: '/recetas/alfa-tarta/', title: 'Alfa Tarta', titleNorm: 'alfa tarta', highNorm: 'dulces', descriptionNorm: 'x', ingredientsNorm: 'azucar', excerpt: 'Alfa Tarta · x' }
    ]
  };
  const found = searchCatalog('tarta', { bundle, catalogo });
  assert.equal(found.total, 2);
  assert.equal(found.results[0].score, found.results[1].score, 'synthetic tie: identical scores');
  assert.deepEqual(
    found.results.map((item) => item.titulo),
    ['Alfa Tarta', 'Beta Tarta'],
    'tie-break uses localeCompare(es, sensitivity base)'
  );
  assert.ok('Alfa Tarta'.localeCompare('Beta Tarta', 'es', { sensitivity: 'base' }) < 0);
});

// ---------------------------------------------------------------------------
// Matched-field attribution with original accents.
// ---------------------------------------------------------------------------

test('S5: resolveMatchedField attributes title, tags, description and ingredients with accents', () => {
  const ragu = {
    slug: 'ragu-bolognesa',
    titulo: 'Ragú Bolognesa Tradicional',
    descripcionBreve: 'Cocción lenta de carne cortada a cuchillo.',
    categoriaPrincipal: 'Pastas',
    tags: ['Pastas', 'Cocción lenta', 'Olla'],
    ingredientesNombres: ['carne vacuna (roast beef)', 'panceta salada', 'tomate en lata triturado']
  };

  assert.equal(
    resolveMatchedField('ragu', ragu, 'respaldo'),
    'Coincide en: título — «Ragú Bolognesa Tradicional»'
  );
  assert.equal(
    resolveMatchedField('pastas', ragu, 'respaldo'),
    'Coincide en: tags — «Pastas»'
  );
  assert.equal(
    resolveMatchedField('carne cortada a cuchillo', ragu, 'respaldo'),
    'Coincide en: descripción — «Cocción lenta de carne cortada a cuchillo.»'
  );
  assert.equal(
    resolveMatchedField('panceta', ragu, 'respaldo'),
    'Coincide en: ingredientes — «panceta salada»'
  );
  assert.equal(
    resolveMatchedField('cabutia', ragu, 'extracto normalizado de respaldo'),
    'extracto normalizado de respaldo',
    'unknown terms fall back to the Pagefind excerpt'
  );
});

test('S5: searchCatalog results carry accented match labels and no photos', async () => {
  const { tmpRoot, catalogo, bundle } = await buildTmpSite();
  try {
    const found = searchCatalog('panceta', { bundle, catalogo });
    const ragu = found.results.find((item) => item.slug === 'ragu-bolognesa');
    assert.ok(ragu);
    assert.equal(ragu.matchLabel, 'Coincide en: ingredientes — «panceta salada»');
    assert.match(ragu.matchLabel, /^Coincide en: /);

    for (const item of found.results) {
      assert.ok(!('imagen' in item), 'search prioritizes density: no photos in results');
      assert.ok(!('foto' in item), 'search prioritizes density: no photos in results');
      assert.ok(item.slug && item.url && item.titulo && typeof item.score === 'number');
    }
    assert.equal(found.query, 'panceta');
    assert.equal(found.normalizedQuery, 'panceta');
    assert.deepEqual(found.visibleSlugs, found.results.map((item) => item.slug));
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Intersection with active filters + navigation over the resulting set.
// ---------------------------------------------------------------------------

test('S5: search intersects with active filters using filterVisibleRecipes rules', async () => {
  const { tmpRoot, catalogo, bundle } = await buildTmpSite();
  try {
    const unfiltered = searchCatalog('zapallo', { bundle, catalogo });
    assert.ok(unfiltered.total >= 2, 'zapallo matches pure and locro without filters');

    const byTag = searchCatalog('zapallo', { bundle, catalogo, filter: { tag: 'Horno' } });
    assert.deepEqual(byTag.visibleSlugs, ['pure-zapallo-asado']);

    const byCategoria = searchCatalog('zapallo', { bundle, catalogo, filter: { categoria: 'Guisos' } });
    assert.deepEqual(byCategoria.visibleSlugs, ['locro-criollo']);

    const byEstacion = searchCatalog('ragu', { bundle, catalogo, filter: { estacion: 'Primavera' } });
    assert.equal(byEstacion.total, 0, 'ragú is Otoño/Invierno: Primavera filter excludes it');

    // The filter alone follows the same rules as the portafichero.
    const visible = filterVisibleRecipes(catalogo, { tag: 'Horno' });
    assert.ok(visible.some((item) => item.slug === 'pure-zapallo-asado'));
    assert.ok(!visible.some((item) => item.slug === 'locro-criollo'));
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('S5: Anterior/Siguiente traverse only the search result set', async () => {
  const { tmpRoot, catalogo, bundle } = await buildTmpSite();
  try {
    const found = searchCatalog('zapallo', { bundle, catalogo });
    assert.ok(found.total >= 2);
    const entries = found.visibleSlugs.map((slug) => catalogo.find((item) => item.slug === slug));
    const nav = createCatalogNavigator(entries, {});
    assert.equal(nav.getVisible().length, found.total);

    const seen = new Set([nav.getActive().slug]);
    for (let step = 0; step < found.total - 1; step++) seen.add(nav.next().slug);
    assert.deepEqual(new Set(found.visibleSlugs), seen, 'navigation covers exactly the result set');
    assert.equal(nav.next().slug, found.visibleSlugs[0], 'navigation wraps inside the result set');
    assert.ok(!seen.has('ragu-bolognesa'), 'filtered-out recipes are never visited');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('S5: empty queries match nothing and leave stored data untouched', async () => {
  const { tmpRoot, catalogo, bundle } = await buildTmpSite();
  try {
    const before = JSON.stringify(catalogo);
    for (const query of ['', '   ']) {
      const found = searchCatalog(query, { bundle, catalogo });
      assert.equal(found.total, 0);
      assert.deepEqual(found.results, []);
      assert.deepEqual(found.visibleSlugs, []);
    }
    assert.equal(JSON.stringify(catalogo), before, 'rejected queries leave stored data untouched');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
