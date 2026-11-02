import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_RECIPES_DIR = path.resolve(__dirname, '../content/recetas');

export const ALLOWED_IMAGE_EXTENSIONS = new Set(['.webp', '.avif', '.jpg', '.jpeg', '.png']);
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB

function isNonEmptyString(val) {
  return typeof val === 'string' && val.trim().length > 0;
}

function validateImageMeta(img, prefix, camposFaltantes, maxBytes = MAX_IMAGE_BYTES) {
  if (!img || typeof img !== 'object') {
    camposFaltantes.push(prefix);
    return;
  }
  if (!isNonEmptyString(img.archivo)) {
    camposFaltantes.push(`${prefix}.archivo`);
  } else {
    const ext = path.extname(img.archivo).toLowerCase();
    if (!ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
      camposFaltantes.push(`${prefix}.formatoValido`);
    }
  }
  if (!isNonEmptyString(img.origen)) camposFaltantes.push(`${prefix}.origen`);
  if (!isNonEmptyString(img.autor)) camposFaltantes.push(`${prefix}.autor`);
  if (!isNonEmptyString(img.licencia)) camposFaltantes.push(`${prefix}.licencia`);
  if (!isNonEmptyString(img.alt)) camposFaltantes.push(`${prefix}.alt`);
  if (img.generadaConIA === true) {
    camposFaltantes.push(`${prefix}.noIA`);
  }
  if (typeof img.bytes === 'number' && img.bytes > maxBytes) {
    camposFaltantes.push(`${prefix}.tamanoMaximo`);
  }
}

function isValidIngredient(item) {
  if (!item || typeof item !== 'object') return false;
  if (isNonEmptyString(item.texto)) return true;
  return (
    (typeof item.cantidad === 'number' || isNonEmptyString(item.cantidad)) &&
    isNonEmptyString(item.unidad) &&
    isNonEmptyString(item.nombre)
  );
}

/**
 * Valida una receta según los mínimos de publicación (§4 y §5):
 * - Título
 * - Imagen principal con archivo válido (WebP/AVIF/JPEG/PNG, no SVG), origen, autor, licencia, alt y no generada con IA
 * - Al menos un ingrediente válido (modelo híbrido)
 * - Al menos un paso numerado con texto (y si tiene foto opcional, también con formato y licencia válidos)
 */
export function validateRecipe(recipe, options = {}) {
  const maxBytes = options.maxImageBytes ?? MAX_IMAGE_BYTES;
  const camposFaltantes = [];

  if (!recipe || typeof recipe !== 'object') {
    return { publicable: false, esBorrador: false, camposFaltantes: ['receta'] };
  }

  const esBorrador = recipe.estado === 'borrador';

  if (!isNonEmptyString(recipe.titulo)) {
    camposFaltantes.push('titulo');
  }

  validateImageMeta(recipe.imagenPrincipal, 'imagenPrincipal', camposFaltantes, maxBytes);

  if (!Array.isArray(recipe.ingredientes) || recipe.ingredientes.length === 0) {
    camposFaltantes.push('ingredientes');
  } else if (!recipe.ingredientes.every(isValidIngredient)) {
    camposFaltantes.push('ingredientes.formato');
  }

  if (!Array.isArray(recipe.pasos) || recipe.pasos.length === 0) {
    camposFaltantes.push('pasos');
  } else {
    recipe.pasos.forEach((paso, idx) => {
      if (!paso || !isNonEmptyString(paso.texto)) {
        camposFaltantes.push(`pasos[${idx}].texto`);
      }
      if (paso && paso.foto) {
        validateImageMeta(paso.foto, `pasos[${idx}].foto`, camposFaltantes, maxBytes);
      }
    });
  }

  return {
    publicable: !esBorrador && camposFaltantes.length === 0,
    esBorrador,
    camposFaltantes
  };
}

/**
 * Evalúa un conjunto de recetas:
 * - Borradores (`estado: 'borrador'`) se separan sin error.
 * - Recetas con `estado: 'publicada'` pero incompletas se omiten sin romper el build y se registran en el informe.
 * - Las publicadas completas se ordenan alfabéticamente por título (§2).
 */
