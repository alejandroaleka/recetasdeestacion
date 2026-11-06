import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildSite } from '../scripts/build.mjs';

// ---------------------------------------------------------------------------
// RED gate: the dev simulator + dev server modules must exist.
// ---------------------------------------------------------------------------

test('T6 RED: src/dev/simulator.mjs exposes the simulator API', async () => {
  const simulator = await import('../src/dev/simulator.mjs');
  assert.equal(typeof simulator.getSimulatorScenarios, 'function');
  assert.equal(typeof simulator.runScenarioSimulation, 'function');
  assert.equal(typeof simulator.renderSimulatorPage, 'function');
  assert.equal(typeof simulator.assertNoSimulatorInDist, 'function');
});

test('T6 RED: scripts/dev-server.mjs exposes createAppServer', async () => {
  const server = await import('../scripts/dev-server.mjs');
  assert.equal(typeof server.createAppServer, 'function');
});

// ---------------------------------------------------------------------------
// Scenario catalog: 4 scenarios with SVG diagrams + configurable params.
// ---------------------------------------------------------------------------

test('T6 S7: getSimulatorScenarios returns the 4 agreed scenarios with SVG diagrams', async () => {
  const { getSimulatorScenarios } = await import('../src/dev/simulator.mjs');
  const scenarios = getSimulatorScenarios();
  assert.equal(scenarios.length, 4);
  const ids = scenarios.map((s) => s.id).sort();
  assert.deepEqual(ids, [
    'navegacion-busqueda-accesibilidad',
    'offline-sincronizacion-atomica',
    'ubicacion-estacionalidad',
    'validacion-borradores'
  ]);
  for (const scenario of scenarios) {
    assert.ok(scenario.title && scenario.title.length > 0, `${scenario.id} carries a title`);
    assert.ok(scenario.description && scenario.description.length > 0, `${scenario.id} carries a description`);
    assert.ok(scenario.params !== undefined, `${scenario.id} declares configurable params`);
    assert.ok(
      typeof scenario.diagramSvg === 'string' && scenario.diagramSvg.includes('<svg'),
      `${scenario.id} carries a visual SVG flow diagram`
    );
    assert.ok(scenario.diagramSvg.includes('</svg>'), `${scenario.id} diagram closes its SVG`);
  }
});

// ---------------------------------------------------------------------------
// Scenario 1: ubicacion-estacionalidad (real domain functions).
// ---------------------------------------------------------------------------

test('T6 S7: ubicacion-estacionalidad covers 3 persisted states + local bbox + explicit uncertainty', async () => {
  const { runScenarioSimulation } = await import('../src/dev/simulator.mjs');
  const result = await runScenarioSimulation('ubicacion-estacionalidad', { month: 4 });
  assert.equal(result.scenarioId, 'ubicacion-estacionalidad');
  assert.ok(result.title.length > 0);
  assert.ok(result.diagramSvg.includes('<svg'));
  assert.ok(Array.isArray(result.invariantsVerified) && result.invariantsVerified.length > 0);

  const { output } = result;
  assert.equal(output.sinPreferencia.estado, 'sin-preferencia');
  assert.equal(output.sinPreferencia.mostrarInvitacion, true);
  assert.equal(output.omitida.estado, 'omitida');
  assert.equal(output.omitida.mostrarInvitacion, false);
  assert.equal(output.elegida.estado, 'elegida');
  assert.equal(output.elegida.incertidumbre, false);
  assert.ok(output.elegida.estacionActual, 'covered subregion resolves a season');

  assert.equal(output.paisNoCubierto.incertidumbre, true);
  assert.ok(
    String(output.paisNoCubierto.mensajeIncertidumbre).length > 10,
    'uncovered country shows explicit uncertainty'
  );
  assert.equal(output.subregionFaltante.incertidumbre, true);

  assert.equal(output.coordenadas.cubierta, true);
  assert.equal(output.coordenadas.subregion, 'pampeana');
  assert.equal(output.coordenadasFuera.cubierta, false);

  assert.ok(Array.isArray(output.destacados), 'explicit producto link highlights resolve');
  assert.ok(
    output.destacados.every((p) => output.recetaMuestra.productosEstacion.includes(p.id)),
    'highlights only use the explicit productosEstacion link, never free-text matches'
  );
  assert.ok(
    !JSON.stringify(output.destacados).toLowerCase().includes('lata'),
    'no free-text false positives such as «tomate en lata»'
  );
});

