# Recetario — Registro de definición

Documento de definición del producto. Recoge lo acordado, lo propuesto y lo pendiente.
Estado del proyecto: **fase de definición**. No hay código ni dependencias. Este documento es
la única fuente escrita de decisiones y está versionado en git.

Cada apartado indica su estado:

- **Acordado** — decidido por el autor del proyecto.
- **Propuesto** — recomendación del agente, sin confirmar.
- **Pendiente** — decisión abierta, sin resolver todavía.

---

## 1. Alcance y propósito

**Estado: Acordado**

Recetario es una aplicación web de recetas pensada primero para móvil, instalable como PWA,
con lectura pública sin registro.

- El catálogo se abre con un índice y un buscador, y las recetas se recorren o se buscan.
- Cualquier visitante puede leer el catálogo completo sin crear una cuenta.
- La edición está reservada al administrador.

**Fuera del alcance inicial**

- Registro de usuarios, cuentas y perfiles.
- Calificación de recetas con estrellas (retirada; ver apartado 12).
- Ingesta de recetas con asistencia de IA (retirada; la carga es manual con Keystatic, ver apartado 12).
- Propuestas de recetas enviadas por usuarios.
- Funciones premium.

---

## 2. Navegación y lectura

**Estado: Acordado**

### Portafichero

La exploración principal usa la metáfora de un portafichero de fichas.
Cada ficha muestra un resumen: **foto, descripción breve, tiempo total y tags**.
Sobre el dibujo del portafichero se ve el título de la ficha activa.

> «sobre el dibujo deberiamos observar el titulo del fichero actual, como por ejemplo Indice, Ragu Bolognesa, Pizza»

### Apertura de la receta

Al seleccionar una ficha, la receta completa se despliega con una animación suave que evoca
sacar la ficha de su folio. El dibujo del portafichero se desvanece con *fade out* y vuelve
con *fade in*. El proceso inverso se aplica al cerrar la receta y al rotar fichas en sentido
contrario.

### Navegación dentro de la lectura

Con una receta abierta siguen disponibles: **Buscador · Anterior · Siguiente · Índice · Volver al portafichero**.

Elegir otra receta desde esos controles cambia el contenido directamente, sin repetir
obligatoriamente toda la animación de extracción. El portafichero es una vía de exploración,
no la única navegación.

### Índice

El índice es una **lista tipo índice de libro**, agrupada alfabéticamente: otra forma de navegar
la misma colección, no una sección independiente.

Se llega al índice desde un enlace al pie del portafichero y desde el botón «Indice» presente
en todas las recetas.

### Orden

El orden es **alfabético por el momento**. Aplicar un filtro reduce la secuencia sin
reordenarla.

### Recorrido y filtros

Los filtros excluyen de la vista las recetas que no cumplen el criterio, por lo que
**Anterior y Siguiente recorren únicamente las recetas visibles**.

> «los filtros excluyen de la vista a las recetas que no forman parte, por lo que la navegacion debe ser a traves de las recetas visibles»

### Retorno al portafichero

Existe **una sola receta activa**, compartida entre lectura y portafichero. Si se abre A y
desde la lectura se avanza hasta C, al volver al portafichero queda activa **C**.

---

## 3. Accesibilidad

**Estado: Acordado**

Existe un **modo de navegación accesible** que reemplaza la metáfora animada por navegación
de lista.

Se activa de dos maneras combinadas:

- **Automáticamente** cuando el sistema declara movimiento reducido o contraste alto.
- **Mediante un interruptor manual** siempre disponible, que prevalece sobre la detección.

El modo es un estado persistido en el navegador, independiente de la preferencia de país y
del estado offline.

Efectos del modo: sin rotación ni animación de extracción, navegación de lista, controles
explícitos, foco visible y texto ampliado.

> Pendiente: rótulos exactos del control y su ubicación en pantalla.

---

## 4. Modelo de contenido

**Estado: Acordado** — estructura de archivos y campos, salvo lo marcado como pendiente.

