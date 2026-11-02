/**
 * T5 (S6): All-or-nothing atomic PWA offline package with differential sync.
 *
 * Contract (docs/decisiones.md §6, §7):
 * - Quote: «dejemos que todo sea online 100% u offline 100% para PWA s,
 *   con la opcion de que pueda sincronizar nuevas recetas».
 * - `offline-manifest.json` is generated at build time (route, hash and
 *   bytes per resource: HTML pages, the `/pagefind/*` bundle, JSON data
 *   and every bitmap recipe/step photo).
 * - The client manager is all-or-nothing: a weight confirmation prompt
 *   shows the estimated download size, `persist()` is requested,
 *   `estimate()` runs a pre-flight quota check, resources stage into a
 *   versioned staging cache, and only a fully verified staging area is
 *   promoted to the active cache with an atomic completeness marker.
 * - Differential sync reuses unchanged bytes from the active cache (no
 *   network), fetches only added/modified resources, purges obsolete
 *   entries, and rolls back to the previous complete version on failure.
 * - Eviction detection offers a reinstall with the exact product message.
 *
 * The manager is storage-agnostic so it runs in the browser (Cache
 * Storage + navigator.storage) and under `node --test` with the
 * in-memory fakes from `tests/t5-offline-pwa-and-headers.test.mjs`.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const OFFLINE_MANIFEST_FILENAME = 'offline-manifest.json';
export const STAGING_PREFIX = 'recetario-staging-';
export const ACTIVE_PREFIX = 'recetario-offline-';
export const ACTIVE_RECORD_KEY = 'recetario-offline-active';
export const EVICTION_MESSAGE =
  'El navegador desalojó parte del paquete offline. ¿Querés reinstalarlo?';

/** Cache name holding the in-progress download for a manifest version. */
export function stagingCacheName(versionHash) {
  return `${STAGING_PREFIX}${versionHash}`;
}

/** Cache name holding the live, fully verified package for a version. */
export function activeCacheName(versionHash) {
  return `${ACTIVE_PREFIX}${versionHash}`;
}

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function collectFilesRecursive(root) {
  const found = [];
  if (!fs.existsSync(root)) return found;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) found.push(...collectFilesRecursive(full));
    else if (entry.isFile()) found.push(full);
  }
  return found.sort();
}

/**
 * Generates `dist/offline-manifest.json`.
 *
 * Walks `distDir` recursively and records every public catalog resource:
 * HTML pages, the `/pagefind/*` bundle, `catalogo.json`,
 * `manifest.webmanifest`, the `sw.js` shell and every bitmap recipe/step
 * photo (`.webp`, `.png`, `.jpg`, `.jpeg`, `.avif`, `.gif`). Deployment
 * config (`_headers`) and the manifest itself are excluded because they
 * are never served from the offline cache.
 *
 * Each resource carries `{ path, sha256, bytes }` with a leading-slash
 * posix path, sorted deterministically by `path`. `versionHash` is the
 * SHA-256 over the canonical resource list, so any byte change anywhere
 * produces a new cache generation.
 */
export function generateOfflineManifest(distDir) {
  const root = path.resolve(distDir);
  const resources = [];
  for (const file of collectFilesRecursive(root)) {
    const relative = toPosix(path.relative(root, file));
    if (!relative || relative === OFFLINE_MANIFEST_FILENAME || relative === '_headers') continue;
    const buffer = fs.readFileSync(file);
    resources.push({
      path: `/${relative}`,
      sha256: sha256Hex(buffer),
      bytes: buffer.length
    });
  }
  resources.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const totalBytes = resources.reduce((sum, item) => sum + item.bytes, 0);
  const canonical = JSON.stringify(
    resources.map((item) => ({ path: item.path, sha256: item.sha256, bytes: item.bytes }))
  );
  const manifest = {
    version: 1,
    generator: 'recetario-offline-t5',
    generatedAt: new Date().toISOString(),
    versionHash: sha256Hex(canonical),
    resourceCount: resources.length,
    totalBytes,
    resources
  };
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, OFFLINE_MANIFEST_FILENAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
  return manifest;
}

/**
 * Compares the installed manifest (or `null` on first install) against
 * the remote manifest and plans the differential sync.
 *
 * Returns `{ hasChanges, versionChanged, addedOrModified, unchanged,
 * obsolete, deltaBytes, totalBytes }` where `addedOrModified` holds the
 * remote resources that are new or whose `sha256` changed, `unchanged`
 * holds path+sha256 hits reusable from cache without network, `obsolete`
 * holds installed resources absent from the remote manifest, and
 * `deltaBytes` is the exact download weight of the delta.
 */