// ---------------------------------------------------------------------------
// Scenario 2: validacion-borradores (real validator).
// ---------------------------------------------------------------------------

test('T6 S7: validacion-borradores omits incomplete publicada without failing, rejects AI/SVG/oversize', async () => {
  const { runScenarioSimulation } = await import('../src/dev/simulator.mjs');
  const result = await runScenarioSimulation('validacion-borradores');
  assert.equal(result.scenarioId, 'validacion-borradores');
  assert.ok(result.diagramSvg.includes('<svg'));
  const { output } = result;

  assert.ok(output.borrador.esBorrador, 'borrador is classified as draft');
  assert.ok(output.borradorEnEvaluacion, 'draft appears in the borradores bucket, not the site');
  assert.ok(output.omitidaPorIncompleta, 'incomplete publicada lands in omitidas');
  assert.ok(
    Array.isArray(output.omitidaPorIncompleta.camposFaltantes) &&
      output.omitidaPorIncompleta.camposFaltantes.length > 0,
    'omitted recipe reports its missing fields'
  );
  assert.ok(output.publicadaCompleta.publicable, 'complete publicada is publishable');
  assert.ok(
    output.informe.omitidas.some((item) => item.slug === output.omitidaPorIncompleta.slug),
    'the build-report style summary lists the omitted slug + missing fields'
  );
  assert.equal(output.banner.visible, true);
  assert.ok(output.banner.message.includes(output.omitidaPorIncompleta.slug));

  assert.ok(
    output.rechazoIA.camposFaltantes.includes('imagenPrincipal.noIA'),
    'AI-generated images are rejected'
  );
  assert.ok(
    output.rechazoSVG.camposFaltantes.includes('imagenPrincipal.formatoValido'),
    'SVG files are rejected as recipe photos'
  );
  assert.ok(
    output.rechazoPeso.camposFaltantes.includes('imagenPrincipal.tamanoMaximo'),
    'oversized files are rejected'
  );
});

// ---------------------------------------------------------------------------
// Scenario 3: navegacion-busqueda-accesibilidad (real navigator/search).
// ---------------------------------------------------------------------------

test('T6 S7: navegacion-busqueda-accesibilidad keeps one shared active recipe + visible-only nav + accent search', async () => {
  const { runScenarioSimulation } = await import('../src/dev/simulator.mjs');
  const result = await runScenarioSimulation('navegacion-busqueda-accesibilidad', { termino: 'ragu' });
  assert.equal(result.scenarioId, 'navegacion-busqueda-accesibilidad');
  assert.ok(result.diagramSvg.includes('<svg'));
  const { output } = result;

  assert.equal(output.activaTrasVolver, 'C', 'A -> C in reading stays C on return to Portafichero');
  assert.ok(
    !output.visibleFiltrada.includes(output.excluidaPorFiltro),
    'the filter excludes non-matching recipes from the view'
  );
  assert.ok(
    output.recorridoVisible.every((slug) => output.visibleFiltrada.includes(slug)),
    'Anterior / Siguiente step only through visible recipes'
  );
  assert.ok(output.busquedaSinTilde.total >= 1, 'accent-normalized search finds «Ragú» via «ragu»');
  assert.ok(
    output.busquedaSinTilde.results.some((r) => r.slug === output.slugConTilde),
    'the accented recipe is in the results'
  );
  assert.ok(
    output.interseccion.every((slug) => output.visibleFiltrada.includes(slug)),
    'search x filter combine by intersection'
  );
  assert.equal(output.lecturaManualSi.stateText, 'Sí');
  assert.equal(output.lecturaManualSi.ariaPressed, 'true');
  assert.equal(output.lecturaManualNo.stateText, 'No');
  assert.equal(output.lecturaAutomatica.active, true);
  assert.equal(output.lecturaAutomatica.source, 'system');
});

// ---------------------------------------------------------------------------
// Scenario 4: offline-sincronizacion-atomica (real offline manager).
// ---------------------------------------------------------------------------

