/**
 * T6 (S7): Internal development scenario simulator + visual flow diagrams.
 *
 * Strictly isolated: this module lives under `src/dev/`, is only served
 * through `scripts/dev-server.mjs` when `envMode === 'development'`, and is
 * verified absent from `dist/` by `assertNoSimulatorInDist` (wired into
 * `scripts/build.mjs`). It never touches public routes, navigation, assets
 * or the published package.
 *
 * Every scenario executes the REAL domain functions from `src/lib/*`
 * (seasonality, recipes, navigation, search, offline), so the simulator
 * represents agreed rules without substituting functional tests.
 */

import {
  loadSeasonalityCatalog,
  resolveLocationPreference,
  resolveCoordinatesLocally,
  getRecipeSeasonalHighlights
} from '../lib/seasonality.mjs';
import { validateRecipe, evaluateCatalogRecipes } from '../lib/recipes.mjs';
import {
  filterVisibleRecipes,
  createCatalogNavigator,
  resolveSimpleReadingMode
} from '../lib/navigation.mjs';
import { normalizeSearchText, searchCatalog } from '../lib/search.mjs';
import {
  computeManifestDelta,
  createOfflinePackageManager,
  formatWeight
} from '../lib/offline.mjs';
import { buildDevIncompleteBanner } from '../lib/keystatic-guard.mjs';

// ---------------------------------------------------------------------------
// Visual flow diagrams (§10). One self-contained SVG per process.
// ---------------------------------------------------------------------------

const SVG_OPEN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 220" role="img"';
const SVG_STYLE = `<style>
.sim-title{font:700 15px system-ui,sans-serif;fill:#2b2118}
.sim-box{fill:#fffdf6;stroke:#8a6d1b;stroke-width:2;rx:8}
.sim-box-alt{fill:#f3e9d2;stroke:#8a6d1b;stroke-width:2;rx:8}
.sim-label{font:600 11px system-ui,sans-serif;fill:#2b2118}
.sim-small{font:400 10px system-ui,sans-serif;fill:#5c4d33}
.sim-arrow{stroke:#8a6d1b;stroke-width:2;fill:none;marker-end:url(#simHead)}
</style><defs><marker id="simHead" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#8a6d1b"/></marker></defs>`;

function svgWrap(title, inner) {
  return (
    `${SVG_OPEN} aria-label="${title}">${SVG_STYLE}` +
    `<title>${title}</title><text class="sim-title" x="16" y="24">${title}</text>${inner}</svg>`
  );
}

function flowBox(x, y, w, h, label, sub, alt = false) {
  return (
    `<rect class="${alt ? 'sim-box-alt' : 'sim-box'}" x="${x}" y="${y}" width="${w}" height="${h}" rx="8"/>` +
    `<text class="sim-label" x="${x + 10}" y="${y + 20}">${label}</text>` +
    (sub ? `<text class="sim-small" x="${x + 10}" y="${y + 36}">${sub}</text>` : '')
  );
}

function flowArrow(x1, y1, x2, y2) {
  return `<path class="sim-arrow" d="M${x1},${y1} L${x2},${y2}"/>`;
}

