/**
 * T4 (S5): Incremental search with a Pagefind bundle generated over
 * accent-normalized HTML copies at build time.
 *
 * Contract (docs/decisiones.md §11):
 * - Both sides are normalized: the searchable text is indexed without
 *   tildes and the browser term is normalized before consulting the API.
 * - The served HTML keeps its tildes: the build hands Pagefind an
 *   in-memory normalized copy, never a rewritten file on disk.
 * - Only recipe pages are indexed: the scan only keeps HTML files that
 *   carry `data-pagefind-body`, so Portafichero `/index.html` and
 *   `/indice/index.html` never appear as results.
 * - Weighted fields: title (10), tags/category (8), short description (4),
 *   ingredients (4). Steps, notes, source and technical fields are
 *   excluded via `data-pagefind-ignore`.
 * - Results are a dense index-style list (no photos), headed by the match
 *   count, each showing the matched field (`Coincide en: <campo> — «...»`),
 *   ordered by relevance with an alphabetical tie-break, and intersected
 *   with the active filters (`filterVisibleRecipes` rules).
 */

import fs from 'node:fs';
import path from 'node:path';

import { filterVisibleRecipes } from './navigation.mjs';

const DIACRITICS_RE = /[\u0300-\u036f]/g;

/** Strips diacritics without touching case (`Ragú` -> `Ragu`). */
function stripDiacritics(value) {
  return String(value ?? '').normalize('NFD').replace(DIACRITICS_RE, '');
}

/**
 * Removes diacritics/tildes and normalizes whitespace/case.
 * `Ragú` -> `ragu`, `puré` -> `pure`, `Otoño` -> `otono`.
 */
export function normalizeSearchText(text) {
  return stripDiacritics(text).toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Collapses inner whitespace of an extracted HTML text fragment. */
function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/** Removes every HTML tag from a fragment, keeping the inner text. */
function stripTags(fragment) {
  return cleanText(String(fragment ?? '').replace(/<[^>]*>/g, ' '));
}

/**
 * Normalizes text nodes inside `data-pagefind-body` while stripping any
 * element carrying `data-pagefind-ignore` (steps, notes, source) and
 * preserving all HTML tags, attributes and URLs intact.
 *
 * Only raw text between tags is transformed; attribute values (alt text,
 * src URLs) are not text nodes and are preserved verbatim. The input
 * string is never mutated: the served HTML keeps all its tildes.
 */
export function createNormalizedHtmlCopy(html) {
  let out = String(html ?? '');

  // 1. Remove ignored elements with their whole content (nesting-safe loop).
  const ignoreRe = /<([A-Za-z][A-Za-z0-9-]*)[^>]*\bdata-pagefind-ignore\b[^>]*>[\s\S]*?<\/\1\s*>/g;
  let previous;
  do {
    previous = out;
    out = out.replace(ignoreRe, '');
  } while (out !== previous);
  out = out.replace(/<[^>]*\bdata-pagefind-ignore\b[^>]*\/>/g, '');

  // 2. Normalize text nodes only inside the data-pagefind-body scope.
  const openMatch = /<([A-Za-z][A-Za-z0-9-]*)[^>]*\bdata-pagefind-body\b[^>]*>/.exec(out);
  if (!openMatch) return out;
  const tagName = openMatch[1];
  const start = openMatch.index + openMatch[0].length;
  const end = out.indexOf(`</${tagName}`, start);
  if (end === -1) return out;

  const inner = out.slice(start, end);
  const normalizedInner = inner.replace(/>([^<>]+)</g, (whole, text) => `>${stripDiacritics(text)}<`);
  return out.slice(0, start) + normalizedInner + out.slice(end);
}

/** Recursively collects every `.html` file under a directory. */
function collectHtmlFiles(root) {
  const found = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) found.push(...collectHtmlFiles(full));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) found.push(full);
  }
  return found.sort();
}

/** Extracts the inner HTML of the first element carrying an attribute. */
function extractInnerByAttribute(html, attribute, value) {
  const pattern = new RegExp(
    `<([A-Za-z][A-Za-z0-9-]*)[^>]*\\b${attribute}\\s*=\\s*"${value}"[^>]*>([\\s\\S]*?)<\\/\\1\\s*>`
  );
  const match = pattern.exec(html);
  if (!match) return '';
  return match[2];
}

/**
 * Extracts the weighted searchable fields from the (already normalized)
 * indexing copy. Steps/notes/source were stripped beforehand by
 * `createNormalizedHtmlCopy`, so they can never leak into the bundle.
 */
