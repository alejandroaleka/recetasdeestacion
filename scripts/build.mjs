/**
 * T3 (S2, S4): Static site build pipeline.
 *
 * Loads recipes from disk, writes `.astro/build-report.json`, prints the
 * console summary, generates `dist/index.html`, `dist/indice/index.html`
 * and `dist/recetas/<slug>/index.html`, copies published recipe images
 * into `dist/recetas/<slug>/`, writes `dist/catalogo.json` (metadata
 * including ingredient names for search/navigation), generates the
 * offline-precacheable Pagefind bundle in `dist/pagefind/` over
 * accent-normalized in-memory HTML copies (the served HTML keeps its
 * tildes) and verifies the
 * production Keystatic exclusion via `assertNoKeystaticInDist('dist')`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadRecipesFromDisk,
  formatBuildReport,
  writeBuildReport
} from '../src/lib/recipes.mjs';
import { loadSeasonalityCatalog } from '../src/lib/seasonality.mjs';
import { assertNoKeystaticInDist } from '../src/lib/keystatic-guard.mjs';
import { buildPagefindIndex } from '../src/lib/search.mjs';
import { generateOfflineManifest } from '../src/lib/offline.mjs';
import {
  renderPortaficheroPage,
  renderIndicePage,
  renderRecipePage
} from '../src/lib/render-pages.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DEFAULT_RECIPES_DIR = path.resolve(ROOT, 'src/content/recetas');
const PUBLIC_DIR = path.resolve(ROOT, 'public');

/**
 * Minimal Service Worker shell for the all-or-nothing offline package.
 *
 * The worker never hardcodes a version: on install it fetches
 * `offline-manifest.json` (served with `Cache-Control: no-cache` via
 * `public/_headers`), precaches every listed resource, and serves them
 * cache-first on later visits. A new manifest version atomically
 * replaces the previous `recetario-offline-*` cache on activate.
 */
const SERVICE_WORKER_SOURCE = `/* Recetario offline shell (T5, S6). Versioned via offline-manifest.json. */
const MANIFEST_URL = 'offline-manifest.json';
const ACTIVE_PREFIX = 'recetario-offline-';

async function loadManifest() {
  const response = await fetch(MANIFEST_URL, { cache: 'no-store' });
  if (!response.ok) throw new Error('No se pudo leer offline-manifest.json');
  return response.json();
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const manifest = await loadManifest();
      const cache = await caches.open(ACTIVE_PREFIX + manifest.versionHash);
      await cache.addAll(manifest.resources.map((item) => item.path));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      let current = null;
      try {
        const manifest = await loadManifest();
        current = ACTIVE_PREFIX + manifest.versionHash;
      } catch {
        current = null;
      }
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(ACTIVE_PREFIX) && name !== current)
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    (async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      return fetch(event.request);
    })()
  );
});
`;

function copyPublicAsset(filename, outDir) {
  const source = path.join(PUBLIC_DIR, filename);
  if (!fs.existsSync(source)) return null;
  const target = path.join(outDir, filename);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  return target;
}

function ingredientNames(recipe) {
  if (!Array.isArray(recipe.ingredientes)) return [];
  return recipe.ingredientes
    .map((item) => {
      if (!item || typeof item !== 'object') return '';
      if (typeof item.texto === 'string' && item.texto.trim()) return item.texto.trim();
      return String(item.nombre ?? '').trim();
    })
    .filter(Boolean);
}

function copyRecipeAssets(slug, recipesDir, destDir) {
  const assetDir = path.join(recipesDir, slug);
  if (!fs.existsSync(assetDir)) return [];
  const copied = [];
  for (const entry of fs.readdirSync(assetDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const src = path.join(assetDir, entry.name);
    const dest = path.join(destDir, entry.name);
    fs.copyFileSync(src, dest);
    copied.push(entry.name);
  }
  return copied;
}

/**
 * Builds the static site. Exported for T3 tests so they can target a
 * temporary `dist` without touching the real one.
 */
export async function buildSite(options = {}) {
  const outDir = options.outDir ?? path.join(ROOT, 'dist');
  const reportPath = options.reportPath ?? path.join(ROOT, '.astro', 'build-report.json');
  const envMode = options.envMode ?? (process.env.NODE_ENV === 'development' ? 'development' : 'production');
  const recipesDir = options.recipesDir ?? DEFAULT_RECIPES_DIR;

  const evaluation = loadRecipesFromDisk(recipesDir);
  const { publicadas, borradores, omitidas, report } = evaluation;

  writeBuildReport(report, reportPath);
  console.log(formatBuildReport(report));

  let seasonalityCatalog = null;
  try {
    seasonalityCatalog = loadSeasonalityCatalog();
  } catch {
    seasonalityCatalog = null;
  }

  const catalog = {
    evaluation,
    seasonalityCatalog,
    subregionId: 'pampeana',
    estacionActual: 'Otoño',
    location: {
      pais: 'AR',
      subregionNombre: 'Región Pampeana',
      estacionActual: 'Otoño',
      incertidumbre: false,
      mensajeIncertidumbre: null
    },
    ...(options.catalog ?? {})
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'index.html'),
    renderPortaficheroPage({ recipes: publicadas, catalog, envMode }),
    'utf8'
  );

  const indiceDir = path.join(outDir, 'indice');
  fs.mkdirSync(indiceDir, { recursive: true });
  fs.writeFileSync(
    path.join(indiceDir, 'index.html'),
    renderIndicePage({ recipes: publicadas, catalog, envMode }),
    'utf8'
  );

  for (const recipe of publicadas) {
    const recipeDir = path.join(outDir, 'recetas', recipe.slug);
    fs.mkdirSync(recipeDir, { recursive: true });
    fs.writeFileSync(
      path.join(recipeDir, 'index.html'),
      renderRecipePage({ recipe, recipes: publicadas, catalog, envMode }),
      'utf8'
    );
    copyRecipeAssets(recipe.slug, recipesDir, recipeDir);
  }

  const catalogo = publicadas.map((recipe) => ({
    slug: recipe.slug,
    titulo: recipe.titulo,
    descripcionBreve: recipe.descripcionBreve ?? '',
    categoriaPrincipal: recipe.categoriaPrincipal ?? '',
    tags: Array.isArray(recipe.tags) ? recipe.tags : [],
    estaciones: Array.isArray(recipe.estaciones) ? recipe.estaciones : [],
    productosEstacion: Array.isArray(recipe.productosEstacion) ? recipe.productosEstacion : [],
    tiempoTotalMin: recipe.tiempoTotalMin ?? null,
    porciones: recipe.porciones ?? null,
    ingredientesNombres: ingredientNames(recipe),
    imagen: {
      archivo: recipe.imagenPrincipal?.archivo ?? null,
      alt: recipe.imagenPrincipal?.alt ?? ''
    }
  }));
  fs.writeFileSync(path.join(outDir, 'catalogo.json'), JSON.stringify(catalogo, null, 2), 'utf8');

  const pagefind = buildPagefindIndex(outDir);

  copyPublicAsset('_headers', outDir);
  copyPublicAsset('manifest.webmanifest', outDir);
  fs.writeFileSync(path.join(outDir, 'sw.js'), SERVICE_WORKER_SOURCE, 'utf8');

  const offlineManifest = generateOfflineManifest(outDir);

  const guard = assertNoKeystaticInDist(outDir);

  return { publicadas, borradores, omitidas, report, outDir, reportPath, keystaticGuard: guard, pagefind, offlineManifest };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  await buildSite();
}