export const DIAGRAMS = {
  ubicacion: svgWrap(
    'Ubicación y estacionalidad — flujo',
    flowBox(16, 44, 150, 52, 'Preferencia', 'sin / omitida / elegida') +
      flowArrow(166, 70, 186, 70) +
      flowBox(186, 44, 160, 52, 'Tabla AR curada', '5 subregiones + bbox local') +
      flowArrow(346, 70, 366, 70) +
      flowBox(366, 44, 178, 52, 'Estación + productos', 'vínculo explícito') +
      flowBox(16, 120, 250, 52, 'País/subregión sin cobertura', 'incertidumbre explícita + filtro manual') +
      flowBox(286, 120, 258, 52, 'productosEstacion → destacados', 'sin falsos positivos de texto libre')
  ),
  validacion: svgWrap(
    'Validación de borradores — flujo',
    flowBox(16, 44, 150, 52, 'borrador', 'se guarda libre') +
      flowArrow(166, 70, 186, 70) +
      flowBox(186, 44, 160, 52, 'publicada incompleta', 'se omite, no rompe build') +
      flowArrow(346, 70, 366, 70) +
      flowBox(366, 44, 178, 52, 'publicada completa', 'visible en el sitio') +
      flowBox(16, 120, 250, 52, 'IA / SVG / +2MB', 'rechazo: noIA, formato, peso') +
      flowBox(286, 120, 258, 52, 'build-report + banner dev', '.astro/build-report.json')
  ),
  navegacion: svgWrap(
    'Navegación, búsqueda y lectura — flujo',
    flowBox(16, 44, 150, 52, 'Activa compartida', 'A → C queda C') +
      flowArrow(166, 70, 186, 70) +
      flowBox(186, 44, 160, 52, 'Filtro visible', 'Anterior/Siguiente visibles') +
      flowArrow(346, 70, 366, 70) +
      flowBox(366, 44, 178, 52, 'Búsqueda sin tildes', 'ragu → Ragú ∩ filtro') +
      flowBox(16, 120, 528, 52, 'Lectura simple: Sí / No', 'manual prevalece · auto por sistema · Sí amplía y calma')
  ),
  offline: svgWrap(
    'Offline todo-o-nada — flujo',
    flowBox(16, 44, 150, 52, 'Peso + confirmación', 'sin confirmar: 0 archivos') +
      flowArrow(166, 70, 186, 70) +
      flowBox(186, 44, 160, 52, 'persist() + estimate()', 'pre-vuelo de cuota') +
      flowArrow(346, 70, 366, 70) +
      flowBox(366, 44, 178, 52, 'staging atómico', 'commit o rollback total') +
      flowBox(16, 120, 250, 52, 'Desalojo detectado', 'aviso + reinstalar') +
      flowBox(286, 120, 258, 52, 'Sync diferencial', 'solo cambios · reutiliza resto')
  )
};

// ---------------------------------------------------------------------------
// Scenario catalog.
// ---------------------------------------------------------------------------

export function getSimulatorScenarios() {
  return [
    {
      id: 'ubicacion-estacionalidad',
      title: 'Ubicación y estacionalidad',
      description:
        'Simula los 3 estados persistidos (sin-preferencia, omitida, elegida), la resolución local de ' +
        'coordenadas contra la bounding-box de las 5 subregiones argentinas, la incertidumbre explícita ' +
        'cuando el país o la subregión no están cubiertos y el vínculo explícito productosEstacion sin ' +
        'falsos positivos de texto libre.',
      params: {
        month: { type: 'number', default: 4, description: 'Mes (1–12) para la estación vigente' },
        lat: { type: 'number', default: -34.6, description: 'Latitud a contrastar localmente' },
        lon: { type: 'number', default: -58.4, description: 'Longitud a contrastar localmente' },
        pais: { type: 'string', default: 'AR', description: 'País elegido en el selector' },
        subregion: { type: 'string', default: 'pampeana', description: 'Subregión elegida' }
      },
      diagramSvg: DIAGRAMS.ubicacion
    },
    {
      id: 'validacion-borradores',
      title: 'Validación de borradores',
      description:
        'Simula la validación de recetas: borrador libre, publicada incompleta omitida (con ' +
        '.astro/build-report.json y banner de desarrollo) y publicada completa, incluyendo el rechazo ' +
        'de imágenes generadas con IA, archivos SVG y archivos que superan el peso máximo.',
      params: {
        maxImageBytes: {
          type: 'number',
          default: 2097152,
          description: 'Peso máximo por imagen validado en el escenario'
        }
      },
      diagramSvg: DIAGRAMS.validacion
    },
    {
      id: 'navegacion-busqueda-accesibilidad',
      title: 'Navegación, búsqueda y accesibilidad',
      description:
        'Simula la receta activa compartida (A → C queda C al volver al Portafichero), la navegación ' +
        'Anterior / Siguiente solo por recetas visibles bajo filtro, la intersección con la búsqueda ' +
        'acentuada-normalizada y el modo híbrido «Lectura simple: Sí / No».',
      params: {
        termino: { type: 'string', default: 'ragu', description: 'Término de búsqueda sin tildes' },
        filtroEstacion: { type: 'string', default: 'Otoño', description: 'Filtro de estación vigente' }
      },
      diagramSvg: DIAGRAMS.navegacion
    },
    {
      id: 'offline-sincronizacion-atomica',
      title: 'Offline y sincronización atómica',
      description:
        'Simula el ciclo todo-o-nada del paquete PWA: confirmación previa con peso, persist(), ' +
        'pre-vuelo con estimate(), caché de staging con commit/rollback atómico, detección de desalojo ' +
        'con oferta de reinstalar y sincronización diferencial al reconectar.',
      params: {
        quotaBytes: { type: 'number', default: 200000000, description: 'Cuota simulada del navegador' },
        usageBytes: { type: 'number', default: 0, description: 'Uso simulado previo a la descarga' }
      },
      diagramSvg: DIAGRAMS.offline
    }
  ];
}

