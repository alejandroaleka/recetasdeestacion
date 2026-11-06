import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { keystaticConfig } from '../keystatic.config.mjs';
import {
  isKeystaticAllowedInEnv,
  resolveAdminRouteAccess,
  assertNoKeystaticInDist,
  buildDevIncompleteBanner
} from '../src/lib/keystatic-guard.mjs';
import { loadRecipesFromDisk, evaluateCatalogRecipes } from '../src/lib/recipes.mjs';
import { loadSeasonalityCatalog } from '../src/lib/seasonality.mjs';

const AVISO = 'Obligatorio para publicar';

function collectNodes(node, acc = []) {
  if (Array.isArray(node)) {
    node.forEach((n) => collectNodes(n, acc));
  } else if (node && typeof node === 'object') {
    acc.push(node);
    for (const v of Object.values(node)) collectNodes(v, acc);
  }
  return acc;
}

function findFieldByKey(config, key) {
  return collectNodes(config).find((n) => n && n.key === key);
}

test('S3: keystaticConfig usa almacenamiento local y nunca github/cloud ni ingesta por IA', () => {
  assert.equal(keystaticConfig.storage.kind, 'local');
  const serial = JSON.stringify(keystaticConfig).toLowerCase();
  assert.ok(!serial.includes('github'), 'no debe mencionar github como storage');
  assert.ok(!serial.includes('cloud'), 'no debe mencionar cloud como storage');
  for (const banned of ['openai', 'anthropic', 'ingesta', '/api/generat', 'ai-ingest']) {
    assert.ok(!serial.includes(banned), `no debe contener ruta/campo de IA: ${banned}`);
  }
});

test('S3: los campos permiten guardar borradores (isRequired false) y los obligatorios avisan en español', () => {
  const nodes = collectNodes(keystaticConfig);
  const withValidation = nodes.filter((n) => n.validation !== undefined);
  assert.ok(withValidation.length > 0, 'el esquema debe declarar validaciones');
  for (const n of withValidation) {
    assert.equal(n.validation.isRequired, false, `borrador libre: ${n.key ?? n.label} no debe bloquear guardado`);
  }
  for (const key of ['titulo', 'imagenPrincipal', 'ingredientes', 'pasos', 'estado']) {
    const field = findFieldByKey(keystaticConfig, key);
    assert.ok(field, `existe el campo ${key}`);
    assert.match(field.description ?? '', new RegExp(AVISO), `${key} avisa que es obligatorio para publicar`);
  }
  assert.match(JSON.stringify(keystaticConfig), /se guarda igual como borrador/);
});

test('S3: el esquema cubre ingredientes híbridos y fotos de paso con advertencia anti-IA', () => {
  const serial = JSON.stringify(findFieldByKey(keystaticConfig, 'ingredientes'));
  for (const prop of ['cantidad', 'unidad', 'nombre', 'nota', 'texto']) {
    assert.ok(serial.includes(prop), `ingredientes híbridos incluyen ${prop}`);
  }
  const pasosSerial = JSON.stringify(findFieldByKey(keystaticConfig, 'pasos'));
  for (const prop of ['archivo', 'origen', 'autor', 'licencia', 'alt']) {
    assert.ok(pasosSerial.includes(prop), `foto de paso incluye ${prop}`);
  }
  assert.match(
    JSON.stringify(keystaticConfig),
    /IA/,
    'el esquema advierte contra imágenes generadas con IA'
  );
});

test('S3: productos de estación referencian los 12 productos del catálogo argentino', () => {
  const catalog = loadSeasonalityCatalog();
  assert.equal(catalog.productos.length, 12);
  const serial = JSON.stringify(keystaticConfig);
  for (const prod of catalog.productos) {
    assert.ok(serial.includes(prod.id), `opciones incluyen ${prod.id}`);
  }
});

test('S3: isKeystaticAllowedInEnv solo permite development', () => {
  assert.equal(isKeystaticAllowedInEnv('development'), true);
  assert.equal(isKeystaticAllowedInEnv('production'), false);
  assert.equal(isKeystaticAllowedInEnv('test'), false);
  assert.equal(isKeystaticAllowedInEnv(undefined), false);
  assert.equal(isKeystaticAllowedInEnv(''), false);
});

test('S3: resolveAdminRouteAccess bloquea /keystatic y /api/keystatic en producción con 404', () => {
  for (const route of ['/keystatic', '/keystatic/recetas', '/api/keystatic', '/api/keystatic/collections']) {
    const blocked = resolveAdminRouteAccess(route, 'production');
    assert.deepEqual(blocked, { allowed: false, status: 404, reason: 'keystatic_disabled_in_production' });
    const allowed = resolveAdminRouteAccess(route, 'development');
    assert.equal(allowed.allowed, true);
  }
  const publicRoute = resolveAdminRouteAccess('/recetas/locro-criollo', 'production');
  assert.equal(publicRoute.allowed, true);
});

test('S3: assertNoKeystaticInDist pasa en dist limpio y falla sin tocar datos si hay restos', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'recetario-t2-'));
  try {
    const dist = path.join(tmp, 'dist');
    fs.mkdirSync(path.join(dist, 'recetas'), { recursive: true });
    fs.writeFileSync(path.join(dist, 'index.html'), '<h1>Recetario</h1>');
    fs.writeFileSync(path.join(dist, 'recetas', 'locro.html'), '<h1>Locro</h1>');
    const ok = assertNoKeystaticInDist(dist);
    assert.equal(ok.clean, true);
    assert.ok(ok.checkedFiles >= 2);

    const leaked = path.join(dist, 'keystatic', 'index.html');
    fs.mkdirSync(path.dirname(leaked), { recursive: true });
    fs.writeFileSync(leaked, '<h1>admin</h1>');
    assert.throws(() => assertNoKeystaticInDist(dist), /keystatic/i);
    assert.equal(fs.readFileSync(path.join(dist, 'index.html'), 'utf8'), '<h1>Recetario</h1>');

    fs.rmSync(path.join(dist, 'keystatic'), { recursive: true, force: true });
    const apiLeak = path.join(dist, 'api', 'keystatic', 'route.js');
    fs.mkdirSync(path.dirname(apiLeak), { recursive: true });
    fs.writeFileSync(apiLeak, 'export const GET = () => {}');
    assert.throws(() => assertNoKeystaticInDist(dist), /keystatic/i);
    assert.equal(fs.readFileSync(path.join(dist, 'recetas', 'locro.html'), 'utf8'), '<h1>Locro</h1>');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('S3: buildDevIncompleteBanner detecta la publicada incompleta del disco', () => {
  const evaluation = loadRecipesFromDisk();
  const banner = buildDevIncompleteBanner(evaluation);
  assert.equal(banner.visible, true);
  assert.ok(banner.count >= 1);
  const guiso = banner.items.find((i) => i.slug === 'guiso-lentejas-incompleto');
  assert.ok(guiso, 'el banner incluye guiso-lentejas-incompleto');
  assert.ok(guiso.camposFaltantes.includes('imagenPrincipal.licencia'));
  assert.match(banner.message, /guiso-lentejas-incompleto/);

  const empty = buildDevIncompleteBanner(evaluateCatalogRecipes([]));
  assert.deepEqual(empty, { visible: false, count: 0, message: empty.message, items: [] });
  assert.equal(typeof empty.message, 'string');
});
