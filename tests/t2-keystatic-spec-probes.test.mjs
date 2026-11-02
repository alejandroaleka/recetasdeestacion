// tests/t2-keystatic-spec-probes.test.mjs — S3 (T2)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import { keystaticConfig } from '../keystatic.config.mjs';
import { resolveAdminRouteAccess, assertNoKeystaticInDist, buildDevIncompleteBanner } from '../src/lib/keystatic-guard.mjs';
import { evaluateCatalogRecipes } from '../src/lib/recipes.mjs';

const AVISO = /obligatori[oa] para publicar/i;
const OBLIGATORIOS = ['titulo', 'imagenPrincipal', 'ingredientes', 'pasos', 'estado'];
const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 't2-probe-'));
function writeAll(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
}
function snapshot(dir) {
  return fs.readdirSync(dir, { recursive: true }).map((rel) => {
    const p = path.join(dir, String(rel));
    return fs.statSync(p).isFile()
      ? `${rel}:${crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')}`
      : `${rel}:dir`;
  }).sort().join('|');
}

test('S3: el almacenamiento es local y no hay rutas/campos de ingesta por IA', () => {
  assert.equal(keystaticConfig.storage.kind, 'local');
  assert.deepEqual(Object.keys(keystaticConfig.storage), ['kind']);
  const serial = JSON.stringify(keystaticConfig).toLowerCase();
  for (const banned of ['github', 'cloud', 'openai', 'anthropic', '/api/generate', 'ingesta', 'ocr']) {
    assert.ok(!serial.includes(banned), `el esquema no declara ${banned}`);
  }
});

test('S3: los cinco campos obligatorios para publicar se guardan como borrador y avisan en español', () => {
  const schema = keystaticConfig.collections.recetas.schema;
  for (const key of OBLIGATORIOS) {
    const field = schema[key];
    assert.ok(field, `existe ${key}`);
    assert.equal(field.validation?.isRequired, false, `${key} no bloquea el guardado de borradores`);
    assert.match(field.description ?? '', AVISO, `${key} declara el aviso de publicación`);
    assert.match(field.description ?? '', /borrador|se omite|omit/i, `${key} explica la consecuencia`);
  }
});

test('S3: resolveAdminRouteAccess devuelve 404 para el panel en todo entorno no development', () => {
  const rutas = ['/keystatic', '/keystatic/', '/keystatic/collection/recetas', '/api/keystatic',
    '/api/keystatic/github/login', '/keystatic/../keystatic', '/keystatic/%2e%2e/recetas',
    '/keystatic//collection', '/keystatic/x?y=1'];
  for (const modo of ['production', 'preview', 'staging', 'test', '', undefined, 'PRODUCTION']) {
    for (const ruta of rutas) {
      const res = resolveAdminRouteAccess(ruta, modo);
      assert.equal(res.allowed, false, `${ruta} bloqueada en ${String(modo)}`);
      assert.equal(res.status, 404, `${ruta} responde 404 en ${String(modo)}`);
    }
  }
  assert.equal(resolveAdminRouteAccess('/keystatic', 'development').allowed, true);
  for (const publica of ['/', '/recetas/locro-criollo', '/keystaticx', '/api/keystaticx']) {
    assert.equal(resolveAdminRouteAccess(publica, 'production').allowed, true, `${publica} sigue pública`);
  }
});

test('S3: assertNoKeystaticInDist detecta restos del panel (directorios y chunks/archivos) sin modificar los archivos existentes', () => {
  for (const leak of ['keystatic/index.html', 'api/keystatic/route.js', 'en/api/keystatic/login.html', 'keystatic', '_astro/keystatic.Cc9dpq.js', 'keystatic.html']) {
    const dir = tmpdir();
    try {
      writeAll(dir, { 'index.html': '<h1>Recetario</h1>', 'recetas/locro.html': '<h1>Locro</h1>', [leak]: 'panel' });
      const before = snapshot(dir);
      assert.throws(() => assertNoKeystaticInDist(dir), /keystatic/i, `detecta ${leak}`);
      assert.equal(snapshot(dir), before, `no modifica dist al detectar ${leak}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  const clean = tmpdir();
  try {
    writeAll(clean, { 'index.html': '<h1>Recetario</h1>', 'recetas/locro.html': '<h1>Locro</h1>' });
    const before = snapshot(clean);
    assert.deepEqual(assertNoKeystaticInDist(clean), { clean: true, checkedFiles: 3 });
    assert.equal(snapshot(clean), before);
  } finally {
    fs.rmSync(clean, { recursive: true, force: true });
  }
});

test('S3: buildDevIncompleteBanner marca solo publicadas incompletas, nunca borradores ni publicadas completas', () => {
  const imagenCompleta = { archivo: 'plato.webp', origen: 'propia', autor: 'A', licencia: 'CC0', alt: 'plato', generadaConIA: false };
  const incompleta = { slug: 'publicada-incompleta', titulo: 'Publicada Incompleta', estado: 'publicada',
    imagenPrincipal: { ...imagenCompleta, licencia: '' }, ingredientes: [{ texto: 'sal' }], pasos: [{ texto: 'cocinar' }] };
  const completa = { slug: 'publicada-completa', titulo: 'Publicada Completa', estado: 'publicada',
    imagenPrincipal: imagenCompleta, ingredientes: [{ texto: 'sal' }], pasos: [{ texto: 'cocinar' }] };
  const borrador = { slug: 'borrador-incompleto', titulo: 'Borrador', estado: 'borrador' };

  const banner = buildDevIncompleteBanner(evaluateCatalogRecipes([incompleta, completa, borrador]));
  assert.equal(banner.visible, true);
  assert.equal(banner.count, 1);
  assert.deepEqual(banner.items.map((i) => i.slug), ['publicada-incompleta']);
  assert.ok(banner.items[0].camposFaltantes.includes('imagenPrincipal.licencia'));
  assert.match(banner.message, /publicada-incompleta/);

  const sinOmitidas = buildDevIncompleteBanner(evaluateCatalogRecipes([completa, borrador]));
  assert.equal(sinOmitidas.visible, false);
  assert.equal(sinOmitidas.count, 0);
  assert.deepEqual(sinOmitidas.items, []);
});