test('T6 S7: offline-sincronizacion-atomica gates weight, stages atomically and syncs differentially', async () => {
  const { runScenarioSimulation } = await import('../src/dev/simulator.mjs');
  const result = await runScenarioSimulation('offline-sincronizacion-atomica');
  assert.equal(result.scenarioId, 'offline-sincronizacion-atomica');
  assert.ok(result.diagramSvg.includes('<svg'));
  const { output } = result;

  assert.equal(output.confirmacion.status, 'confirmation_required');
  assert.equal(output.descargasSinConfirmar, 0, 'unconfirmed install downloads zero files');
  assert.ok(String(output.pesoFormateado).length > 0, 'weight confirmation shows a formatted size');
  assert.equal(output.instalacion.status, 'installed');
  assert.ok(output.preflight.persistLlamado, 'persist() is requested');
  assert.ok(output.preflight.estimateLlamado, 'estimate() pre-flight runs');
  assert.equal(output.integridad.intact, true);
  assert.equal(output.eviction.message, 'El navegador desalojó parte del paquete offline. ¿Querés reinstalarlo?');
  assert.equal(output.sync.status, 'synced');
  assert.ok(output.sync.reusedCount >= 1, 'differential sync reuses unchanged bytes');
  assert.ok(
    !output.llamadasFetch.includes(output.recursoReutilizado),
    'unchanged bytes are never refetched'
  );
  assert.equal(output.rollback.estadoTrasFallo.packageStatus, 'complete');
});

// ---------------------------------------------------------------------------
// Unknown scenario id rejects.
// ---------------------------------------------------------------------------

test('T6 S7: runScenarioSimulation rejects unknown scenario ids', async () => {
  const { runScenarioSimulation } = await import('../src/dev/simulator.mjs');
  await assert.rejects(() => runScenarioSimulation('escenario-inexistente'), /escenario|scenario|desconocido|unknown/i);
});

// ---------------------------------------------------------------------------
// renderSimulatorPage: dev-only gate.
// ---------------------------------------------------------------------------

test('T6 S7: renderSimulatorPage serves interactive HTML+SVG in development, 404 in production', async () => {
  const { renderSimulatorPage } = await import('../src/dev/simulator.mjs');
  const dev = renderSimulatorPage({ envMode: 'development' });
  assert.equal(dev.allowed, true);
  assert.equal(dev.status, 200);
  assert.ok(typeof dev.html === 'string' && dev.html.length > 500);
  assert.ok(dev.html.includes('<svg'), 'development page embeds the visual flow diagrams');
  assert.ok(dev.html.includes('ubicacion-estacionalidad'));
  assert.ok(dev.html.includes('validacion-borradores'));
  assert.ok(dev.html.includes('navegacion-busqueda-accesibilidad'));
  assert.ok(dev.html.includes('offline-sincronizacion-atomica'));
  assert.ok(dev.html.includes('<script'), 'simulator page is interactive and self-contained');

  const prod = renderSimulatorPage({ envMode: 'production' });
  assert.equal(prod.allowed, false);
  assert.equal(prod.status, 404);
  assert.equal(prod.html, null);

  const def = renderSimulatorPage();
  assert.equal(def.allowed, false, 'default envMode is not development');
  assert.equal(def.status, 404);
});

// ---------------------------------------------------------------------------
// assertNoSimulatorInDist: clean on real build, loud on leaks, never mutates.
// ---------------------------------------------------------------------------

