import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  validateRecipe,
  evaluateCatalogRecipes,
  formatBuildReport,
  writeBuildReport,
  loadRecipesFromDisk
} from '../src/lib/recipes.mjs';

import {
  loadSeasonalityCatalog,
  resolveLocationPreference,
  resolveCoordinatesLocally,
  getRecipeSeasonalHighlights
} from '../src/lib/seasonality.mjs';

test('S1: validateRecipe accepts hybrid ingredients (structured and free-text) and mandatory dish photo with license after title', () => {
  const validRecipe = {
    slug: 'ragu-bolognesa',
    titulo: 'Ragú Bolognesa Tradicional',
    descripcionBreve: 'Cocción lenta de carne cortada a cuchillo y soffritto.',
    imagenPrincipal: {
      archivo: 'plato.webp',
      origen: 'Propia',
      autor: 'A. Aleka',
      licencia: 'CC0',
      alt: 'Cazuela con Ragú Bolognesa',
      generadaConIA: false,
      bytes: 120_000
    },
    tiempoTotalMin: 210,
    porciones: 4,
    dificultad: 'Media',
    categoriaPrincipal: 'Pastas',
    tags: ['Pastas', 'Olla'],
    estaciones: ['Otoño', 'Invierno'],
    productosEstacion: ['zanahoria', 'apio'],
    ingredientes: [
      { cantidad: 400, unidad: 'g', nombre: 'harina 000', nota: 'tamizada' },
      { texto: 'sal a gusto' }
    ],
    pasos: [
      {
        texto: 'Dorar la carne y sumar el soffritto.',
        foto: {
          archivo: 'paso-1.webp',
          origen: 'Propia',
          autor: 'A. Aleka',
          licencia: 'CC0',
          alt: 'Soffritto en olla'
        }
      }
    ],
    estado: 'publicada'
  };

  const res = validateRecipe(validRecipe);
  assert.equal(res.publicable, true);
  assert.deepEqual(res.camposFaltantes, []);
});

test('S1: validateRecipe rejects AI-generated images, unsanitized SVG, oversized images, and missing license metadata', () => {
  const badRecipe = {
    slug: 'tarta-invalida',
    titulo: 'Tarta de Manzana',
    imagenPrincipal: {
      archivo: 'plato.svg',
      origen: 'Propia',
      autor: '',
      licencia: '',
      alt: '',
      generadaConIA: true,
      bytes: 5_000_000
    },
    ingredientes: [],
    pasos: [],
    estado: 'publicada'
  };

  const res = validateRecipe(badRecipe);
  assert.equal(res.publicable, false);
  assert.ok(res.camposFaltantes.includes('imagenPrincipal.autor'));
  assert.ok(res.camposFaltantes.includes('imagenPrincipal.licencia'));
  assert.ok(res.camposFaltantes.includes('imagenPrincipal.alt'));
  assert.ok(res.camposFaltantes.includes('imagenPrincipal.noIA'));
  assert.ok(res.camposFaltantes.includes('imagenPrincipal.formatoValido'));
  assert.ok(res.camposFaltantes.includes('imagenPrincipal.tamanoMaximo'));
  assert.ok(res.camposFaltantes.includes('ingredientes'));
  assert.ok(res.camposFaltantes.includes('pasos'));
});