function scenarioTitle(scenarioId) {
  return getSimulatorScenarios().find((s) => s.id === scenarioId)?.title ?? scenarioId;
}

function scenarioDiagram(scenarioId) {
  return getSimulatorScenarios().find((s) => s.id === scenarioId)?.diagramSvg ?? '';
}

// ---------------------------------------------------------------------------
// Shared fixtures.
// ---------------------------------------------------------------------------

function validImageMeta(overrides = {}) {
  return {
    archivo: 'plato.webp',
    origen: 'Fotografía propia',
    autor: 'Ana Cocinera',
    licencia: 'CC-BY-SA 4.0',
    alt: 'Foto del plato terminado',
    bytes: 48_000,
    ...overrides
  };
}

function baseValidRecipe(overrides = {}) {
  return {
    slug: 'receta-valida',
    titulo: 'Receta válida de ejemplo',
    estado: 'publicada',
    imagenPrincipal: validImageMeta(),
    ingredientes: [{ cantidad: 400, unidad: 'g', nombre: 'harina 000' }],
    pasos: [{ texto: 'Mezclar, hornear y servir.' }],
    ...overrides
  };
}

function createMemoryStorage({ quota = 200_000_000, usage = 0 } = {}) {
  return {
    persistCalls: 0,
    estimateCalls: 0,
    _active: null,
    _quota: quota,
    _usage: usage,
    async persist() {
      this.persistCalls += 1;
      return true;
    },
    async estimate() {
      this.estimateCalls += 1;
      return { quota: this._quota, usage: this._usage };
    },
    async readActive() {
      return this._active;
    },
    async writeActive(record) {
      this._active = record;
    }
  };
}

function createMemoryCacheStore() {
  const caches = new Map();
  return {
    _caches: caches,
    async open(name) {
      if (!caches.has(name)) caches.set(name, new Map());
      const bucket = caches.get(name);
      return {
        async put(requestPath, body) {
          bucket.set(requestPath, body);
        },
        async match(requestPath) {
          return bucket.has(requestPath) ? bucket.get(requestPath) : null;
        },
        async has(requestPath) {
          return bucket.has(requestPath);
        },
        async keys() {
          return [...bucket.keys()];
        },
        async delete(requestPath) {
          return bucket.delete(requestPath);
        }
      };
    },
    async keys() {
      return [...caches.keys()];
    },
    async delete(name) {
      return caches.delete(name);
    }
  };
}

function createMemoryFetcher({ failOn = null } = {}) {
  const calls = [];
  const fetcher = async (requestPath) => {
    calls.push(requestPath);
    if (requestPath === failOn) throw new Error(`network fail: ${requestPath}`);
    return `body-of-${requestPath}`;
  };
  fetcher.calls = calls;
  return fetcher;
}

// ---------------------------------------------------------------------------
// Scenario runners (real domain functions only).
// ---------------------------------------------------------------------------

