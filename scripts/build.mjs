/**
 * T3 (S2, S4): Static site build pipeline.
 *
 * Loads recipes from disk, writes `.astro/build-report.json`, prints the
 * console summary, generates `dist/index.html`, `dist/indice/index.html`
 * and `dist/recetas/<slug>/index.html`, copies published recipe images
 * into `dist/recetas/<slug>/`, writes `dist/catalogo.json` (metadata
 * including ingredient names for search/navigation) and verifies the
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
import {
  renderPortaficheroPage,
  renderIndicePage,
  renderRecipePage
} from '../src/lib/render-pages.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DEFAULT_RECIPES_DIR = path.resolve(ROOT, 'src/content/recetas');

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

  const guard = assertNoKeystaticInDist(outDir);

  return { publicadas, borradores, omitidas, report, outDir, reportPath, keystaticGuard: guard };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  await buildSite();
}
