/**
 * Configuración de Keystatic en modo local (S3).
 * Panel solo para `astro dev`; nunca github/cloud ni carga por IA.
 * Los campos permiten guardar borradores incompletos (isRequired: false);
 * los obligatorios para publicar llevan el aviso editorial en español.
 */
import { ALLOWED_IMAGE_EXTENSIONS, MAX_IMAGE_BYTES } from './src/lib/recipes.mjs';
import { loadSeasonalityCatalog, ESTACIONES_VALIDAS } from './src/lib/seasonality.mjs';

const catalog = loadSeasonalityCatalog();

export const AVISO_PUBLICACION =
  'Obligatorio para publicar; si falta, se guarda igual como borrador pero se omite del sitio público.';

export const AVISO_ANTI_IA =
  'Solo fotos propias o sin derechos de autor. No se usan imágenes generadas con IA: si la foto fue creada con IA, no se publica.';

const libre = { isRequired: false };
const PRODUCT_OPTIONS = catalog.productos.map((p) => ({ label: p.nombre, value: p.id }));

function imagenFields() {
  return {
    archivo: { key: 'archivo', kind: 'file', label: 'Archivo de imagen', validation: libre },
    origen: { key: 'origen', kind: 'text', label: 'Origen', validation: libre },
    autor: { key: 'autor', kind: 'text', label: 'Autor', validation: libre },
    licencia: { key: 'licencia', kind: 'text', label: 'Licencia', validation: libre },
    alt: { key: 'alt', kind: 'text', label: 'Texto alternativo', validation: libre },
    generadaConIA: {
      key: 'generadaConIA',
      kind: 'checkbox',
      label: 'Generada con IA',
      description: `${AVISO_ANTI_IA} Debe quedar sin marcar.`,
      validation: libre
    }
  };
}

export const keystaticConfig = {
  storage: { kind: 'local' },
  ui: { navigation: { Recetas: ['recetas'], Estacionalidad: ['estacionalidad'] } },
  collections: {
    recetas: {
      key: 'recetas',
      label: 'Recetas',
      path: 'src/content/recetas/*',
      slugField: 'titulo',
      schema: {
        titulo: {
          key: 'titulo',
          kind: 'text',
          label: 'Título',
          description: `${AVISO_PUBLICACION} Es lo primero que se lee en la ficha.`,
          validation: libre
        },
        descripcionBreve: {
          key: 'descripcionBreve',
          kind: 'text',
          label: 'Descripción breve',
          description: 'Resumen para la ficha del portafichero.',
          validation: libre
        },
        imagenPrincipal: {
          key: 'imagenPrincipal',
          kind: 'object',
          label: 'Imagen principal (después del título)',
          description: `${AVISO_PUBLICACION} Foto del plato con origen, autor, licencia y texto alternativo. ${AVISO_ANTI_IA}`,
          validation: libre,
          fields: imagenFields(),
          constraints: {
            extensionesPermitidas: [...ALLOWED_IMAGE_EXTENSIONS],
            pesoMaximoBytes: MAX_IMAGE_BYTES
          }
        },
        tiempoTotalMin: { key: 'tiempoTotalMin', kind: 'number', label: 'Tiempo total (min)', validation: libre },
        tiempoPreparacionMin: { key: 'tiempoPreparacionMin', kind: 'number', label: 'Preparación (min)', validation: libre },
        tiempoCoccionMin: { key: 'tiempoCoccionMin', kind: 'number', label: 'Cocción (min)', validation: libre },
        porciones: { key: 'porciones', kind: 'number', label: 'Porciones', validation: libre },
        dificultad: {
          key: 'dificultad',
          kind: 'select',
          label: 'Dificultad',
          options: ['Fácil', 'Media', 'Avanzada'],
          validation: libre
        },
        categoriaPrincipal: { key: 'categoriaPrincipal', kind: 'text', label: 'Categoría principal', validation: libre },
        tags: { key: 'tags', kind: 'array', label: 'Etiquetas', item: { kind: 'text' }, validation: libre },
        estaciones: {
          key: 'estaciones',
          kind: 'multiselect',
          label: 'Estaciones',
          options: [...ESTACIONES_VALIDAS],
          validation: libre
        },
        productosEstacion: {
          key: 'productosEstacion',
          kind: 'multiselect',
          label: 'Productos de estación',
          description: 'Referencias explícitas al catálogo de Argentina; nunca se deduce del texto libre.',
          options: PRODUCT_OPTIONS,
          validation: libre
        },
        ingredientes: {
          key: 'ingredientes',
          kind: 'array',
          label: 'Ingredientes (modelo híbrido)',
          description: `${AVISO_PUBLICACION} Se admite medida estructurada o texto libre.`,
          validation: libre,
          item: {
            kind: 'union',
            variants: {
              estructurado: {
                key: 'estructurado',
                label: 'Con medida',
                fields: {
                  cantidad: { key: 'cantidad', kind: 'text', label: 'Cantidad', validation: libre },
                  unidad: { key: 'unidad', kind: 'text', label: 'Unidad', validation: libre },
                  nombre: { key: 'nombre', kind: 'text', label: 'Nombre', validation: libre },
                  nota: { key: 'nota', kind: 'text', label: 'Nota (p. ej. tamizada)', validation: libre }
                }
              },
              textoLibre: {
                key: 'textoLibre',
                label: 'Texto libre',
                fields: {
                  texto: { key: 'texto', kind: 'text', label: 'Texto (p. ej. sal a gusto)', validation: libre }
                }
              }
            }
          }
        },
        pasos: {
          key: 'pasos',
          kind: 'array',
          label: 'Pasos numerados',
          description: `${AVISO_PUBLICACION} La foto de cada paso es opcional y también declara autoría. ${AVISO_ANTI_IA}`,
          validation: libre,
          item: {
            kind: 'object',
            fields: {
              texto: { key: 'texto', kind: 'textarea', label: 'Texto del paso', validation: libre },
              foto: { key: 'foto', kind: 'object', label: 'Foto del paso (opcional)', fields: imagenFields(), validation: libre }
            }
          }
        },
        fuente: { key: 'fuente', kind: 'text', label: 'Fuente', validation: libre },
        autoria: { key: 'autoria', kind: 'text', label: 'Autoría', validation: libre },
        notasVariantes: { key: 'notasVariantes', kind: 'textarea', label: 'Notas y variantes', validation: libre },
        video: { key: 'video', kind: 'text', label: 'Video (opcional)', validation: libre },
        estado: {
          key: 'estado',
          kind: 'select',
          label: 'Estado',
          options: [
            { label: 'Borrador', value: 'borrador' },
            { label: 'Publicada', value: 'publicada' }
          ],
          defaultValue: 'borrador',
          description: `${AVISO_PUBLICACION} En borrador se guarda libre aunque falten datos.`,
          validation: libre
        }
      }
    }
  },
  singletons: {
    estacionalidad: {
      key: 'estacionalidad',
      label: 'Estacionalidad (Argentina)',
      path: 'src/content/estacionalidad/argentina',
      description: 'Catálogo curado de referencia: 5 subregiones y 12 productos. Solo lectura desde las recetas.',
      schema: {
        paisCodigo: { key: 'paisCodigo', kind: 'text', label: 'Código de país', validation: libre },
        productos: {
          key: 'productos',
          kind: 'multiselect',
          label: 'Productos del catálogo',
          options: PRODUCT_OPTIONS,
          validation: libre
        }
      }
    }
  }
};

export default keystaticConfig;
