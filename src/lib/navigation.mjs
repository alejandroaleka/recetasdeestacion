/**
 * T3 (S2, S4): Navigation state machine for the Recetario catalog.
 *
 * Invariants (docs/decisiones.md §2):
 * - Published recipes arrive already sorted alphabetically by `titulo`.
 *   Applying a filter reduces the sequence WITHOUT reordering it.
 * - A single shared `activeSlug` lives between Portafichero and Reading:
 *   opening A and advancing to C in Reading leaves C active in Portafichero.
 * - `next()` / `prev()` step ONLY through currently visible recipes:
 *   filtered-out recipes are excluded from the view, so navigation must
 *   go through the visible ones.
 */

function normalizeInitialLetter(value) {
  const first = String(value ?? '').trim().charAt(0);
  if (!first) return '#';
  const base = first.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  if (base >= 'A' && base <= 'Z') return base;
  if (first.toUpperCase() === 'Ñ') return 'N';
  return '#';
}

function matchesEstacion(recipe, estacion) {
  if (!estacion) return true;
  return Array.isArray(recipe.estaciones) && recipe.estaciones.includes(estacion);
}

function matchesTag(recipe, tag) {
  if (!tag) return true;
  return Array.isArray(recipe.tags) && recipe.tags.includes(tag);
}

function matchesCategoria(recipe, categoria) {
  if (!categoria) return true;
  return recipe.categoriaPrincipal === categoria;
}

/**
 * Filters published recipes WITHOUT reordering them.
 * The input order (alphabetical by `titulo`) is preserved verbatim.
 */
export function filterVisibleRecipes(recipes, filters = {}) {
  const list = Array.isArray(recipes) ? recipes : [];
  const { estacion, tag, categoria } = filters ?? {};
  return list.filter(
    (recipe) => matchesEstacion(recipe, estacion) && matchesTag(recipe, tag) && matchesCategoria(recipe, categoria)
  );
}

/**
 * Tracks the single shared `activeSlug` between Portafichero and Recipe Reading.
 * Navigation steps only through the currently visible recipes.
 */
export function createCatalogNavigator(recipes, initialFilter = {}) {
  const all = Array.isArray(recipes) ? [...recipes] : [];
  let filter = { ...(initialFilter ?? {}) };
  let visible = filterVisibleRecipes(all, filter);
  const requestedActive = typeof initialFilter?.activeSlug === 'string' ? initialFilter.activeSlug : null;
  let activeSlug = requestedActive && visible.some((r) => r.slug === requestedActive)
    ? requestedActive
    : (visible[0]?.slug ?? null);

  function indexOfActive() {
    return visible.findIndex((r) => r.slug === activeSlug);
  }

  function ensureActiveVisible() {
    if (!visible.some((r) => r.slug === activeSlug)) {
      activeSlug = visible[0]?.slug ?? null;
    }
  }

  return {
    getFilter() {
      return { ...filter };
    },
    setFilter(nextFilter = {}) {
      filter = { ...(nextFilter ?? {}) };
      visible = filterVisibleRecipes(all, filter);
      ensureActiveVisible();
      return this.getVisible();
    },
    getVisible() {
      return [...visible];
    },
    getAll() {
      return [...all];
    },
    getActiveSlug() {
      return activeSlug;
    },
    getActive() {
      return visible.find((r) => r.slug === activeSlug) ?? all.find((r) => r.slug === activeSlug) ?? null;
    },
    setActive(slug) {
      const known = all.some((r) => r.slug === slug);
      if (!known) return null;
      activeSlug = slug;
      return this.getActive();
    },
    next() {
      if (visible.length === 0) return null;
      const idx = indexOfActive();
      const at = idx === -1 ? 0 : (idx + 1) % visible.length;
      activeSlug = visible[at].slug;
      return visible[at];
    },
    prev() {
      if (visible.length === 0) return null;
      const idx = indexOfActive();
      const at = idx === -1 ? visible.length - 1 : (idx - 1 + visible.length) % visible.length;
      activeSlug = visible[at].slug;
      return visible[at];
    },
    /**
     * Active card title for the Portafichero wooden drawer plaque.
     * Index mode shows 'Índice'; any other mode shows the active recipe title.
     */
    getActiveBoxTitle(mode) {
      const normalized = String(mode ?? '').trim().toLowerCase();
      if (normalized === 'indice' || normalized === 'index' || normalized === 'índice') {
        return 'Índice';
      }
      const active = this.getActive();
      return active?.titulo ?? 'Índice';
    }
  };
}

/**
 * Groups visible recipes by initial letter (A–Z) for the book-style Index.
 * Accented initials group cleanly (É -> E, Á -> A, Ñ -> N).
 */
export function groupRecipesAlphabetically(recipes) {
  const list = Array.isArray(recipes) ? recipes : [];
  const byLetter = new Map();
  for (const recipe of list) {
    const letter = normalizeInitialLetter(recipe?.titulo);
    if (!byLetter.has(letter)) byLetter.set(letter, []);
    byLetter.get(letter).push(recipe);
  }
  return [...byLetter.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'es'))
    .map(([letter, items]) => ({ letter, items: [...items] }));
}

/**
 * Hybrid accessible mode activation (§3):
 * - Manual override (`storedValue === true/false`) always prevails.
 * - Otherwise activates automatically on reduced motion or high contrast.
 * - Otherwise defaults to off.
 */
export function resolveSimpleReadingMode(options = {}) {
  const { storedValue, prefersReducedMotion, prefersHighContrast } = options ?? {};
  const label = 'Lectura simple';

  if (storedValue === true || storedValue === false) {
    return {
      active: storedValue,
      source: 'manual',
      label,
      stateText: storedValue ? 'Sí' : 'No',
      ariaPressed: storedValue ? 'true' : 'false',
      notice: storedValue
        ? 'Lectura simple activada manualmente: lista directa, sin animaciones y texto ampliado.'
        : null
    };
  }

  if (prefersReducedMotion === true || prefersHighContrast === true) {
    const reason = prefersReducedMotion === true && prefersHighContrast === true
      ? 'movimiento reducido y contraste alto del sistema'
      : prefersReducedMotion === true
        ? 'movimiento reducido del sistema'
        : 'contraste alto del sistema';
    return {
      active: true,
      source: 'system',
      label,
      stateText: 'Sí',
      ariaPressed: 'true',
      notice: `Lectura simple activada automáticamente por ${reason}. Podés desactivarla con el interruptor.`
    };
  }

  return {
    active: false,
    source: 'default',
    label,
    stateText: 'No',
    ariaPressed: 'false',
    notice: null
  };
}