test('S1: evaluateCatalogRecipes omits drafts and incomplete published recipes without failing build, sorts alphabetically, and writes .astro/build-report.json', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recetario-t1-'));
  try {
    const reportPath = path.join(tmpDir, '.astro', 'build-report.json');
    const items = [
      {
        slug: 'zapallo-asado',
        titulo: 'Zapallo Asado a la Salvia',
        imagenPrincipal: { archivo: 'plato.webp', origen: 'Propia', autor: 'Editor', licencia: 'CC0', alt: 'Zapallo asado' },
        ingredientes: [{ texto: '1 zapallo cabutia' }],
        pasos: [{ texto: 'Hornear 40 minutos.' }],
        estado: 'publicada'
      },
      {
        slug: 'locro-criollo',
        titulo: 'Locro Criollo de Zapallo',
        imagenPrincipal: { archivo: 'plato.webp', origen: 'Propia', autor: 'Editor', licencia: 'CC0', alt: 'Locro criollo' },
        ingredientes: [{ cantidad: 500, unidad: 'g', nombre: 'maíz blanco' }],
        pasos: [{ texto: 'Remojar y hervir.' }],
        estado: 'publicada'
      },
      {
        slug: 'incompleta-publicada',
        titulo: 'Receta Incompleta Marcada Publicada',
        imagenPrincipal: { archivo: 'plato.webp', origen: 'Propia', autor: 'Editor', licencia: '', alt: 'Plato' },
        ingredientes: [{ texto: 'agua' }],
        pasos: [],
        estado: 'publicada'
      },
      {
        slug: 'borrador-en-curso',
        titulo: 'Borrador en Curso',
        estado: 'borrador'
      }
    ];

    const evaluation = evaluateCatalogRecipes(items);
    assert.deepEqual(
      evaluation.publicadas.map((r) => r.slug),
      ['locro-criollo', 'zapallo-asado']
    );
    assert.equal(evaluation.borradores.length, 1);
    assert.equal(evaluation.omitidas.length, 1);
    assert.equal(evaluation.omitidas[0].slug, 'incompleta-publicada');
    assert.ok(evaluation.omitidas[0].camposFaltantes.includes('imagenPrincipal.licencia'));
    assert.ok(evaluation.omitidas[0].camposFaltantes.includes('pasos'));

    const textReport = formatBuildReport(evaluation.report);
    assert.match(textReport, /Publicadas: 2/);
    assert.match(textReport, /Borradores: 1/);
    assert.match(textReport, /Omitidas por incompletas: 1/);
    assert.match(textReport, /incompleta-publicada/);

    writeBuildReport(evaluation.report, reportPath);
    const saved = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    assert.equal(saved.totalPublicadas, 2);
    assert.equal(saved.totalOmitidas, 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('S2: Argentina seasonality catalog covers 5 climatic subregions, 12 base products, local coordinate resolution, uncertainty state, and explicit product link without free-text false positives', () => {
  const catalog = loadSeasonalityCatalog();
  assert.equal(catalog.paisCodigo, 'AR');
  assert.deepEqual(
    catalog.subregiones.map((s) => s.id),
    ['pampeana', 'cuyo', 'noa', 'nea', 'patagonia']
  );
  assert.equal(catalog.productos.length, 12);

  // 1. Sin preferencia guardada
  const stateNone = resolveLocationPreference(null, catalog, 5);
  assert.equal(stateNone.estado, 'sin-preferencia');
  assert.equal(stateNone.mostrarInvitacion, true);
  assert.equal(stateNone.estacionActual, null);

  // 2. Ubicación omitida o rechazada
  const stateSkipped = resolveLocationPreference({ estado: 'omitida' }, catalog, 5);
  assert.equal(stateSkipped.estado, 'omitida');
  assert.equal(stateSkipped.mostrarInvitacion, false);
  assert.equal(stateSkipped.estacionActual, null);

  // 3. País y subregión cubiertos (AR + pampeana en mayo = Otoño)
  const stateCovered = resolveLocationPreference(
    { estado: 'elegida', pais: 'AR', subregion: 'pampeana' },
    catalog,
    5
  );
  assert.equal(stateCovered.estado, 'elegida');
  assert.equal(stateCovered.incertidumbre, false);
  assert.equal(stateCovered.estacionActual, 'Otoño');
  assert.ok(stateCovered.productosEnTemporada.some((p) => p.id === 'zapallo-cabutia'));

  // 4. País sin subregión o fuera de la tabla -> muestra incertidumbre explícita sin inventar dato
  const stateUncertain = resolveLocationPreference(
    { estado: 'elegida', pais: 'AR', subregion: '' },
    catalog,
    5
  );
  assert.equal(stateUncertain.incertidumbre, true);
  assert.equal(stateUncertain.estacionActual, null);
  assert.match(stateUncertain.mensajeIncertidumbre, /incertidumbre|subregi/i);

  // 5. Resolución local de coordenadas (Buenos Aires -> pampeana; fuera de límites -> incertidumbre)
  const localBA = resolveCoordinatesLocally(-34.6, -58.38, catalog);
  assert.equal(localBA.cubierta, true);
  assert.equal(localBA.pais, 'AR');
  assert.equal(localBA.subregion, 'pampeana');

  const localOutside = resolveCoordinatesLocally(40.41, -3.7, catalog);
  assert.equal(localOutside.cubierta, false);

  // 6. Vínculo explícito a productosEstacion: «tomate en lata» en ingredientes NO dispara «tomate» fresco
  const recipeWithCannedTomato = {
    slug: 'ragu-bolognesa',
    productosEstacion: ['zapallo-cabutia'],
    ingredientes: [{ texto: '400 g tomate en lata triturado' }]
  };
  const highlightsSummer = getRecipeSeasonalHighlights(
    recipeWithCannedTomato,
    catalog,
    'pampeana',
    'Verano'
  );
  assert.equal(highlightsSummer.some((p) => p.id === 'tomate'), false);

  const highlightsAutumn = getRecipeSeasonalHighlights(
    recipeWithCannedTomato,
    catalog,
    'pampeana',
    'Otoño'
  );
  assert.deepEqual(highlightsAutumn.map((p) => p.id), ['zapallo-cabutia']);
});

test('S1: loadRecipesFromDisk loads sample catalog from src/content/recetas and validates public vs draft', () => {
  const loaded = loadRecipesFromDisk();
  assert.ok(loaded.publicadas.length >= 3);
  assert.ok(loaded.borradores.length >= 1);
  assert.ok(loaded.omitidas.length >= 1);
});