function extractWeightedFields(normalizedHtml, originalHtml) {
  const titleOriginal = stripTags(extractInnerByAttribute(originalHtml, 'data-pagefind-weight', '10'));
  const titleNorm = stripTags(extractInnerByAttribute(normalizedHtml, 'data-pagefind-weight', '10'));

  const highOriginal = extractInnerByAttribute(originalHtml, 'data-pagefind-weight', '8');
  const highNormalized = extractInnerByAttribute(normalizedHtml, 'data-pagefind-weight', '8');

  const tagNames = [...highOriginal.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)]
    .map((match) => stripTags(match[1]))
    .filter(Boolean);
  const categoria = stripTags(/<p[^>]*>([\s\S]*?)<\/p>/.exec(highOriginal)?.[1] ?? '');

  // The short description is the first card-desc paragraph outside the
  // weighted blocks (the category line lives inside the weight-8 block).
  const withoutWeights = normalizedHtml
    .replace(/<[^>]*\bdata-pagefind-weight\s*=\s*"10"[^>]*>[\s\S]*?<\/[A-Za-z][^>]*>/g, ' ')
    .replace(/<[^>]*\bdata-pagefind-weight\s*=\s*"8"[^>]*>[\s\S]*?<\/[A-Za-z][^>]*>/g, ' ');
  const descriptionNorm = stripTags(/<p[^>]*class="[^"]*\bcard-desc\b[^"]*"[^>]*>([\s\S]*?)<\/p>/.exec(withoutWeights)?.[1] ?? '');

  const ingredientsMatch = /<ul[^>]*class="[^"]*\bingredients-list\b[^"]*"[^>]*>([\s\S]*?)<\/ul>/.exec(normalizedHtml);
  const ingredients = ingredientsMatch
    ? [...ingredientsMatch[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)]
        .map((match) => stripTags(match[1]))
        .filter(Boolean)
    : [];

  const highNorm = stripTags(highNormalized);
  const ingredientsNorm = cleanText(ingredients.join(' '));
  const excerpt = cleanText(
    [stripTags(highNormalized) || titleNorm, descriptionNorm, ingredients.slice(0, 3).join(', ')]
      .filter(Boolean)
      .join(' · ')
  );

  return {
    titleOriginal,
    titleNorm,
    tags: tagNames,
    categoria,
    highNorm,
    descriptionNorm,
    ingredients,
    ingredientsNorm,
    excerpt
  };
}

/** Renders the self-contained offline ESM bundle (`pagefind.js`). */
function renderPagefindModule(records) {
  const payload = JSON.stringify(records);
  return `/**
 * Auto-generated by buildPagefindIndex (T4, S5). Offline bundle: precached
 * under dist/pagefind/ by the service worker. No network access: every
 * record is embedded, so search() works at 100% offline.
 */
const RECORDS = ${payload};

function stripDiacritics(value) {
  return String(value ?? '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');
}

function normalizeQuery(term) {
  return stripDiacritics(term).toLowerCase().replace(/\\s+/g, ' ').trim();
}

function scoreRecord(tokens, record) {
  let score = 0;
  for (const token of tokens) {
    if (!token) continue;
    if (record.titleNorm.includes(token)) score += 10;
    if (record.highNorm.includes(token)) score += 8;
    if (record.descriptionNorm.includes(token)) score += 4;
    if (record.ingredientsNorm.includes(token)) score += 4;
  }
  return score;
}

function rankRecords(tokens, limit) {
  const scored = [];
  for (const record of RECORDS) {
    const matchesEveryToken = tokens.every(
      (token) =>
        record.titleNorm.includes(token) ||
        record.highNorm.includes(token) ||
        record.descriptionNorm.includes(token) ||
        record.ingredientsNorm.includes(token)
    );
    if (!matchesEveryToken) continue;
    scored.push({ record, score: scoreRecord(tokens, record) });
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.record.title.localeCompare(b.record.title, 'es', { sensitivity: 'base' });
  });
  const sliced = typeof limit === 'number' ? scored.slice(0, limit) : scored;
  return sliced.map(({ record, score }) => ({
    slug: record.slug,
    url: record.url,
    title: record.title,
    excerpt: record.excerpt,
    score
  }));
}

/** Offline search over the precached bundle (accent-insensitive). */
export function search(term, opts = {}) {
  const normalized = normalizeQuery(term);
  if (!normalized) return [];
  const tokens = normalized.split(' ');
  const limit = opts && typeof opts.limit === 'number' ? opts.limit : undefined;
  return rankRecords(tokens, limit);
}

/**
 * Incremental-search helper: debounces keystrokes before consulting the
 * precached bundle. Never touches the network.
 */
export function debouncedSearch(term, opts = {}, delayMs = 150) {
  const options = opts && typeof opts === 'object' ? opts : {};
  let delay = 150;
  if (typeof delayMs === 'number') delay = delayMs;
  else if (typeof opts === 'number') delay = opts;
  return new Promise((resolve) => {
    setTimeout(() => resolve(search(term, options)), delay);
  });
}

export const bundleInfo = { version: 1, languages: ['es'], pageCount: RECORDS.length };
`;
}