El contenido son **archivos versionados**, no una base de datos. Una carpeta por receta:

```
src/content/recetas/<slug>.md
src/content/recetas/<slug>/plato.webp
src/content/recetas/<slug>/paso-1.webp
```

### Campos

| Campo | Notas |
|---|---|
| Título | Obligatorio |
| Descripción breve | Para la ficha |
| Imagen principal | Obligatoria, con origen, autor, licencia y texto alternativo |
| Tiempo total, de preparación y de cocción | Tiempo total visible en la ficha |
| Porciones | |
| Dificultad | |
| Categoría principal | |
| Tags | |
| Estaciones | |
| Ingredientes | Ver modelo híbrido abajo |
| Pasos | Numerados, con texto y foto opcional |
| Fuente y autoría | Propia, libro, sitio o video |
| Notas y variantes | |
| Video | Opcional |
| Estado | Borrador o publicada |

### Ingredientes

Modelo **híbrido**: estructurado cuando existe medida, texto libre cuando no la hay.

```yaml
ingredientes:
  - cantidad: 400
    unidad: g
    nombre: harina 000
    nota: tamizada
  - texto: sal a gusto
```

El render y cualquier ajuste futuro de porciones deben admitir ambas formas.

### Mínimos para publicar

Título, imagen principal con licencia registrada, al menos un ingrediente y al menos un paso.

### Validación y borradores

**Acordado.** El borrador se guarda libremente con campos incompletos. Una receta incompleta
**se omite del sitio** en lugar de hacer fallar la build, y la build termina con un informe
que indica cuántas recetas se omitieron, cuáles y qué campos faltan.

> «borrador libre, si esta incompleto se omite en lugar de hacer fallar toda la build (y se notifica con claridad al usuario al finalizar la build)»

Consecuencia asumida: una receta publicada que luego quede incompleta desaparece del sitio sin
error fatal, por lo que el informe de build es el único aviso. Las copias ya guardadas en
navegadores de lectores permanecen en el dispositivo hasta la próxima sincronización.

---

## 5. Imágenes

**Estado: Acordado**

- La **foto del plato es obligatoria** y se ubica **después del título**.
- Las **fotos de los pasos son opcionales** y no condicionan la publicación.
- Solo se admiten imágenes **sin derechos de autor o de autoría propia**. **No se usan imágenes generadas con IA.**
- Cada imagen registra origen, autor, licencia y texto alternativo. Sin esos datos no se publica.

> «la foto del plato debe ser obligatoria tambien (no asi la foto de los pasos). esta foto debe estar luego del titulo. utilizar fotos sin derechos de autor o de autoria propia (no quiero usar IA para las imagenes)»

El dato de licencia es declarativo: registra la afirmación del administrador, no la verifica.
Es un control de proceso, no de seguridad.

**Propuesto:** limitar formatos, no admitir SVG sin sanear y validar tamaño en build.

---

## 6. Administración

**Estado: Acordado** el enfoque; **Pendiente** la puesta en marcha.

El contenido se administra con **Keystatic**, con integración `@keystatic/astro`, en modo
**`storage: local`**: el panel corre contra el servidor de desarrollo y escribe en el disco.
**El panel no se despliega.**

Sin base de datos, sin OAuth, sin token en el navegador.

### Riesgos conocidos y aceptados

- El panel es código público en `/keystatic`; la seguridad no depende de ocultar la URL.
- En modo local no hay autenticación porque no hay usuario que autenticar.
- Si en el futuro se usa `storage: github`, el *access token* queda en una cookie legible por
  JavaScript: un XSS en el origen del panel equivale a permiso de escritura en el repositorio.
- Keystatic no aporta roles propios: el permiso es el del repositorio.
- Los guardados van a la rama configurada sin revisión, salvo que se use `branchPrefix` con
  pull request.

**Pendiente obligatorio:** bloquear `/keystatic` y `/api/keystatic` en el build de producción.
Debe **verificarse**, no suponerse.