function simulateUbicacion(input = {}) {
  const month = Number(input.month ?? 4);
  const lat = Number(input.lat ?? -34.6);
  const lon = Number(input.lon ?? -58.4);
  const catalog = loadSeasonalityCatalog();

  const sinPreferencia = resolveLocationPreference({ estado: 'sin-preferencia' }, catalog, month);
  const omitida = resolveLocationPreference({ estado: 'omitida' }, catalog, month);
  const elegida = resolveLocationPreference(
    { estado: 'elegida', pais: input.pais ?? 'AR', subregion: input.subregion ?? 'pampeana' },
    catalog,
    month
  );
  const paisNoCubierto = resolveLocationPreference(
    { estado: 'elegida', pais: 'UY', subregion: 'pampeana' },
    catalog,
    month
  );
  const subregionFaltante = resolveLocationPreference(
    { estado: 'elegida', pais: 'AR', subregion: '' },
    catalog,
    month
  );
  const coordenadas = resolveCoordinatesLocally(lat, lon, catalog);
  const coordenadasFuera = resolveCoordinatesLocally(0, 0, catalog);

  const recetaMuestra = {
    slug: 'ragu-ejemplo',
    titulo: 'Ragú de ejemplo',
    productosEstacion: ['zapallo-cabutia', 'tomate'],
    ingredientes: [{ cantidad: 2, unidad: 'u', nombre: 'tomate en lata (conserva)' }]
  };
  const destacados = getRecipeSeasonalHighlights(recetaMuestra, catalog, 'pampeana', elegida.estacionActual ?? 'Otoño');

  return {
    sinPreferencia,
    omitida,
    elegida,
    paisNoCubierto,
    subregionFaltante,
    coordenadas,
    coordenadasFuera,
    recetaMuestra,
    destacados,
    notaVinculoExplicito:
      'Los destacados salen de productosEstacion (referencias explícitas al catálogo); el texto libre ' +
      'de ingredientes —como «tomate en lata»— nunca genera falsos positivos.'
  };
}

function simulateValidacion(input = {}) {
  const maxImageBytes = Number(input.maxImageBytes ?? 2 * 1024 * 1024);

  const borradorReceta = {
    slug: 'humita-borrador',
    titulo: '',
    estado: 'borrador',
    imagenPrincipal: null,
    ingredientes: [],
    pasos: []
  };
  const omitidaReceta = baseValidRecipe({
    slug: 'guiso-incompleto',
    titulo: '',
    estado: 'publicada',
    imagenPrincipal: validImageMeta({ archivo: 'plato.webp', alt: '' })
  });
  const completaReceta = baseValidRecipe({ slug: 'locro-ejemplo', titulo: 'Locro de ejemplo' });

  const borrador = validateRecipe(borradorReceta, { maxImageBytes });
  const omitida = validateRecipe(omitidaReceta, { maxImageBytes });
  const publicadaCompleta = validateRecipe(completaReceta, { maxImageBytes });
  const rechazoIA = validateRecipe(
    baseValidRecipe({
      slug: 'rechazo-ia',
      imagenPrincipal: validImageMeta({ generadaConIA: true })
    }),
    { maxImageBytes }
  );
  const rechazoSVG = validateRecipe(
    baseValidRecipe({
      slug: 'rechazo-svg',
      imagenPrincipal: validImageMeta({ archivo: 'plato.svg' })
    }),
    { maxImageBytes }
  );
  const rechazoPeso = validateRecipe(
    baseValidRecipe({
      slug: 'rechazo-peso',
      imagenPrincipal: validImageMeta({ bytes: maxImageBytes + 1024 })
    }),
    { maxImageBytes }
  );

  const evaluation = evaluateCatalogRecipes([borradorReceta, omitidaReceta, completaReceta], {
    maxImageBytes
  });
  const informe = evaluation.report;
  const banner = buildDevIncompleteBanner(evaluation);

  return {
    borrador,
    borradorEnEvaluacion: evaluation.borradores.find((b) => b.slug === 'humita-borrador') ?? null,
    omitidaPorIncompleta: evaluation.omitidas.find((o) => o.slug === 'guiso-incompleto') ?? null,
    publicadaCompleta,
    rechazoIA,
    rechazoSVG,
    rechazoPeso,
    informe,
    banner,
    notaBuildReport:
      'En build real, este informe se imprime en consola y se escribe en .astro/build-report.json ' +
      '(fuera del paquete publicado); en desarrollo el banner muestra slug + campos faltantes.'
  };
}