/**
 * Scans `distDir` for HTML files carrying `data-pagefind-body`, builds
 * in-memory normalized copies (the published files on disk are never
 * touched, so the served HTML keeps its tildes) and writes the
 * offline-precacheable Pagefind bundle to `dist/pagefind/`:
 * `pagefind-entry.json` plus the self-contained `pagefind.js` ESM module.
 */
export function buildPagefindIndex(distDir) {
  const root = path.resolve(distDir);
  const candidates = collectHtmlFiles(root).filter((file) => {
    if (!file.startsWith(root)) return false;
    const content = fs.readFileSync(file, 'utf8');
    return content.includes('data-pagefind-body');
  });

  const records = candidates.map((file) => {
    const original = fs.readFileSync(file, 'utf8');
    const normalized = createNormalizedHtmlCopy(original);
    const fields = extractWeightedFields(normalized, original);
    const url = `/${path.relative(root, path.dirname(file)).split(path.sep).join('/')}/`;
    const slug = url.split('/').filter(Boolean).pop() ?? path.basename(path.dirname(file));
    return {
      slug,
      url,
      title: fields.titleOriginal,
      titleNorm: normalizeSearchText(fields.titleNorm),
      tags: fields.tags,
      categoria: fields.categoria,
      highNorm: normalizeSearchText(fields.highNorm),
      descriptionNorm: normalizeSearchText(fields.descriptionNorm),
      ingredients: fields.ingredients,
      ingredientsNorm: normalizeSearchText(fields.ingredientsNorm),
      excerpt: fields.excerpt
    };
  });

  records.sort((a, b) => a.url.localeCompare(b.url));

  const entry = {
    version: 1,
    generator: 'recetario-pagefind-t4',
    languages: ['es'],
    pageCount: records.length,
    records
  };

  const pagefindDir = path.join(root, 'pagefind');
  fs.mkdirSync(pagefindDir, { recursive: true });
  const entryPath = path.join(pagefindDir, 'pagefind-entry.json');
  const bundlePath = path.join(pagefindDir, 'pagefind.js');
  fs.writeFileSync(entryPath, `${JSON.stringify(entry, null, 2)}\n`, 'utf8');
  fs.writeFileSync(bundlePath, renderPagefindModule(records), 'utf8');

  return {
    pageCount: records.length,
    urls: records.map((record) => record.url),
    entryPath,
    bundlePath
  };
}

/** Ingredient names from either catalogo.json shape. */
function ingredientNamesOf(recipeMeta) {
  const raw = recipeMeta?.ingredientesNombres ?? recipeMeta?.ingredientes ?? [];
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') {
        if (typeof item.texto === 'string' && item.texto.trim()) return item.texto.trim();
        return String(item.nombre ?? '');
      }
      return '';
    })
    .filter(Boolean);
}

/** True when every normalized query token appears in the normalized field. */
function fieldMatches(normalizedField, tokens) {
  if (!normalizedField || tokens.length === 0) return false;
  return tokens.every((token) => token && normalizedField.includes(token));
}

/**
 * Determines the matched field for a query against `recipeMeta` from
 * `catalogo.json` and returns the exact Spanish attribution string with
 * the original accented value, e.g.
 * `Coincide en: título — «Ragú Bolognesa Tradicional»`.
 * Falls back to `fallbackExcerpt` when the term is not found in a
 * declared metadata field (the Pagefind excerpt is then the backup).
 */