export function evaluateCatalogRecipes(recipes, options = {}) {
  const publicadas = [];
  const borradores = [];
  const omitidas = [];

  for (const receta of recipes) {
    const result = validateRecipe(receta, options);
    if (result.esBorrador) {
      borradores.push({
        slug: receta.slug,
        titulo: receta.titulo || receta.slug,
        camposFaltantes: result.camposFaltantes
      });
    } else if (result.publicable) {
      publicadas.push(receta);
    } else {
      omitidas.push({
        slug: receta.slug,
        titulo: receta.titulo || receta.slug,
        camposFaltantes: result.camposFaltantes
      });
    }
  }

  publicadas.sort((a, b) => a.titulo.localeCompare(b.titulo, 'es', { sensitivity: 'base' }));

  const report = {
    generadoEn: new Date().toISOString(),
    totalEvaluadas: recipes.length,
    totalPublicadas: publicadas.length,
    totalBorradores: borradores.length,
    totalOmitidas: omitidas.length,
    publicadas: publicadas.map((r) => r.slug),
    borradores,
    omitidas
  };

  return { publicadas, borradores, omitidas, report };
}

export function formatBuildReport(report) {
  const lines = [
    '=== Recetario — Informe de validación de contenido ===',
    `Publicadas: ${report.totalPublicadas} | Borradores: ${report.totalBorradores} | Omitidas por incompletas: ${report.totalOmitidas}`
  ];

  if (report.omitidas.length > 0) {
    lines.push('Detalle de recetas omitidas (marcadas como publicadas pero incompletas):');
    for (const item of report.omitidas) {
      lines.push(`  - ${item.slug} (${item.titulo}): faltan [${item.camposFaltantes.join(', ')}]`);
    }
  }

  if (report.borradores.length > 0) {
    lines.push(`Borradores guardados no publicados: ${report.borradores.map((b) => b.slug).join(', ')}`);
  }

  return lines.join('\n');
}

export function writeBuildReport(report, reportPath = path.resolve(process.cwd(), '.astro/build-report.json')) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  return reportPath;
}

/**
 * Carga recetas desde archivos `.md` (con frontmatter JSON/YAML delimitado por `---`) en `src/content/recetas/<slug>.md`
 * y verifica el tamaño en bytes de las imágenes en la carpeta hermana `src/content/recetas/<slug>/`.
 */
export function loadRecipesFromDisk(recipesDir = DEFAULT_RECIPES_DIR) {
  if (!fs.existsSync(recipesDir)) {
    return evaluateCatalogRecipes([]);
  }

  const entries = fs.readdirSync(recipesDir, { withFileTypes: true });
  const mdFiles = entries.filter((e) => e.isFile() && e.name.endsWith('.md')).sort((a, b) => a.name.localeCompare(b.name));

  const recipes = mdFiles.map((entry) => {
    const slug = entry.name.replace(/\.md$/, '');
    const fullPath = path.join(recipesDir, entry.name);
    const raw = fs.readFileSync(fullPath, 'utf8');
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) {
      return { slug, estado: 'publicada' };
    }
    const frontmatter = JSON.parse(match[1]);
    const body = match[2].trim();
    const assetDir = path.join(recipesDir, slug);

    if (frontmatter.imagenPrincipal && frontmatter.imagenPrincipal.archivo) {
      const imgPath = path.join(assetDir, frontmatter.imagenPrincipal.archivo);
      if (fs.existsSync(imgPath)) {
        frontmatter.imagenPrincipal.bytes = fs.statSync(imgPath).size;
      }
    }

    if (Array.isArray(frontmatter.pasos)) {
      frontmatter.pasos = frontmatter.pasos.map((p) => {
        if (p && p.foto && p.foto.archivo) {
          const stepImgPath = path.join(assetDir, p.foto.archivo);
          if (fs.existsSync(stepImgPath)) {
            return { ...p, foto: { ...p.foto, bytes: fs.statSync(stepImgPath).size } };
          }
        }
        return p;
      });
    }

    return {
      slug,
      ...frontmatter,
      notasCuerpo: body
    };
  });

  return evaluateCatalogRecipes(recipes);
}