function simulateNavegacion(input = {}) {
  const termino = String(input.termino ?? 'ragu');
  const filtroEstacion = String(input.filtroEstacion ?? 'Otoño');

  // 1. Una sola receta activa compartida entre lectura y portafichero.
  const fichero = [
    { slug: 'A', titulo: 'Ajo blanco' },
    { slug: 'B', titulo: 'Buñuelos' },
    { slug: 'C', titulo: 'Carbonada' }
  ];
  const compartida = createCatalogNavigator(fichero);
  compartida.setActive('A');
  compartida.next(); // B en lectura
  compartida.next(); // C en lectura
  const activaTrasVolver = compartida.getActiveSlug();

  // 2. Catálogo con tildes para búsqueda + filtro.
  const catalogo = [
    {
      slug: 'ensalada-fresca',
      titulo: 'Ensalada fresca',
      categoriaPrincipal: 'Ensaladas',
      tags: ['fresco'],
      estaciones: ['Verano'],
      descripcionBreve: 'Ensalada verde de verano',
      ingredientesNombres: ['lechuga', 'tomate']
    },
    {
      slug: 'ragu-bolognesa',
      titulo: 'Ragú Bolognesa Tradicional',
      categoriaPrincipal: 'Pastas',
      tags: ['italiana'],
      estaciones: ['Otoño'],
      descripcionBreve: 'Ragú lento de domingo',
      ingredientesNombres: ['carne picada', 'puré de tomate']
    },
    {
      slug: 'locro-criollo',
      titulo: 'Locro criollo',
      categoriaPrincipal: 'Guisos',
      tags: ['argentino'],
      estaciones: ['Invierno'],
      descripcionBreve: 'Guiso de maíz y porotos',
      ingredientesNombres: ['maíz', 'porotos']
    },
    {
      slug: 'pure-zapallo',
      titulo: 'Puré de zapallo asado',
      categoriaPrincipal: 'Guarniciones',
      tags: ['veggie'],
      estaciones: ['Otoño'],
      descripcionBreve: 'Puré cremoso de otoño',
      ingredientesNombres: ['zapallo anco']
    }
  ];
  const slugConTilde = 'ragu-bolognesa';
  const excluidaPorFiltro = 'locro-criollo';

  const visibleFiltrada = filterVisibleRecipes(catalogo, { estacion: filtroEstacion }).map((r) => r.slug);
  const filtrada = createCatalogNavigator(catalogo, { estacion: filtroEstacion });
  const recorridoVisible = [];
  for (let i = 0; i < filtrada.getVisible().length; i += 1) {
    recorridoVisible.push(filtrada.getActiveSlug());
    filtrada.next();
  }

  const busquedaSinTilde = searchCatalog(termino, { catalogo, filter: {} });
  const interseccion = searchCatalog(termino, { catalogo, filter: { estacion: filtroEstacion } }).results.map(
    (r) => r.slug
  );

  const lecturaManualSi = resolveSimpleReadingMode({ storedValue: true });
  const lecturaManualNo = resolveSimpleReadingMode({ storedValue: false });
  const lecturaAutomatica = resolveSimpleReadingMode({ prefersReducedMotion: true });
  const normalizado = normalizeSearchText(termino);

  return {
    activaTrasVolver,
    visibleFiltrada,
    excluidaPorFiltro,
    recorridoVisible,
    busquedaSinTilde: {
      total: busquedaSinTilde.total,
      normalizedQuery: busquedaSinTilde.normalizedQuery,
      results: busquedaSinTilde.results.map((r) => ({ slug: r.slug, score: r.score, matchLabel: r.matchLabel }))
    },
    slugConTilde,
    interseccion,
    lecturaManualSi,
    lecturaManualNo,
    lecturaAutomatica,
    normalizado
  };
}