export function resolveMatchedField(query, recipeMeta, fallbackExcerpt) {
  const normalizedQuery = normalizeSearchText(query);
  const tokens = normalizedQuery ? normalizedQuery.split(' ') : [];
  const meta = recipeMeta ?? {};

  if (tokens.length > 0) {
    if (fieldMatches(normalizeSearchText(meta.titulo), tokens)) {
      return `Coincide en: título — «${meta.titulo}»`;
    }

    const tags = Array.isArray(meta.tags) ? meta.tags : [];
    const matchingTag = tags.find((tag) => fieldMatches(normalizeSearchText(tag), tokens));
    if (matchingTag) {
      return `Coincide en: tags — «${matchingTag}»`;
    }

    if (meta.categoriaPrincipal && fieldMatches(normalizeSearchText(meta.categoriaPrincipal), tokens)) {
      return `Coincide en: categoría — «${meta.categoriaPrincipal}»`;
    }

    if (meta.descripcionBreve && fieldMatches(normalizeSearchText(meta.descripcionBreve), tokens)) {
      const description = String(meta.descripcionBreve);
      const shown = description.length > 120 ? `${description.slice(0, 117)}…` : description;
      return `Coincide en: descripción — «${shown}»`;
    }

    const matchingIngredient = ingredientNamesOf(meta).find((name) =>
      fieldMatches(normalizeSearchText(name), tokens)
    );
    if (matchingIngredient) {
      return `Coincide en: ingredientes — «${matchingIngredient}»`;
    }
  }

  return fallbackExcerpt ?? `Coincide en: texto — «${String(query ?? '')}»`;
}

function asRecordList(bundle) {
  if (Array.isArray(bundle)) return bundle;
  if (bundle && Array.isArray(bundle.records)) return bundle.records;
  return [];
}

function scoreBundleRecord(tokens, record) {
  let score = 0;
  for (const token of tokens) {
    if (record.titleNorm?.includes(token)) score += 10;
    if (record.highNorm?.includes(token)) score += 8;
    if (record.descriptionNorm?.includes(token)) score += 4;
    if (record.ingredientsNorm?.includes(token)) score += 4;
  }
  return score;
}

function recordMatchesEveryToken(tokens, record) {
  return tokens.every(
    (token) =>
      record.titleNorm?.includes(token) ||
      record.highNorm?.includes(token) ||
      record.descriptionNorm?.includes(token) ||
      record.ingredientsNorm?.includes(token)
  );
}

/**
 * Searches the catalog: normalizes the query, scores bundle records
 * (high weight for title/tags/category, medium for description and
 * ingredients), intersects with `filter` using the same rules as
 * `filterVisibleRecipes`, and sorts by relevance descending with an
 * alphabetical (`es`, base sensitivity) tie-break.
 *
 * Results carry no photos: search prioritizes density over visual appeal.
 */
export function searchCatalog(query, { bundle, catalogo, filter = {} } = {}) {
  const normalizedQuery = normalizeSearchText(query);
  const tokens = normalizedQuery ? normalizedQuery.split(' ') : [];
  const recipes = Array.isArray(catalogo) ? catalogo : [];
  const visible = filterVisibleRecipes(recipes, filter ?? {});

  if (tokens.length === 0) {
    return { total: 0, query: String(query ?? ''), normalizedQuery, results: [], visibleSlugs: [] };
  }

  const bySlug = new Map();
  for (const record of asRecordList(bundle)) {
    if (record?.slug) bySlug.set(record.slug, record);
  }

  const results = [];
  for (const recipe of visible) {
    const record = bySlug.get(recipe.slug);
    let score = 0;
    let excerpt = '';
    if (record) {
      if (!recordMatchesEveryToken(tokens, record)) continue;
      score = scoreBundleRecord(tokens, record);
      excerpt = record.excerpt ?? '';
    } else {
      // Defensive fallback when the bundle lacks the recipe: same weights
      // over the catalogo.json metadata.
      const derived = {
        titleNorm: normalizeSearchText(recipe.titulo),
        highNorm: normalizeSearchText(
          [recipe.categoriaPrincipal, ...(Array.isArray(recipe.tags) ? recipe.tags : [])].filter(Boolean).join(' ')
        ),
        descriptionNorm: normalizeSearchText(recipe.descripcionBreve),
        ingredientsNorm: normalizeSearchText(ingredientNamesOf(recipe).join(' '))
      };
      if (!recordMatchesEveryToken(tokens, derived)) continue;
      score = scoreBundleRecord(tokens, derived);
      excerpt = cleanText(
        [recipe.titulo, recipe.descripcionBreve].filter(Boolean).join(' · ')
      );
    }
    if (score <= 0) continue;
    results.push({
      slug: recipe.slug,
      url: `/recetas/${recipe.slug}/`,
      titulo: recipe.titulo,
      descripcionBreve: recipe.descripcionBreve ?? '',
      tags: Array.isArray(recipe.tags) ? [...recipe.tags] : [],
      tiempoTotalMin: recipe.tiempoTotalMin ?? null,
      score,
      matchLabel: resolveMatchedField(query, recipe, excerpt)
    });
  }

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(a.titulo).localeCompare(String(b.titulo), 'es', { sensitivity: 'base' });
  });

  return {
    total: results.length,
    query: String(query ?? ''),
    normalizedQuery,
    results,
    visibleSlugs: results.map((item) => item.slug)
  };
}