export function computeManifestDelta(installedManifest, remoteManifest) {
  const remote = remoteManifest ?? { versionHash: null, totalBytes: 0, resources: [] };
  const installedResources = Array.isArray(installedManifest?.resources)
    ? installedManifest.resources
    : [];
  const remoteResources = Array.isArray(remote.resources) ? remote.resources : [];
  const installedByPath = new Map(installedResources.map((item) => [item.path, item]));
  const remotePaths = new Set(remoteResources.map((item) => item.path));

  const addedOrModified = [];
  const unchanged = [];
  for (const resource of remoteResources) {
    const previous = installedByPath.get(resource.path);
    if (previous && previous.sha256 === resource.sha256) unchanged.push(resource);
    else addedOrModified.push(resource);
  }
  const obsolete = installedResources.filter((item) => !remotePaths.has(item.path));
  const deltaBytes = addedOrModified.reduce((sum, item) => sum + (item.bytes || 0), 0);
  const hasChanges = addedOrModified.length > 0 || obsolete.length > 0;
  const versionChanged =
    (installedManifest?.versionHash ?? null) !== (remote.versionHash ?? null);

  return {
    hasChanges,
    versionChanged,
    addedOrModified,
    unchanged,
    obsolete,
    deltaBytes,
    totalBytes: remote.totalBytes ?? deltaBytes
  };
}

/**
 * Formats byte counts for the pre-download confirmation prompt using the
 * Spanish decimal comma (`18,4 KB`, `18,4 MB`).
 */
export function formatWeight(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return '0 B';
  if (value < 1024) return `${Math.round(value)} B`;
  const comma = (amount) => amount.toFixed(1).replace('.', ',');
  if (value < 1024 * 1024) return `${comma(value / 1024)} KB`;
  if (value < 1024 * 1024 * 1024) return `${comma(value / (1024 * 1024))} MB`;
  return `${comma(value / (1024 * 1024 * 1024))} GB`;
}

function progressSnapshot(completedResources, totalResources, downloadedBytes, totalBytes) {
  const percent =
    totalResources === 0 ? 100 : Math.round((completedResources / totalResources) * 100);
  return { completedResources, totalResources, downloadedBytes, totalBytes, percent };
}