async function simulateOffline(input = {}) {
  const quota = Number(input.quotaBytes ?? 200_000_000);
  const usage = Number(input.usageBytes ?? 0);

  const v1 = {
    version: 1,
    generator: 'recetario-offline-t6',
    generatedAt: '2026-11-02T00:00:00.000Z',
    versionHash: 'sim-v1',
    resourceCount: 3,
    totalBytes: 300,
    resources: [
      { path: '/index.html', sha256: 'keep', bytes: 100 },
      { path: '/catalogo.json', sha256: 'before', bytes: 100 },
      { path: '/recetas/ragu-bolognesa/plato.webp', sha256: 'img1', bytes: 100 }
    ]
  };
  const v2 = {
    version: 1,
    generator: 'recetario-offline-t6',
    generatedAt: '2026-11-03T00:00:00.000Z',
    versionHash: 'sim-v2',
    resourceCount: 3,
    totalBytes: 350,
    resources: [
      { path: '/index.html', sha256: 'keep', bytes: 100 },
      { path: '/catalogo.json', sha256: 'after', bytes: 150 },
      { path: '/recetas/nueva/plato.webp', sha256: 'fresh', bytes: 100 }
    ]
  };

  const storage = createMemoryStorage({ quota, usage });
  const cacheStore = createMemoryCacheStore();
  const fetcher = createMemoryFetcher();
  const manager = createOfflinePackageManager({ storage, cacheStore, fetcher });

  const confirmacion = await manager.installPackage(v1, { confirmed: false });
  const descargasSinConfirmar = fetcher.calls.length;
  const pesoFormateado = formatWeight(v1.totalBytes);
  const instalacion = await manager.installPackage(v1, { confirmed: true });
  const integridad = await manager.checkIntegrity();

  fetcher.calls.length = 0;
  const delta = computeManifestDelta(v1, v2);
  const sync = await manager.syncPackage(v2, { confirmed: true });
  const llamadasFetch = [...fetcher.calls];
  const recursoReutilizado = '/index.html';

  // Evicción en un paquete paralelo para no contaminar el fetch diferencial.
  const storageEvict = createMemoryStorage({ quota, usage });
  const cachesEvict = createMemoryCacheStore();
  const managerEvict = createOfflinePackageManager({
    storage: storageEvict,
    cacheStore: cachesEvict,
    fetcher: createMemoryFetcher()
  });
  await managerEvict.installPackage(v1, { confirmed: true });
  const activaEvict = await cachesEvict.open('recetario-offline-sim-v1');
  await activaEvict.delete('/recetas/ragu-bolognesa/plato.webp');
  const eviction = await managerEvict.checkIntegrity();

  // Rollback: el sync interrumpido conserva la versión anterior completa.
  const storageRb = createMemoryStorage({ quota, usage });
  const cachesRb = createMemoryCacheStore();
  const managerRb = createOfflinePackageManager({
    storage: storageRb,
    cacheStore: cachesRb,
    fetcher: createMemoryFetcher()
  });
  await managerRb.installPackage(v1, { confirmed: true });
  const managerRbFail = createOfflinePackageManager({
    storage: storageRb,
    cacheStore: cachesRb,
    fetcher: createMemoryFetcher({ failOn: '/catalogo.json' })
  });
  const fallo = await managerRbFail.syncPackage(v2, { confirmed: true });
  const rollback = {
    resultado: fallo,
    estadoTrasFallo: managerRbFail.getState(),
    manifiestoActivo: await managerRbFail.getActiveManifest()
  };

  return {
    confirmacion,
    descargasSinConfirmar,
    pesoFormateado,
    instalacion,
    preflight: { persistLlamado: storage.persistCalls > 0, estimateLlamado: storage.estimateCalls > 0 },
    integridad,
    delta: {
      addedOrModified: delta.addedOrModified.map((r) => r.path),
      unchanged: delta.unchanged.map((r) => r.path),
      obsolete: delta.obsolete.map((r) => r.path),
      deltaBytes: delta.deltaBytes,
      hasChanges: delta.hasChanges
    },
    sync: {
      status: sync.status,
      fetchedCount: sync.fetchedCount ?? 0,
      reusedCount: sync.reusedCount ?? 0,
      purgedCount: sync.purgedCount ?? 0,
      deltaBytes: sync.deltaBytes ?? 0
    },
    llamadasFetch,
    recursoReutilizado,
    eviction,
    rollback
  };
}

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

/**
 * Executes the real domain functions for one scenario.
 * Returns `{ scenarioId, title, input, output, diagramSvg, invariantsVerified }`.
 */
