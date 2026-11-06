/**
 * Guardia de Keystatic: el panel local solo existe en desarrollo (`astro dev`)
 * y queda bloqueado/excluido del build estático de producción (S3, Riesgo item 2).
 */

export function isKeystaticAllowedInEnv(envMode) {
  return envMode === 'development';
}

const BLOCKED_PREFIXES = ['/keystatic', '/api/keystatic'];

function isKeystaticPath(pathname) {
  if (typeof pathname !== 'string') return false;
  return BLOCKED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * Resuelve el acceso a una ruta: bloquea /keystatic* y /api/keystatic*
 * con 404 siempre que el entorno no sea development.
 */
export function resolveAdminRouteAccess(pathname, envMode) {
  if (isKeystaticPath(pathname) && !isKeystaticAllowedInEnv(envMode)) {
    return { allowed: false, status: 404, reason: 'keystatic_disabled_in_production' };
  }
  return { allowed: true, status: 200 };
}

import fs from 'node:fs';
import path from 'node:path';

/**
 * Verifica que un directorio de salida (dist/) no contenga restos del panel.
 * Solo lee; nunca modifica ni elimina. Lanza Error descriptivo si hay coincidencia.
 */
export function assertNoKeystaticInDist(distDir) {
  const checked = [];
  const leaks = [];

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      checked.push(full);
      const rel = path.relative(distDir, full);
      const segments = rel.split(path.sep);
      const lowerName = entry.name.toLowerCase();
      if (
        segments.some((s) => s.toLowerCase() === 'keystatic') ||
        lowerName.startsWith('keystatic.') ||
        lowerName.includes('keystatic-')
      ) {
        leaks.push(rel);
      }
      if (entry.isDirectory()) walk(full);
    }
  }

  walk(distDir);

  if (leaks.length > 0) {
    throw new Error(
      `El build de producción contiene rutas de Keystatic que deben estar excluidas: ${leaks.join(', ')}. ` +
        'Revisá la exclusión de /keystatic y /api/keystatic antes de publicar.'
    );
  }

  return { clean: true, checkedFiles: checked.length };
}

/**
 * Genera los datos del banner de alerta de desarrollo (`astro dev`):
 * recetas con estado publicada omitidas del sitio por campos faltantes.
 * Acepta la salida de evaluateCatalogRecipes o loadRecipesFromDisk.
 */
export function buildDevIncompleteBanner(evaluation) {
  const omitidas =
    evaluation?.omitidas ?? evaluation?.report?.omitidas ?? [];

  const items = omitidas.map((r) => ({
    slug: r.slug,
    titulo: r.titulo ?? r.slug,
    camposFaltantes: [...(r.camposFaltantes ?? [])]
  }));

  if (items.length === 0) {
    return {
      visible: false,
      count: 0,
      message: 'Sin recetas publicadas incompletas: todo lo marcado como publicado está visible.',
      items: []
    };
  }

  const detalle = items.map((i) => `${i.slug} (faltan: ${i.camposFaltantes.join(', ')})`).join('; ');
  return {
    visible: true,
    count: items.length,
    message:
      `Atención: ${items.length} receta(s) con estado «publicada» se omiten del sitio público por campos faltantes: ${detalle}. ` +
      'Se guardan igual como borrador hasta completar los datos obligatorios.',
    items
  };
}