async function readActiveRecord(storage) {
  if (!storage) return null;
  if (typeof storage.readActive === 'function') return (await storage.readActive()) ?? null;
  if (typeof storage.getActiveManifest === 'function') {
    return (await storage.getActiveManifest()) ?? null;
  }
  if (typeof storage.getItem === 'function') {
    try {
      const raw = await storage.getItem(ACTIVE_RECORD_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
  if (typeof storage.get === 'function') return storage.get(ACTIVE_RECORD_KEY) ?? null;
  return storage[ACTIVE_RECORD_KEY] ?? null;
}

async function writeActiveRecord(storage, record) {
  if (!storage) return;
  if (typeof storage.writeActive === 'function') return storage.writeActive(record);
  if (typeof storage.setActiveManifest === 'function') {
    return storage.setActiveManifest(record);
  }
  if (typeof storage.setItem === 'function') {
    return storage.setItem(ACTIVE_RECORD_KEY, JSON.stringify(record));
  }
  if (typeof storage.set === 'function') return storage.set(ACTIVE_RECORD_KEY, record);
  storage[ACTIVE_RECORD_KEY] = record;
}

/**
 * Creates the all-or-nothing offline package manager.
 *
 * Collaborators:
 * - `storage`: `{ persist?.(), estimate?.(), readActive?.()/writeActive?.() }`.
 *   `persist()` requests durable storage, `estimate()` returns
 *   `{ quota, usage }` for the pre-flight check, and the active-record
 *   accessors hold the atomic completeness marker.
 * - `cacheStore`: `{ open(name), keys(), delete(name) }` where each
 *   opened cache exposes `{ put, match, has?, keys, delete }`.
 * - `fetcher`: `async (path) => body` over the network.
 */
export function createOfflinePackageManager({ storage, cacheStore, fetcher } = {}) {
  if (!storage || !cacheStore || typeof fetcher !== 'function') {
    throw new Error('createOfflinePackageManager needs { storage, cacheStore, fetcher }.');
  }
  const state = { mode: 'online', packageStatus: 'not_installed' };

  function getState() {
    return { ...state };
  }

  async function getActiveManifest() {
    const record = await readActiveRecord(storage);
    return record?.manifest ?? null;
  }

  async function estimateAvailable() {
    if (typeof storage.estimate !== 'function') return null;
    const report = await storage.estimate();
    if (!report || typeof report.quota !== 'number' || typeof report.usage !== 'number') {
      return null;
    }
    return report.quota - report.usage;
  }

  async function verifyInCache(cache, resources) {
    const missing = [];
    for (const resource of resources) {
      let hit = null;
      if (typeof cache.match === 'function') hit = await cache.match(resource.path);
      else if (typeof cache.has === 'function') {
        hit = (await cache.has(resource.path)) ? true : null;
      }
      if (hit === null || hit === undefined) missing.push(resource.path);
    }
    return missing;
  }

  async function installPackage(remoteManifest, { confirmed = false, onProgress } = {}) {
    if (!remoteManifest || !Array.isArray(remoteManifest.resources)) {
      throw new Error('installPackage needs a manifest with a resources array.');
    }
    if (confirmed !== true) {
      return {
        status: 'confirmation_required',
        estimatedBytes: remoteManifest.totalBytes,
        formattedWeight: formatWeight(remoteManifest.totalBytes)
      };
    }

    if (typeof storage.persist === 'function') {
      try {
        await storage.persist();
      } catch {
        // A persist() rejection never blocks the install; the quota
        // pre-flight below is the binding gate.
      }
    }
    const available = await estimateAvailable();
    if (available !== null && available < remoteManifest.totalBytes) {
      return {
        status: 'insufficient_space',
        requiredBytes: remoteManifest.totalBytes,
        availableBytes: available,
        formattedWeight: formatWeight(remoteManifest.totalBytes)
      };
    }

    const stagingName = stagingCacheName(remoteManifest.versionHash);
    const previousRecord = await readActiveRecord(storage);
    const totalResources = remoteManifest.resources.length;
    const totalBytes = remoteManifest.totalBytes ?? 0;
    let downloadedBytes = 0;
    let completedResources = 0;
    try {
      const staging = await cacheStore.open(stagingName);
      for (const resource of remoteManifest.resources) {
        const body = await fetcher(resource.path);
        await staging.put(resource.path, body);
        downloadedBytes += resource.bytes || 0;
        completedResources += 1;
        if (typeof onProgress === 'function') {
          onProgress(progressSnapshot(completedResources, totalResources, downloadedBytes, totalBytes));
        }
      }
      const missing = await verifyInCache(staging, remoteManifest.resources);
      if (missing.length > 0) {
        throw new Error(`staging incompleto: faltan ${missing.join(', ')}`);
      }

      const activeName = activeCacheName(remoteManifest.versionHash);
      const active = await cacheStore.open(activeName);
      for (const resource of remoteManifest.resources) {
        await active.put(resource.path, await staging.match(resource.path));
      }
      const stillMissing = await verifyInCache(active, remoteManifest.resources);
      if (stillMissing.length > 0) {
        throw new Error(`promoción incompleta: faltan ${stillMissing.join(', ')}`);
      }

      await writeActiveRecord(storage, {
        manifest: remoteManifest,
        cacheName: activeName,
        installedAt: new Date().toISOString()
      });
      try {
        await cacheStore.delete(stagingName);
      } catch {
        // Best effort: a leftover staging cache never affects reads.
      }
      for (const name of await cacheStore.keys()) {
        if (name !== activeName && (name.startsWith(ACTIVE_PREFIX) || name.startsWith(STAGING_PREFIX))) {
          try {
            await cacheStore.delete(name);
          } catch {
            // Best effort cleanup of previous generations.
          }
        }
      }
      state.mode = 'offline';
      state.packageStatus = 'complete';
      return {
        status: 'installed',
        versionHash: remoteManifest.versionHash,
        resourceCount: totalResources,
        totalBytes
      };
    } catch (error) {
      try {
        await cacheStore.delete(stagingName);
      } catch {
        // The failed staging area must never survive, but a delete
        // failure must not mask the original network error.
      }
      if (previousRecord?.manifest) {
        state.mode = 'offline';
        state.packageStatus = 'complete';
      } else {
        state.mode = 'online';
        state.packageStatus = 'not_installed';
      }
      return {
        status: 'failed_incomplete',
        failedStaging: stagingName,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async function syncPackage(remoteManifest, { confirmed = false, onProgress } = {}) {
    if (!remoteManifest || !Array.isArray(remoteManifest.resources)) {
      throw new Error('syncPackage needs a manifest with a resources array.');
    }
    const record = await readActiveRecord(storage);
    const installedManifest = record?.manifest ?? null;
    const delta = computeManifestDelta(installedManifest, remoteManifest);
    if (!delta.hasChanges) {
      return { status: 'up_to_date', deltaBytes: 0, versionHash: remoteManifest.versionHash };
    }
    if (confirmed !== true) {
      return {
        status: 'sync_confirmation_required',
        deltaBytes: delta.deltaBytes,
        formattedWeight: formatWeight(delta.deltaBytes),
        addedOrModifiedCount: delta.addedOrModified.length,
        unchangedCount: delta.unchanged.length,
        obsoleteCount: delta.obsolete.length
      };
    }

    const available = await estimateAvailable();
    if (available !== null && available < delta.deltaBytes) {
      return {
        status: 'insufficient_space',
        requiredBytes: delta.deltaBytes,
        availableBytes: available,
        formattedWeight: formatWeight(delta.deltaBytes)
      };
    }

    const stagingName = stagingCacheName(remoteManifest.versionHash);
    const previousCacheName =
      record?.cacheName ??
      (installedManifest ? activeCacheName(installedManifest.versionHash) : null);
    const totalToFetch = delta.addedOrModified.length;
    let fetched = 0;
    let fetchedBytes = 0;
    try {
      const staging = await cacheStore.open(stagingName);
      let previousCache = null;
      if (previousCacheName && (await cacheStore.keys()).includes(previousCacheName)) {
        previousCache = await cacheStore.open(previousCacheName);
      }

      // Unchanged bytes are copied straight from the active cache: no
      // network involved. When the active copy itself was evicted, fall
      // back to the network for that single entry.
      for (const resource of delta.unchanged) {
        let body = previousCache ? await previousCache.match(resource.path) : null;
        if ((body === null || body === undefined) && totalToFetch >= 0) {
          body = await fetcher(resource.path);
          fetchedBytes += resource.bytes || 0;
        }
        await staging.put(resource.path, body);
      }
      for (const resource of delta.addedOrModified) {
        const body = await fetcher(resource.path);
        await staging.put(resource.path, body);
        fetched += 1;
        fetchedBytes += resource.bytes || 0;
        if (typeof onProgress === 'function') {
          onProgress(
            progressSnapshot(fetched, totalToFetch, fetchedBytes, delta.deltaBytes)
          );
        }
      }

      const missing = await verifyInCache(staging, remoteManifest.resources);
      if (missing.length > 0) {
        throw new Error(`sync incompleto: faltan ${missing.join(', ')}`);
      }

      const activeName = activeCacheName(remoteManifest.versionHash);
      const active = await cacheStore.open(activeName);
      for (const resource of remoteManifest.resources) {
        await active.put(resource.path, await staging.match(resource.path));
      }
      const stillMissing = await verifyInCache(active, remoteManifest.resources);
      if (stillMissing.length > 0) {
        throw new Error(`promoción del sync incompleta: faltan ${stillMissing.join(', ')}`);
      }

      await writeActiveRecord(storage, {
        manifest: remoteManifest,
        cacheName: activeName,
        installedAt: new Date().toISOString()
      });
      try {
        await cacheStore.delete(stagingName);
      } catch {
        // Best effort staging cleanup.
      }
      for (const name of await cacheStore.keys()) {
        if (name !== activeName && (name.startsWith(ACTIVE_PREFIX) || name.startsWith(STAGING_PREFIX))) {
          try {
            await cacheStore.delete(name);
          } catch {
            // Previous generations are best-effort garbage.
          }
        }
      }
      state.mode = 'offline';
      state.packageStatus = 'complete';
      return {
        status: 'synced',
        versionHash: remoteManifest.versionHash,
        fetchedCount: delta.addedOrModified.length,
        reusedCount: delta.unchanged.length,
        purgedCount: delta.obsolete.length,
        deltaBytes: delta.deltaBytes,
        totalBytes: remoteManifest.totalBytes
      };
    } catch (error) {
      try {
        await cacheStore.delete(stagingName);
      } catch {
        // Discarding the partial delta must not mask the network error.
      }
      if (record?.manifest) {
        state.mode = 'offline';
        state.packageStatus = 'complete';
      }
      return {
        status: 'failed_incomplete',
        failedStaging: stagingName,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async function checkIntegrity() {
    const record = await readActiveRecord(storage);
    if (!record?.manifest) {
      return { intact: true, status: 'not_installed', canReinstall: false, missing: [] };
    }
    const activeName = record.cacheName ?? activeCacheName(record.manifest.versionHash);
    if (!(await cacheStore.keys()).includes(activeName)) {
      state.mode = 'online';
      state.packageStatus = 'evicted';
      return {
        intact: false,
        status: 'evicted',
        message: EVICTION_MESSAGE,
        canReinstall: true,
        missing: record.manifest.resources.map((item) => item.path)
      };
    }
    const active = await cacheStore.open(activeName);
    const missing = await verifyInCache(active, record.manifest.resources);
    if (missing.length > 0) {
      state.mode = 'online';
      state.packageStatus = 'evicted';
      return {
        intact: false,
        status: 'evicted',
        message: EVICTION_MESSAGE,
        canReinstall: true,
        missing
      };
    }
    state.mode = 'offline';
    state.packageStatus = 'complete';
    return { intact: true, status: 'complete', canReinstall: false, missing: [] };
  }

  return { getState, getActiveManifest, installPackage, syncPackage, checkIntegrity };
}