test('T6 S7: assertNoSimulatorInDist passes on the real buildSite() output', async () => {
  const { assertNoSimulatorInDist } = await import('../src/dev/simulator.mjs');
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'recetario-t6-'));
  try {
    const outDir = path.join(tmpRoot, 'dist');
    const reportPath = path.join(tmpRoot, '.astro', 'build-report.json');
    await buildSite({ outDir, reportPath, envMode: 'production' });
    const verdict = assertNoSimulatorInDist(outDir);
    assert.equal(verdict.clean, true);
    assert.ok(verdict.checkedFiles > 0);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('T6 S7: assertNoSimulatorInDist throws without modifying files when a leak is injected', async () => {
  const { assertNoSimulatorInDist } = await import('../src/dev/simulator.mjs');
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'recetario-t6-leak-'));
  try {
    const outDir = path.join(tmpRoot, 'dist');
    const reportPath = path.join(tmpRoot, '.astro', 'build-report.json');
    await buildSite({ outDir, reportPath, envMode: 'production' });

    const before = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
    fs.writeFileSync(
      path.join(outDir, 'index.html'),
      `${before}\n<!-- <a href="/__dev/simulador">simulador interno</a> -->`,
      'utf8'
    );
    assert.throws(() => assertNoSimulatorInDist(outDir), /simulador|simulator|__dev/i);
    const after = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
    assert.ok(after.includes('/__dev/simulador'), 'the guard only reads: injected leak is left untouched');

    fs.rmSync(path.join(outDir, 'index.html'));
    fs.writeFileSync(path.join(outDir, 'index.html'), before, 'utf8');
    fs.writeFileSync(path.join(outDir, 'simulator-bundle.js'), 'console.log("leak")', 'utf8');
    assert.throws(() => assertNoSimulatorInDist(outDir), /simulador|simulator|__dev/i);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// buildSite wires the simulator guard alongside the keystatic guard.
// ---------------------------------------------------------------------------

test('T6 S7: buildSite returns simulatorGuard and keeps the keystatic guard', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'recetario-t6-guard-'));
  try {
    const outDir = path.join(tmpRoot, 'dist');
    const reportPath = path.join(tmpRoot, '.astro', 'build-report.json');
    const result = await buildSite({ outDir, reportPath, envMode: 'production' });
    assert.ok(result.simulatorGuard, 'buildSite exposes simulatorGuard');
    assert.equal(result.simulatorGuard.clean, true);
    assert.ok(result.keystaticGuard, 'the T2 keystatic guard is preserved');
    assert.equal(result.keystaticGuard.clean, true);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// createAppServer: dev serves the simulator, production blocks it + keystatic.
// ---------------------------------------------------------------------------

async function fetchText(url) {
  const response = await fetch(url);
  return { status: response.status, body: await response.text() };
}

test('T6 S7: createAppServer serves / and /__dev/simulador in development', async () => {
  const { createAppServer } = await import('../scripts/dev-server.mjs');
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'recetario-t6-srv-'));
  try {
    const outDir = path.join(tmpRoot, 'dist');
    const reportPath = path.join(tmpRoot, '.astro', 'build-report.json');
    await buildSite({ outDir, reportPath, envMode: 'production' });
    const app = createAppServer({ distDir: outDir, envMode: 'development' });
    const port = await app.listen(0);
    try {
      const home = await fetchText(`http://127.0.0.1:${port}/`);
      assert.equal(home.status, 200);
      assert.ok(home.body.includes('Recet'), 'serves the built portafichero');

      const sim = await fetchText(`http://127.0.0.1:${port}/__dev/simulador`);
      assert.equal(sim.status, 200);
      assert.ok(sim.body.includes('<svg'), 'dev simulator route embeds the diagrams');
    } finally {
      await app.close();
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('T6 S7: createAppServer blocks /__dev/simulador and /keystatic with 404 in production', async () => {
  const { createAppServer } = await import('../scripts/dev-server.mjs');
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'recetario-t6-srv-prod-'));
  try {
    const outDir = path.join(tmpRoot, 'dist');
    const reportPath = path.join(tmpRoot, '.astro', 'build-report.json');
    await buildSite({ outDir, reportPath, envMode: 'production' });
    const app = createAppServer({ distDir: outDir, envMode: 'production' });
    const port = await app.listen(0);
    try {
      const sim = await fetchText(`http://127.0.0.1:${port}/__dev/simulador`);
      assert.equal(sim.status, 404);

      const keystatic = await fetchText(`http://127.0.0.1:${port}/keystatic`);
      assert.equal(keystatic.status, 404);

      const api = await fetchText(`http://127.0.0.1:${port}/api/keystatic`);
      assert.equal(api.status, 404);

      const home = await fetchText(`http://127.0.0.1:${port}/`);
      assert.equal(home.status, 200, 'public routes keep working in production');
    } finally {
      await app.close();
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
