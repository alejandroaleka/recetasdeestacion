import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildSite } from '../scripts/build.mjs';

// ---------------------------------------------------------------------------
// In-memory fakes for the all-or-nothing offline package manager.
// ---------------------------------------------------------------------------

function createTestStorage({ quota = 200_000_000, usage = 0, persistResult = true } = {}) {
  return {
    persistCalls: 0,
    estimateCalls: 0,
    _active: null,
    _quota: quota,
    _usage: usage,
    _persistResult: persistResult,
    async persist() {
      this.persistCalls += 1;
      return !!this._persistResult;
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
    },
    async clearActive() {
      this._active = null;
    }
  };
}

function createTestCacheStore() {
  const caches = new Map();
  return {
    _caches: caches,
    openCalls: [],
    async open(name) {
      this.openCalls.push(name);
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

function createTestFetcher({ failOn = null, bodies = new Map() } = {}) {
  const calls = [];
  const fetcher = async (requestPath) => {
    calls.push(requestPath);
    if (requestPath === failOn) throw new Error(`network fail: ${requestPath}`);
    if (bodies.has(requestPath)) return bodies.get(requestPath);
    return `body-of-${requestPath}`;
  };
  fetcher.calls = calls;
  return fetcher;
}

function sampleManifest(versionHash = 'aaa111') {
  return {
    version: 1,
    generator: 'recetario-offline-t5',
    generatedAt: '2026-11-02T00:00:00.000Z',
    versionHash,
    resourceCount: 3,
    totalBytes: 300,
    resources: [
      { path: '/index.html', sha256: 'h1', bytes: 100 },
      { path: '/catalogo.json', sha256: 'h2', bytes: 100 },
      { path: '/recetas/ragu-bolognesa/plato.webp', sha256: 'h3', bytes: 100 }
    ]
  };
}

async function buildTmpSite() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'recetario-t5-'));
  const outDir = path.join(tmpRoot, 'dist');
  const reportPath = path.join(tmpRoot, '.astro', 'build-report.json');
  const result = await buildSite({ outDir, reportPath, envMode: 'production' });
  return { tmpRoot, outDir, reportPath, result };
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

// ---------------------------------------------------------------------------
// RED gate: the offline module must exist (fails before implementation).
// ---------------------------------------------------------------------------

test('S6 RED: src/lib/offline.mjs exposes the offline package API', async () => {
  const offline = await import('../src/lib/offline.mjs');
  assert.equal(typeof offline.generateOfflineManifest, 'function');
  assert.equal(typeof offline.computeManifestDelta, 'function');
  assert.equal(typeof offline.formatWeight, 'function');
  assert.equal(typeof offline.createOfflinePackageManager, 'function');
});

// ---------------------------------------------------------------------------
// formatWeight: user-facing confirmation prompt weight.
// ---------------------------------------------------------------------------

test('S6: formatWeight shows clear Spanish weights for the confirmation prompt', async () => {
  const { formatWeight } = await import('../src/lib/offline.mjs');
  assert.equal(formatWeight(0), '0 B');
  assert.equal(formatWeight(512), '512 B');
  assert.ok(formatWeight(18_432).includes('KB'), 'kilobytes carry the KB unit');
  assert.ok(formatWeight(18_432).includes(','), 'Spanish decimal comma, e.g. 18,0 KB');
  assert.equal(formatWeight(18_432), '18,0 KB');
  assert.equal(formatWeight(19_353_600), '18,5 MB');
  assert.ok(formatWeight(1024 * 1024).includes('MB'));
});

// ---------------------------------------------------------------------------
// generateOfflineManifest over a real dist/ build.
// ---------------------------------------------------------------------------

test('S6: buildSite emits dist/offline-manifest.json with HTML, pagefind, catalogo and dish+step webp', async () => {
  const { tmpRoot, outDir, result } = await buildTmpSite();
  try {
    const manifestPath = path.join(outDir, 'offline-manifest.json');
    assert.ok(fs.existsSync(manifestPath), 'dist/offline-manifest.json must exist');
    const { generateOfflineManifest } = await import('../src/lib/offline.mjs');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.ok(manifest.versionHash, 'manifest carries a version hash');
    assert.equal(manifest.resourceCount, manifest.resources.length);
    assert.equal(
      manifest.totalBytes,
      manifest.resources.reduce((sum, item) => sum + item.bytes, 0)
    );
    assert.ok(manifest.totalBytes > 0);

    const paths = manifest.resources.map((item) => item.path);
    assert.deepEqual([...paths].sort(), paths, 'resources sort deterministically by path');
    assert.ok(paths.includes('/index.html'), 'includes the portafichero page');
    assert.ok(paths.includes('/indice/index.html'), 'includes the index page');
    assert.ok(
      paths.some((item) => item.startsWith('/recetas/') && item.endsWith('/index.html')),
      'includes recipe pages'
    );
    assert.ok(paths.includes('/catalogo.json'), 'includes catalogo.json');
    assert.ok(paths.includes('/manifest.webmanifest'), 'includes the PWA manifest');
    assert.ok(
      paths.some((item) => item.startsWith('/pagefind/')),
      'includes the /pagefind/* bundle'
    );
    assert.ok(
      paths.some((item) => item === '/sw.js'),
      'includes the service worker shell'
    );
    for (const recipe of result.publicadas) {
      assert.ok(
        paths.includes(`/recetas/${recipe.slug}/plato.webp`),
        `includes the dish photo of ${recipe.slug}`
      );
    }
    assert.ok(
      paths.includes('/recetas/ragu-bolognesa/paso-1.webp'),
      'includes step photos such as paso-1.webp'
    );
    assert.ok(!paths.includes('/offline-manifest.json'), 'the manifest never lists itself');
    assert.ok(!paths.includes('/_headers'), '_headers is deployment config, not a cached resource');

    for (const resource of manifest.resources) {
      assert.match(resource.sha256, /^[0-9a-f]{64}$/, `${resource.path} carries a SHA-256 hex digest`);
      assert.ok(resource.bytes > 0, `${resource.path} carries a positive byte size`);
      const diskPath = path.join(outDir, resource.path.replace(/^\//, '').split('/').join(path.sep));
      assert.ok(fs.existsSync(diskPath), `${resource.path} matches a published file`);
      assert.equal(fs.statSync(diskPath).size, resource.bytes, `${resource.path} bytes match disk`);
    }

    // Regenerating over the same dist/ is deterministic.
    const again = generateOfflineManifest(outDir);
    assert.equal(again.versionHash, manifest.versionHash, 'same content yields the same version hash');
    assert.deepEqual(
      again.resources.map((item) => item.path),
      paths,
      'regeneration is deterministic'
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// computeManifestDelta: atomic differential sync planning.
// ---------------------------------------------------------------------------

test('S6: computeManifestDelta classifies added, modified, unchanged and obsolete resources', async () => {
  const { computeManifestDelta } = await import('../src/lib/offline.mjs');
  const installed = {
    versionHash: 'v1',
    totalBytes: 300,
    resources: [
      { path: '/a.html', sha256: 'same', bytes: 100 },
      { path: '/b.html', sha256: 'old', bytes: 100 },
      { path: '/gone.html', sha256: 'gone', bytes: 100 }
    ]
  };
  const remote = {
    versionHash: 'v2',
    totalBytes: 450,
    resources: [
      { path: '/a.html', sha256: 'same', bytes: 100 },
      { path: '/b.html', sha256: 'new', bytes: 150 },
      { path: '/c.html', sha256: 'brand-new', bytes: 200 }
    ]
  };
  const delta = computeManifestDelta(installed, remote);
  assert.equal(delta.hasChanges, true);
  assert.equal(delta.versionChanged, true);
  assert.deepEqual(
    delta.addedOrModified.map((item) => item.path).sort(),
    ['/b.html', '/c.html']
  );
  assert.deepEqual(delta.unchanged.map((item) => item.path), ['/a.html']);
  assert.deepEqual(delta.obsolete.map((item) => item.path), ['/gone.html']);
  assert.equal(delta.deltaBytes, 350);
  assert.equal(delta.totalBytes, 450);

  const identical = computeManifestDelta(remote, remote);
  assert.equal(identical.hasChanges, false);
  assert.equal(identical.versionChanged, false);
  assert.deepEqual(identical.addedOrModified, []);
  assert.equal(identical.deltaBytes, 0);

  const fresh = computeManifestDelta(null, remote);
  assert.equal(fresh.hasChanges, true);
  assert.equal(fresh.addedOrModified.length, 3);
  assert.deepEqual(fresh.unchanged, []);
});

// ---------------------------------------------------------------------------
// Confirmation gate: unconfirmed install/sync downloads zero files.
// ---------------------------------------------------------------------------

test('S6: confirmation gate blocks install and sync until the user confirms the weight', async () => {
  const { createOfflinePackageManager } = await import('../src/lib/offline.mjs');
  const storage = createTestStorage();
  const cacheStore = createTestCacheStore();
  const fetcher = createTestFetcher();
  const manager = createOfflinePackageManager({ storage, cacheStore, fetcher });
  const remote = sampleManifest();

  const asked = await manager.installPackage(remote, { confirmed: false });
  assert.equal(asked.status, 'confirmation_required');
  assert.equal(asked.estimatedBytes, remote.totalBytes);
  assert.ok(String(asked.formattedWeight).includes('B'));
  assert.equal(fetcher.calls.length, 0, 'unconfirmed install downloads zero files');
  assert.deepEqual(await cacheStore.keys(), [], 'unconfirmed install creates zero caches');
  assert.deepEqual(manager.getState(), { mode: 'online', packageStatus: 'not_installed' });

  // Install for real, then require a second confirmation before syncing.
  const done = await manager.installPackage(remote, { confirmed: true });
  assert.equal(done.status, 'installed');
  const callsAfterInstall = fetcher.calls.length;
  assert.ok(callsAfterInstall > 0);

  const remoteV2 = {
    ...remote,
    versionHash: 'bbb222',
    totalBytes: 400,
    resources: [...remote.resources, { path: '/recetas/nueva/plato.webp', sha256: 'h9', bytes: 100 }]
  };
  const syncAsked = await manager.syncPackage(remoteV2, { confirmed: false });
  assert.equal(syncAsked.status, 'sync_confirmation_required');
  assert.ok(syncAsked.deltaBytes > 0);
  assert.ok(String(syncAsked.formattedWeight).includes('B'));
  assert.equal(syncAsked.addedOrModifiedCount, 1);
  assert.equal(fetcher.calls.length, callsAfterInstall, 'unconfirmed sync downloads zero files');
});

// ---------------------------------------------------------------------------
// Persistent storage + pre-flight quota check (0 files on failure).
// ---------------------------------------------------------------------------

test('S6: install calls persist() and estimate(), aborting with 0 downloads when quota is short', async () => {
  const { createOfflinePackageManager } = await import('../src/lib/offline.mjs');
  const storage = createTestStorage({ quota: 1000, usage: 900 });
  const cacheStore = createTestCacheStore();
  const fetcher = createTestFetcher();
  const manager = createOfflinePackageManager({ storage, cacheStore, fetcher });
  const remote = sampleManifest(); // totalBytes 300 > available 100.

  const result = await manager.installPackage(remote, { confirmed: true });
  assert.equal(result.status, 'insufficient_space');
  assert.equal(storage.persistCalls, 1, 'persist() is requested before downloading');
  assert.equal(storage.estimateCalls, 1, 'estimate() pre-flight runs before downloading');
  assert.equal(fetcher.calls.length, 0, 'quota failure downloads zero files');
  assert.deepEqual(await cacheStore.keys(), [], 'quota failure creates zero caches');
  assert.deepEqual(manager.getState(), { mode: 'online', packageStatus: 'not_installed' });
  assert.equal(await manager.getActiveManifest(), null);
});

test('S6: sync pre-flight checks estimate() against the delta and downloads nothing when short', async () => {
  const { createOfflinePackageManager } = await import('../src/lib/offline.mjs');
  const storage = createTestStorage();
  const cacheStore = createTestCacheStore();
  const fetcher = createTestFetcher();
  const manager = createOfflinePackageManager({ storage, cacheStore, fetcher });
  const remote = sampleManifest();
  await manager.installPackage(remote, { confirmed: true });
  const callsAfterInstall = fetcher.calls.length;

  // Only 50 bytes free but the delta needs 200.
  storage._quota = 10_000;
  storage._usage = 9_950;
  const remoteV2 = {
    ...remote,
    versionHash: 'delta-quota',
    totalBytes: 500,
    resources: [...remote.resources, { path: '/recetas/nueva/plato.webp', sha256: 'h9', bytes: 200 }]
  };
  const result = await manager.syncPackage(remoteV2, { confirmed: true });
  assert.equal(result.status, 'insufficient_space');
  assert.equal(fetcher.calls.length, callsAfterInstall, 'short quota sync downloads zero files');
  assert.deepEqual(manager.getState(), { mode: 'offline', packageStatus: 'complete' });
});

// ---------------------------------------------------------------------------
// Atomic staging + progress reporting.
// ---------------------------------------------------------------------------

test('S6: install stages atomically, reports progress and keeps the app offline afterwards', async () => {
  const { createOfflinePackageManager } = await import('../src/lib/offline.mjs');
  const storage = createTestStorage();
  const cacheStore = createTestCacheStore();
  const fetcher = createTestFetcher();
  const manager = createOfflinePackageManager({ storage, cacheStore, fetcher });
  const remote = sampleManifest('progress-1');

  const events = [];
  const result = await manager.installPackage(remote, {
    confirmed: true,
    onProgress: (event) => events.push(event)
  });
  assert.equal(result.status, 'installed');
  assert.equal(events.length, remote.resources.length, 'one progress event per resource');
  const last = events[events.length - 1];
  assert.equal(last.completedResources, remote.resources.length);
  assert.equal(last.totalResources, remote.resources.length);
  assert.equal(last.downloadedBytes, remote.totalBytes);
  assert.equal(last.totalBytes, remote.totalBytes);
  assert.equal(last.percent, 100);
  assert.deepEqual(manager.getState(), { mode: 'offline', packageStatus: 'complete' });

  const stored = await manager.getActiveManifest();
  assert.equal(stored.versionHash, remote.versionHash);
  const leftovers = (await cacheStore.keys()).filter((name) => name.includes('staging'));
  assert.deepEqual(leftovers, [], 'staging cache is removed after promotion');
});

// ---------------------------------------------------------------------------
// Atomic rollback on interrupted download (previous version survives).
// ---------------------------------------------------------------------------

test('S6: interrupted install discards staging and keeps the previous version 100% intact', async () => {
  const { createOfflinePackageManager } = await import('../src/lib/offline.mjs');
  const storage = createTestStorage();
  const cacheStore = createTestCacheStore();
  const goodFetcher = createTestFetcher();
  const manager = createOfflinePackageManager({ storage, cacheStore, fetcher: goodFetcher });
  const v1 = sampleManifest('v1-stable');
  const installed = await manager.installPackage(v1, { confirmed: true });
  assert.equal(installed.status, 'installed');
  const cachesBefore = [...(await cacheStore.keys())].sort();

  const v2 = {
    ...v1,
    versionHash: 'v2-broken',
    totalBytes: 300,
    resources: [
      { path: '/index.html', sha256: 'same', bytes: 100 },
      { path: '/catalogo.json', sha256: 'changed', bytes: 100 },
      { path: '/recetas/ragu-bolognesa/plato.webp', sha256: 'changed-too', bytes: 100 }
    ]
  };
  // Swap in a fetcher that drops the connection mid-download.
  const failingFetcher = createTestFetcher({ failOn: '/catalogo.json' });
  const failing = createOfflinePackageManager({ storage, cacheStore, fetcher: failingFetcher });
  // Reuse the installed marker: point the new manager at the same storage/caches.
  const result = await failing.syncPackage(v2, { confirmed: true });
  assert.equal(result.status, 'failed_incomplete');
  assert.deepEqual(failing.getState(), { mode: 'offline', packageStatus: 'complete' });

  const stored = await failing.getActiveManifest();
  assert.equal(stored.versionHash, 'v1-stable', 'the previous manifest is still the active one');
  const cachesAfter = [...(await cacheStore.keys())].sort();
  assert.deepEqual(cachesAfter, cachesBefore, 'no staging leftovers and no active-cache churn');
  // Every v1 resource is still served from the active cache.
  const active = await cacheStore.open('recetario-offline-v1-stable');
  for (const resource of v1.resources) {
    assert.ok((await active.match(resource.path)) !== null, `${resource.path} still cached`);
  }
});

// ---------------------------------------------------------------------------
// Differential sync: fetch only what changed, reuse the rest, purge obsolete.
// ---------------------------------------------------------------------------

test('S6: sync fetches only added/modified files, reuses unchanged bytes and purges obsolete entries', async () => {
  const { createOfflinePackageManager } = await import('../src/lib/offline.mjs');
  const storage = createTestStorage();
  const cacheStore = createTestCacheStore();
  const fetcher = createTestFetcher();
  const manager = createOfflinePackageManager({ storage, cacheStore, fetcher });

  const v1 = {
    version: 1,
    generator: 'recetario-offline-t5',
    generatedAt: '2026-11-02T00:00:00.000Z',
    versionHash: 'sync-v1',
    resourceCount: 3,
    totalBytes: 300,
    resources: [
      { path: '/index.html', sha256: 'keep', bytes: 100 },
      { path: '/old.html', sha256: 'obsolete', bytes: 100 },
      { path: '/change.html', sha256: 'before', bytes: 100 }
    ]
  };
  await manager.installPackage(v1, { confirmed: true });
  fetcher.calls.length = 0;

  const v2 = {
    version: 1,
    generator: 'recetario-offline-t5',
    generatedAt: '2026-11-03T00:00:00.000Z',
    versionHash: 'sync-v2',
    resourceCount: 3,
    totalBytes: 350,
    resources: [
      { path: '/index.html', sha256: 'keep', bytes: 100 },
      { path: '/change.html', sha256: 'after', bytes: 150 },
      { path: '/new.html', sha256: 'fresh', bytes: 100 }
    ]
  };
  const events = [];
  const result = await manager.syncPackage(v2, {
    confirmed: true,
    onProgress: (event) => events.push(event)
  });
  assert.equal(result.status, 'synced');
  assert.deepEqual(fetcher.calls.sort(), ['/change.html', '/new.html'].sort());
  assert.ok(!fetcher.calls.includes('/index.html'), 'unchanged bytes are reused from cache, never refetched');
  assert.ok(events.length >= 2, 'progress is reported for the differential fetch');

  const stored = await manager.getActiveManifest();
  assert.equal(stored.versionHash, 'sync-v2');
  const active = await cacheStore.open('recetario-offline-sync-v2');
  assert.ok((await active.match('/index.html')) !== null, 'unchanged resource survives the switch');
  assert.ok((await active.match('/change.html')) !== null, 'modified resource is cached');
  assert.ok((await active.match('/new.html')) !== null, 'new resource is cached');
  assert.equal(await active.match('/old.html'), null, 'obsolete resource is purged');
  assert.ok(!(await cacheStore.keys()).includes('recetario-offline-sync-v1'), 'old version cache is removed');

  const alreadyCurrent = await manager.syncPackage(v2, { confirmed: true });
  assert.equal(alreadyCurrent.status, 'up_to_date');
  assert.equal(alreadyCurrent.deltaBytes, 0);
});

// ---------------------------------------------------------------------------
// Eviction detection with reinstall prompt.
// ---------------------------------------------------------------------------

test('S6: checkIntegrity detects an evicted image and offers to reinstall', async () => {
  const { createOfflinePackageManager } = await import('../src/lib/offline.mjs');
  const storage = createTestStorage();
  const cacheStore = createTestCacheStore();
  const fetcher = createTestFetcher();
  const manager = createOfflinePackageManager({ storage, cacheStore, fetcher });
  const remote = sampleManifest('evict-1');
  await manager.installPackage(remote, { confirmed: true });

  const healthy = await manager.checkIntegrity();
  assert.equal(healthy.intact, true);
  assert.equal(healthy.status, 'complete');

  // The browser evicts one cached image under memory pressure.
  const activeName = 'recetario-offline-evict-1';
  const active = await cacheStore.open(activeName);
  await active.delete('/recetas/ragu-bolognesa/plato.webp');

  const evicted = await manager.checkIntegrity();
  assert.equal(evicted.intact, false);
  assert.equal(evicted.status, 'evicted');
  assert.equal(evicted.message, 'El navegador desalojó parte del paquete offline. ¿Querés reinstalarlo?');
  assert.equal(evicted.canReinstall, true);
  assert.deepEqual(manager.getState(), { mode: 'online', packageStatus: 'evicted' });
});

// ---------------------------------------------------------------------------
// Cloudflare Pages headers + PWA metadata + Service Worker in dist/.
// ---------------------------------------------------------------------------

test('S6: buildSite copies Cloudflare _headers, the PWA manifest and sw.js into dist/', async () => {
  const { tmpRoot, outDir } = await buildTmpSite();
  try {
    const headersPath = path.join(outDir, '_headers');
    assert.ok(fs.existsSync(headersPath), 'dist/_headers must exist for Cloudflare Pages');
    const headers = fs.readFileSync(headersPath, 'utf8');
    assert.ok(headers.includes('/offline-manifest.json'), 'headers cover the offline manifest');
    assert.ok(headers.includes('/sw.js'), 'headers cover the service worker');
    assert.ok(headers.includes('Cache-Control'), 'headers carry cache controls');
    assert.ok(
      headers.match(/Cache-Control:\s*no-cache/),
      'offline-manifest.json and sw.js opt out of the cache'
    );
    assert.ok(headers.includes('/recetas/*'), 'headers cover recipe images');
    assert.ok(headers.includes('immutable'), 'recipe images use immutable long cache');

    const webmanifestPath = path.join(outDir, 'manifest.webmanifest');
    assert.ok(fs.existsSync(webmanifestPath), 'dist/manifest.webmanifest must exist');
    const webmanifest = JSON.parse(fs.readFileSync(webmanifestPath, 'utf8'));
    assert.ok(
      String(webmanifest.name ?? '').includes('Recetario'),
      'PWA metadata names the Recetario'
    );
    assert.ok(
      String(`${webmanifest.name ?? ''} ${webmanifest.short_name ?? ''}`).includes('Estación') ||
        String(`${webmanifest.name ?? ''} ${webmanifest.short_name ?? ''}`).includes('Estacion'),
      'PWA metadata mentions the seasonal scope'
    );

    const swPath = path.join(outDir, 'sw.js');
    assert.ok(fs.existsSync(swPath), 'dist/sw.js must exist');
    const sw = fs.readFileSync(swPath, 'utf8');
    assert.ok(sw.includes('offline-manifest.json'), 'the worker loads the versioned manifest');
    assert.ok(sw.toLowerCase().includes('cache'), 'the worker drives the offline cache');

    const files = listFilesRecursive(outDir);
    assert.ok(files.includes('offline-manifest.json'), 'manifest ships in dist/');
    assert.ok(files.includes('_headers'), '_headers ships in dist/');
    assert.ok(files.includes('manifest.webmanifest'), 'web manifest ships in dist/');
    assert.ok(files.includes('sw.js'), 'service worker ships in dist/');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