### Ingesta con IA — retirada

**Estado: Retirada.** Las recetas se preparan y se cargan **a mano** a través del panel de
Keystatic. No hay script de importación, ni procedimiento conversacional, ni extracción desde
texto, sitios, videos o libros.

> «creo que ya que vamos a preparar recetas y subirlas con keystatic, no vamos autilizar la ingesta por IA»

Consecuencia: el volumen del catálogo depende de la carga manual del administrador, y no hace
falta definir formato de entrada, prompts ni reglas de confirmación humana.

---

## 7. Offline

**Estado: Acordado** el modelo; **Propuesto** el manejo de cuota y el detalle de la sincronización.

El lector está **100 % online** o, si instaló la PWA, **100 % offline**. No hay estados
intermedios por receta.

### Los dos modos

- **Online**: el catálogo completo por red.
- **Offline**: el catálogo completo guardado. La PWA no descarga una selección, descarga todo.

Desaparece la descarga receta por receta: el lector no elige qué guardar y no convive un listado
con unas recetas disponibles y otras no.

### Qué incluye el paquete offline

El índice, la estructura del sitio, el glosario y **todas las recetas con sus fotos**, incluidas
las de cada paso. El paquete pesa lo que pesa el catálogo, imágenes comprendidas.

> «dejemos que todo sea online 100% u offline 100% para PWA s, con la opcion de que pueda
> sincronizar nuevas recetas»

### Estado del paquete

El paquete está **completo** o **no está**. No se anuncia disponibilidad parcial: si la descarga
se interrumpió, el navegador desalojó el contenido o quedó desactualizado, la app lo dice y
offrece completarlo. La falta de conexión o de servidor se señala explícitamente.

Lo que el caché HTTP haya guardado de paso al navegar no se presenta como función: la
disponibilidad offline es la del paquete, no la de las páginas visitadas.

### Sincronización

Al reconectar se comparan versiones y se **ofrece** sincronizar las recetas nuevas o modificadas,
sin imponerlo y sin obligar a descargar de nuevo lo que no cambió.

### Riesgo de cuota

El riesgo cambia de forma: ya no es «se desalojan recetas sueltas» sino «el catálogo completo
puede no entrar o ser desalojado entero».

**Propuesto, sin confirmar:**

- Mostrar el peso estimado y pedir confirmación antes de descargar; cancelar deja la app online.
- Solicitar almacenamiento persistente.
- Avisar si no entra antes de empezar, en lugar de fallar a mitad.
- Escritura atómica y marca de completez: el paquete nunca se da por completo a medias.
- Detectar y comunicar si el navegador borró el paquete, y ofrecer reinstalarlo.
- Mostrar progreso de la descarga y de la sincronización.
- Servir imágenes optimizadas desde el build: el peso del paquete es el de esas imágenes.

---

## 8. Ubicación y país del lector

**Estado: Acordado**

El país es una **preferencia del visitante**, no un dato fijo del proyecto. Se elige
manualmente o aceptando una geolocalización voluntaria, y puede cambiarse en cualquier momento.

Se guarda en **localStorage**, no en cookies.

### Tres estados persistidos

1. **Sin preferencia guardada** — se muestra una invitación no bloqueante.
2. **Ubicación omitida o rechazada** — se recuerda esa decisión y no se repite la invitación automáticamente.
3. **País elegido** — se recuerda y permite destacados pertinentes, sin imponer filtros.

Si se borra el almacenamiento, vuelve a no existir preferencia y la invitación puede
reaparecer.

### Sin país

No se infiere ubicación por IP ni por idioma, no se aplica una estación por defecto y no se
muestran destacados de temporada actual. Se muestra el catálogo completo, y búsqueda y filtros
manuales siguen disponibles.

No se guardan coordenadas ni se hace seguimiento. La geolocalización no promete funcionar
offline: entrega coordenadas, no un país, y resolver el país requiere geocodificación inversa.

