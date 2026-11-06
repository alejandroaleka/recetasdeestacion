import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CATALOG_PATH = path.resolve(__dirname, '../content/estacionalidad/argentina.json');

export const ESTACIONES_VALIDAS = ['Primavera', 'Verano', 'Otoño', 'Invierno'];

export function loadSeasonalityCatalog(customPath = DEFAULT_CATALOG_PATH) {
  const raw = fs.readFileSync(customPath, 'utf8');
  return JSON.parse(raw);
}

/**
 * Resuelve los 3 estados persistidos en localStorage (§8 y §9):
 * 1. sin-preferencia
 * 2. omitida
 * 3. elegida (con validación de país y subregión sobre la tabla cerrada)
 */
export function resolveLocationPreference(preference, catalog = loadSeasonalityCatalog(), month = new Date().getMonth() + 1) {
  if (!preference || !preference.estado || preference.estado === 'sin-preferencia') {
    return {
      estado: 'sin-preferencia',
      mostrarInvitacion: true,
      incertidumbre: false,
      mensajeIncertidumbre: null,
      pais: null,
      subregion: null,
      estacionActual: null,
      productosEnTemporada: []
    };
  }

  if (preference.estado === 'omitida') {
    return {
      estado: 'omitida',
      mostrarInvitacion: false,
      incertidumbre: false,
      mensajeIncertidumbre: null,
      pais: null,
      subregion: null,
      estacionActual: null,
      productosEnTemporada: []
    };
  }

  const pais = (preference.pais || '').trim().toUpperCase();
  const subregionId = (preference.subregion || '').trim().toLowerCase();

  if (pais !== catalog.paisCodigo) {
    return {
      estado: 'elegida',
      mostrarInvitacion: false,
      incertidumbre: true,
      mensajeIncertidumbre:
        'El país seleccionado no está cubierto por la tabla estacional curada. Se muestra la incertidumbre en lugar de inventar el dato; podés usar el filtro manual por las cuatro estaciones.',
      pais,
      subregion: subregionId || null,
      estacionActual: null,
      productosEnTemporada: []
    };
  }

  const subregion = catalog.subregiones.find((s) => s.id === subregionId);
  if (!subregion) {
    return {
      estado: 'elegida',
      mostrarInvitacion: false,
      incertidumbre: true,
      mensajeIncertidumbre:
        'Falta elegir una subregión climática cubierta dentro del país. Como el país abarca climas distintos, se muestra la incertidumbre en lugar de inventar la estación; quedan disponibles las cuatro estaciones manuales.',
      pais,
      subregion: null,
      estacionActual: null,
      productosEnTemporada: []
    };
  }

  const estacionActual = catalog.calendarioMensual[String(month)] || 'Otoño';
  const productosEnTemporada = catalog.productos.filter((prod) => {
    const estaciones = prod.estacionesPorSubregion?.[subregion.id] || [];
    return estaciones.includes(estacionActual);
  });

  return {
    estado: 'elegida',
    mostrarInvitacion: false,
    incertidumbre: false,
    mensajeIncertidumbre: null,
    pais: catalog.paisCodigo,
    subregion: subregion.id,
    subregionNombre: subregion.nombre,
    estacionActual,
    productosEnTemporada
  };
}

/**
 * Contrasta coordenadas localmente contra los límites estáticos de las subregiones curadas (§8).
 * No envía datos a terceros ni almacena coordenadas.
 */
export function resolveCoordinatesLocally(lat, lon, catalog = loadSeasonalityCatalog()) {
  if (typeof lat !== 'number' || typeof lon !== 'number' || Number.isNaN(lat) || Number.isNaN(lon)) {
    return { cubierta: false, pais: null, subregion: null };
  }

  for (const sub of catalog.subregiones) {
    const b = sub.limites;
    if (lat >= b.latMin && lat <= b.latMax && lon >= b.lonMin && lon <= b.lonMax) {
      return {
        cubierta: true,
        pais: catalog.paisCodigo,
        subregion: sub.id,
        subregionNombre: sub.nombre
      };
    }
  }

  return { cubierta: false, pais: null, subregion: null };
}

/**
 * Devuelve qué productos de estación declarados explícitamente en la receta
 * están en temporada en la subregión y estación indicadas (§9).
 * Nunca cruza el texto libre de ingredientes.
 */
export function getRecipeSeasonalHighlights(recipe, catalog, subregionId, season) {
  if (!recipe || !Array.isArray(recipe.productosEstacion) || !subregionId || !season) {
    return [];
  }

  const explicitIds = new Set(recipe.productosEstacion);
  return catalog.productos.filter((prod) => {
    if (!explicitIds.has(prod.id)) return false;
    const activeSeasons = prod.estacionesPorSubregion?.[subregionId] || [];
    return activeSeasons.includes(season);
  });
}