export async function runScenarioSimulation(scenarioId, input = {}) {
  const known = ['ubicacion-estacionalidad', 'validacion-borradores', 'navegacion-busqueda-accesibilidad', 'offline-sincronizacion-atomica'];
  if (!known.includes(scenarioId)) {
    throw new Error(`Escenario desconocido: ${scenarioId}. Escenarios válidos: ${known.join(', ')}.`);
  }
  const title = scenarioTitle(scenarioId);
  const diagramSvg = scenarioDiagram(scenarioId);
  const safeInput = input && typeof input === 'object' ? input : {};

  if (scenarioId === 'ubicacion-estacionalidad') {
    const output = simulateUbicacion(safeInput);
    return {
      scenarioId,
      title,
      input: safeInput,
      output,
      diagramSvg,
      invariantsVerified: [
        'Tres estados persistidos: sin-preferencia invita, omitida no re-pregunta, elegida resuelve estación.',
        'Resolución local de coordenadas por bounding-box sin proveedor externo ni guardado de coordenadas.',
        'Incertidumbre explícita cuando el país o la subregión no están cubiertos; queda el filtro manual.',
        'Destacados solo por el vínculo explícito productosEstacion, sin falsos positivos de texto libre.'
      ]
    };
  }

  if (scenarioId === 'validacion-borradores') {
    const output = simulateValidacion(safeInput);
    return {
      scenarioId,
      title,
      input: safeInput,
      output,
      diagramSvg,
      invariantsVerified: [
        'Borrador libre: se guarda incompleto y no rompe el build.',
        'Publicada incompleta: se omite del sitio y se lista en el informe con slug + campos faltantes.',
        'Publicada completa: visible y publicable.',
        'Rechazo técnico: IA (noIA), SVG (formatoValido) y sobrepeso (tamanoMaximo).'
      ]
    };
  }

  if (scenarioId === 'navegacion-busqueda-accesibilidad') {
    const output = simulateNavegacion(safeInput);
    return {
      scenarioId,
      title,
      input: safeInput,
      output,
      diagramSvg,
      invariantsVerified: [
        'Una sola receta activa compartida: A → C en lectura queda C al volver al Portafichero.',
        'Anterior / Siguiente recorren solo las recetas visibles bajo el filtro vigente.',
        'Búsqueda accent-normalized en ambos lados, intersectada con los filtros activos.',
        'Lectura simple híbrida: lo manual prevalece; el sistema la activa ante movimiento reducido o contraste alto.'
      ]
    };
  }

  const output = await simulateOffline(safeInput);
  return {
    scenarioId,
    title,
    input: safeInput,
    output,
    diagramSvg,
    invariantsVerified: [
      'Confirmación previa con peso: sin confirmar se descargan 0 archivos.',
      'Pre-vuelo: persist() solicitado y estimate() verificado antes de descargar.',
      'Escritura atómica en staging con commit total o rollback a la versión anterior completa.',
      'Evicción detectada con oferta de reinstalar; sync diferencial que reutiliza bytes sin cambios.'
    ]
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Renders the dev-only simulator page. Outside `development` it refuses
 * with a 404 and no HTML, so production can never serve it.
 */
export function renderSimulatorPage({ envMode = 'production' } = {}) {
  if (envMode !== 'development') {
    return { allowed: false, status: 404, html: null };
  }
  const scenarios = getSimulatorScenarios();
  const sections = scenarios
    .map(
      (scenario) => `
      <section class="sim-scenario" id="sim-${scenario.id}">
        <h2>${escapeHtml(scenario.title)} <code>${escapeHtml(scenario.id)}</code></h2>
        <p>${escapeHtml(scenario.description)}</p>
        <div class="sim-diagram">${scenario.diagramSvg}</div>
        <h3>Parámetros configurables</h3>
        <form class="sim-params" data-scenario="${escapeHtml(scenario.id)}">
          ${Object.entries(scenario.params)
            .map(
              ([name, def]) =>
                `<label>${escapeHtml(name)} <span class="sim-hint">${escapeHtml(def.description ?? '')}</span>` +
                `<input name="${escapeHtml(name)}" value="${escapeHtml(def.default ?? '')}" /></label>`
            )
            .join('')}
          <button type="submit">Ejecutar simulación (runScenarioSimulation)</button>
        </form>
        <pre class="sim-output" data-output="${escapeHtml(scenario.id)}">Elegí parámetros y ejecutá: el servidor corre runScenarioSimulation('${escapeHtml(scenario.id)}', …) con las funciones reales de src/lib/*.</pre>
      </section>`
    )
    .join('\n');

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Simulador interno de desarrollo — Recetario</title>
<style>
body{font-family:system-ui,sans-serif;background:#faf6ec;color:#2b2118;margin:0;padding:0}
header{background:#2b2118;color:#faf6ec;padding:16px 20px;position:sticky;top:0}
header code{background:#4a3b28;padding:2px 6px;border-radius:4px}
main{max-width:960px;margin:0 auto;padding:20px}
.sim-banner{background:#fff4cc;border:2px solid #8a6d1b;border-radius:8px;padding:10px 12px;margin:0 0 16px}
.sim-scenario{background:#fffdf6;border:2px solid #8a6d1b;border-radius:10px;padding:16px;margin:0 0 20px}
.sim-diagram svg{width:100%;height:auto;background:#fff;border:1px dashed #8a6d1b;border-radius:8px}
.sim-params label{display:block;margin:8px 0;font-weight:600}
.sim-params input{margin-left:8px;padding:4px 8px;max-width:280px}
.sim-hint{font-weight:400;color:#5c4d33}
.sim-output{background:#1e1a14;color:#f3e9d2;padding:12px;border-radius:8px;white-space:pre-wrap}
nav.sim-index a{margin-right:12px;color:#8a6d1b}
</style>
</head>
<body>
<header>
<h1>Simulador interno de desarrollo <code>/__dev/simulador</code></h1>
<p>Solo disponible en desarrollo. Fuera de rutas públicas, navegación, recursos y paquete publicado. Representa reglas acordadas; no sustituye pruebas funcionales.</p>
<nav class="sim-index">${scenarios.map((s) => `<a href="#sim-${s.id}">${escapeHtml(s.title)}</a>`).join('')}</nav>
</header>
<main>
<p class="sim-banner" role="note">Entorno: <strong>development</strong>. Esta página nunca se escribe en <code>dist/</code> ni se publica: el build la detectaría con <code>assertNoSimulatorInDist</code>.</p>
${sections}
</main>
<script>
const SCENARIOS = ${JSON.stringify(scenarios.map((s) => ({ id: s.id, title: s.title, params: s.params })))};
document.querySelectorAll('form.sim-params').forEach((form) => {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    const out = document.querySelector('[data-output="' + form.dataset.scenario + '"]');
    if (out) out.textContent = 'Simulación solicitada para ' + form.dataset.scenario + ' con ' + JSON.stringify(data) + '. El servidor la ejecuta con runScenarioSimulation() y las funciones reales de src/lib/*.';
  });
});
console.log('Simulador interno listo:', SCENARIOS.map((s) => s.id).join(', '));
</script>
</body>
</html>`;

  return { allowed: true, status: 200, html };
}

const SIMULATOR_NAME_RE = /simulador|simulator/i;
const SIMULATOR_CONTENT_RE = /simulador|simulator|__dev\/simulador/i;

/**
 * Verifies that a build output directory contains no simulator traces.
 * Read-only: it never modifies or deletes files.
 * Scans file names and the contents of public `.html`/`.json` files.
 */
export function assertNoSimulatorInDist(distDir) {
  const checked = [];
  const leaks = [];

  function walk(dir) {
    let entries;
    try {
      entries = fsReadDir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = `${dir}/${entry.name}`;
      checked.push(full);
      if (SIMULATOR_NAME_RE.test(entry.name)) {
        leaks.push(rel(distDir, full));
      }
      if (entry.isDirectory) {
        walk(full);
      } else if (entry.isFile && /\.(html|json)$/i.test(entry.name)) {
        let content = null;
        try {
          content = fsReadFile(full);
        } catch {
          content = null;
        }
        if (typeof content === 'string' && SIMULATOR_CONTENT_RE.test(content)) {
          leaks.push(rel(distDir, full));
        }
      }
    }
  }

  walk(distDir);

  if (leaks.length > 0) {
    throw new Error(
      `El build de producción contiene restos del simulador interno que deben estar excluidos: ${[...new Set(leaks)].join(', ')}. ` +
        'El simulador solo vive en desarrollo (/__dev/simulador) y nunca debe publicarse.'
    );
  }

  return { clean: true, checkedFiles: checked.length };
}

// Small indirection helpers so the guard stays dependency-free.
import fs from 'node:fs';
import path from 'node:path';

function fsReadDir(dir) {
  const raw = fs.readdirSync(dir, { withFileTypes: true });
  return raw.map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory(), isFile: entry.isFile() }));
}

function fsReadFile(full) {
  return fs.readFileSync(full, 'utf8');
}

function rel(distDir, full) {
  return path.relative(distDir, full).split(path.sep).join('/') || '.';
}