**Pendiente:** proveedor de geocodificación inversa y granularidad regional.

---

## 9. Estacionalidad

**Estado: Acordado** el filtro; **Pendiente** la fuente de datos.

Existe un filtro por **Primavera, Verano, Otoño e Invierno** para platos que usan productos de
estación, además de tags y búsqueda directa.

El país orienta, pero no garantiza la misma estacionalidad dentro de un país con regiones
climáticas distintas: donde no haya dato regional fiable debe mostrarse incertidumbre en lugar
de inventarlo.

**Pendiente:** fuente de calendarios estacionales y si la estación se carga a mano por receta.

---

## 10. Herramientas internas de desarrollo

**Estado: Acordado** el concepto; **Pendiente** el contenido.

Un **simulador interactivo de escenarios** acompañado de diagramas visuales, exclusivamente
para desarrollo interno: sirve para entender y validar la dinámica de cada proceso.

Debe quedar **fuera** de rutas públicas, navegación, recursos y paquete publicado. No es el
panel de administración ni una función para lectores.

Representa reglas acordadas; no sustituye pruebas funcionales de la aplicación.

---

## 11. Búsqueda

**Estado: Acordado** el comportamiento; **Pendiente** la verificación técnica del final.

La búsqueda es **incremental**: filtra al escribir, sin botón de confirmar, con un retardo corto
para no disparar una consulta por tecla.

### Campos indexados

| Campo | Peso | Por qué |
|---|---|---|
| Título | Alto | Es lo que el lector recuerda primero |
| Tags y categoría principal | Alto | Describen el plato, no el texto suelto |
| Descripción breve | Medio | Resumen editorial de la ficha |
| Ingredientes (estructurado y texto libre) | Medio | «pollo» debe encontrar las recetas que usan pollo |

**Excluidos:** pasos, notas y variantes, fuente y autoría, y los campos técnicos (slug, estado,
licencia, nombres de archivo). Los pasos se excluyen porque son texto largo y de relleno: «sal»
aparecería en casi todas las recetas y el índice crecería sin mejorar la búsqueda.

La búsqueda **no distingue mayúsculas ni tildes**: «pure» encuentra «puré», «ragu» encuentra
«ragú».

**Acordado: se normalizan los caracteres en los dos lados.** En build, el texto buscable se indexa
sin tildes; en el navegador, el término se normaliza antes de consultar. La página servida
conserva sus tildes: la normalización no toca lo que el lector ve.

**Propuesto para la implementación:** entregar a Pagefind una copia normalizada del HTML
generado, con su API de Node, en vez de duplicar texto oculto dentro de `data-pagefind-body`; así
el HTML publicado queda intacto. Consecuencia a asumir: los extractos de Pagefind salen del texto
normalizado y aparecen sin tildes, por eso la línea visible se arma con los metadatos propios y el
extracto sólo se usa como respaldo.

### Motor: Pagefind

El índice se genera en build con **Pagefind**, sobre el HTML ya construido, como paso posterior a
`astro build`. De ahí se derivan estos requisitos:

- El área indexable de cada receta se delimita con `data-pagefind-body`; las secciones de pasos
y notas se marcan con `data-pagefind-ignore`.
- Como consecuencia, **solo se indexan las páginas de receta**: el portafichero y el índice no
aparecen como resultados.
- Los campos de peso alto se refuerzan con `data-pagefind-weight`.
- La UI de Pagefind **no se usa**: se consume su API (`search`, `debouncedSearch`) y la lista se
dibuja con los componentes propios, para que los resultados se vean como el resto del sitio.
- El bundle `/pagefind/*` entra en el precache del service worker, que es el requisito para que
la búsqueda funcione sin conexión.

### Resultados

**Lista tipo índice**, no fichas del portafichero, encabezada por el conteo de coincidencias.
Cada resultado muestra:

1. Título de la receta.
2. Descripción breve y tags.
3. El campo que coincidió: `Coincide en: ingredientes — «pollo»`.

No lleva foto: la búsqueda prioriza densidad sobre atractivo visual.

El campo que coincidió no lo informa Pagefind, que devuelve extractos y no nombres de campo. Se
determina comparando el término contra los metadatos de la receta, que la página ya conoce; el
extracto resaltado de Pagefind queda como respaldo cuando el término no aparece en un campo
declarado. Para eso el índice de la colección que ya alimenta el portafichero se extiende con los
**nombres** de los ingredientes, sin cantidades ni notas.

### Orden

Primero por relevancia del motor, y **a igualdad de relevancia, orden alfabético**, para no
contradecir el orden de la colección.

### Relación con filtros y navegación

Búsqueda y filtros vigentes se combinan por intersección: la búsqueda opera sobre la colección y
los filtros recortan el resultado. Dentro de una receta abierta, «Anterior / Siguiente» recorre el
conjunto resultante, coherente con la regla del apartado 2.

### Sin conexión

La búsqueda funciona sin conexión sobre el **catálogo completo**, porque la PWA guarda todo
(apartado 7). No hay alcance reducido, ni aviso de cobertura parcial, ni resultados que falten
por no estar descargados. Como el índice se precachea completo de todos modos, buscar sin
conexión cuesta lo mismo que buscar con conexión.

### Pendiente de verificación en la implementación

1. Que `data-pagefind-ignore` excluya los pasos sin arrastrar los metadatos de la receta.
2. Que la búsqueda funcione de verdad sin conexión con el bundle precacheado.
3. Que la copia normalizada del HTML no introduzca diferencias de URL ni de metadatos respecto
del HTML publicado.

---

## 12. Registro de cambios de alcance

### Calificación con estrellas — retirada

1. Se pidió que las recetas pudieran evaluarse de 1 a 5 estrellas, con el valor persistido
   para permitir un ranking futuro, sin usar ese ranking por el momento.
2. Se confirmó que los lectores podrían votar en la primera versión.
3. Se eligió identificarlos con una huella local del navegador, para no agregar registro.
4. Se decidió mostrar las estrellas en la ficha y permitir votar solo en la receta abierta.
5. **Se retiró el sistema de votación completa** para mantener la aplicación sencilla.

> «bueno, entonces dejemos de lado el sistema de votacion, asi mantenemos la app sencilla»

Consecuencia: sin escritura desde el lector no hay base de datos ni API, la aplicación vuelve a
ser estática y las estrellas salen del modelo de ficha.

### Ingesta con IA — retirada

1. Se había expresado el deseo de importar recetas desde texto, sitios, videos y libros con
   asistencia de IA y confirmación humana, produciendo el mismo Markdown con frontmatter.
2. **Se retiró la ingesta con IA** porque las recetas se preparan y se suben con Keystatic.

> «creo que ya que vamos a preparar recetas y subirlas con keystatic, no vamos autilizar la ingesta por IA»

Consecuencia: la carga es manual y desaparece el pendiente de definir script local o
procedimiento conversacional. La restricción de no usar imágenes generadas con IA del apartado 5
sigue vigente y es independiente de esta decisión.

### Navegación de libro — reemplazada

La idea inicial de una estructura tipo libro fue reemplazada por el portafichero de fichas, con
índice y búsqueda. Las imágenes de referencia consultadas (Dreamstime, Amazon) fueron solo
inspiración y no son material autorizado para reutilizar.

---

## 13. Pendientes agrupados

| Área | Qué falta |
|---|---|
| Estacionalidad | Fuente de calendarios y carga manual o derivada |
| Offline | Confirmación y peso del paquete, persistencia y sincronización |
| Diseño | Bocetos de portafichero, índice y lectura |
| Accesibilidad | Rótulos y ubicación del interruptor de modo accesible |
| Seguridad | Verificar el bloqueo del panel en producción |
| Contenido | Formato del informe de build y aviso en el panel |
| Publicación | Alojamiento |
| Datos | Proveedor de geocodificación inversa |
