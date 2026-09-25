# CLAUDE.md — Peanut Matcher

App interna de un trader de maní (Córdoba, AR). Cruza demandas de clientes con
ofertas de proveedores, gestiona empresas, agenda y cotizaciones.

**Versión actual: 4.38.0**

---

## Reglas duras

Antes de proponer nada, leer esto.

1. **Es un solo archivo HTML.** `index.html`, ~4.500 líneas, con CSS y JS
   embebidos. No hay build, no hay npm, no hay framework.
2. **No convertir a React. No agregar bundler. No partir en módulos.** Es
   deliberado: se deploya arrastrando un ZIP a Netlify y se edita sin
   toolchain. Si una tarea parece pedir lo contrario, preguntar antes.
3. **JS estilo ES5**: `var`, `function`, concatenación de strings para el HTML.
   Mantener el estilo del archivo, no modernizarlo por gusto.
4. **Correr `./tools/check.sh` antes de dar nada por terminado.** No es
   opcional: es la única red de seguridad que hay.
5. **UI en español rioplatense** ("Cargá", "Guardá", "Actualizá").
6. **Nunca hardcodear un color.** Usar variables CSS o se rompe uno de los
   tres temas.

---

## Comandos

```bash
./tools/check.sh          # sintaxis + crosscheck + 112 tests. Correr SIEMPRE.
./tools/bump.sh 4.14.0    # sube la version en los 3 lugares que deben coincidir
./tools/package.sh        # arma el ZIP para app.netlify.com/drop

node tools/tests/precios.js   # una suite sola
```

`check.sh` hace lo que `node --check` no puede sobre un HTML monolítico:

- extrae el JS embebido a `/tmp/app.js` y lo valida
- verifica que **todo `onclick=` apunte a una función que existe** (el error más
  fácil de cometer acá: el JS es válido y el botón no hace nada)
- verifica que todo `getElementById('x')` tenga su `id` en el HTML
- verifica que las **tres versiones coincidan**
- detecta `esc()` usado dentro de un atributo (ver más abajo)
- corre las 5 suites de tests

---

## Deploy

Tres lugares con la versión, tienen que coincidir o el gate bloquea a los
usuarios: `var APP_VERSION`, la pastilla `id="ver-pill"`, y `version.json`.
`bump.sh` los toca a los tres.

```bash
./tools/bump.sh 4.14.0 && ./tools/check.sh && ./tools/package.sh
```

Después: arrastrar el ZIP a `app.netlify.com/drop`, refrescar con
Ctrl/Cmd+Shift+R, confirmar la pastilla. Al equipo le salta un cartel
bloqueante de actualización: es lo esperado.

---

## Datos

Google Sheets privado vía Sheets API v4. Auth con Google Identity Services
(token en memoria, no se persiste). Lectura y escritura.

Config en `localStorage` bajo `peanut_matcher_cfg`: `clientId`, `sheetId`,
`sheetName`, `calcSheetId`, `oppPct`, `oppUsd`. Se puede precargar con el link
`#cfg=` de Configuración (ver 4.38.0).

### Hojas

| Hoja | Objeto | Contenido |
|---|---|---|
| Database (`cfg.sheetName`) | `COL` / `allRows` | Empresas. Estado del cliente en col. AN |
| Follow up | `FU` / `fuRows` | Demandas. **Una fila por calibre** |
| Availability | `AV` / `availRows` | Ofertas de proveedores |
| Descartes | — / `descRows` | Oportunidades descartadas (se crea sola) |
| Agenda | `AGEV` / `agendaEvRows` | Calendario del equipo (se crea sola, A:H) |
| Database suppliers | — / `supRows` | Suppliers. Columnas libres: se usan los encabezados que tenga |
| Precios FOB / Fletes / Adicionales | — | Calculadora (puede ser otro Sheet) |

---

## Blindaje por encabezado — el patrón central

Las columnas **no** están fijadas por posición. Cada hoja tiene un spec que
mapea campo lógico → nombres de encabezado aceptados, y se resuelve el índice
real en cada carga.

```js
var AV_SPEC={PROV:['proveedor','supplier'],ORIGEN:['origen','origin'],
  PROD:['producto','product','calibre'], /* ... */
  PRICE:['price','precio','precio usd','usd','precio oferta']};
```

`normHdr()` normaliza, `mapHeaders()` / `resolveCol()` resuelven,
`refreshHeaderRow()` relee antes de escribir.

**Si agregás una columna, hacelo por spec, nunca por número fijo.**

### Índices estrictos (sin fallback)

`FU.CROP` y `AV.PRICE` son columnas agregadas después. Si el encabezado no
está, el índice queda en `-1` y el campo se **deshabilita con aviso**, en vez
de heredar una posición vieja y escribir en la columna equivocada.

```js
function applyAvPriceStrict(headerRow){
  var norm=(headerRow||[]).map(normHdr),idx=-1;
  for(var a=0;a<AV_SPEC.PRICE.length;a++){
    var p=norm.indexOf(normHdr(AV_SPEC.PRICE[a]));
    if(p>=0){idx=p;break;}
  }
  AV.PRICE=idx;
}
```

Hay que llamarlo en **todos** los puntos donde se mapea la hoja (carga y
`refreshHeaderRow` antes de guardar). Si agregás uno nuevo, no te lo olvides.

Síntoma típico de "el campo no anda": falta la columna en el Sheet.

---

## Trampas que ya mordieron

Están así por una razón. No las "simplifiques".

### `esc()` no escapa comillas

```js
function esc(s){return ((s==null?'':s)+'').trim().replace(/</g,'&lt;');}
function attrEsc(s){return ((s==null?'':s)+'').replace(/&/g,'&amp;')
  .replace(/</g,'&lt;').replace(/"/g,'&quot;');}
```

Contenido → `esc()`. **Dentro de un atributo HTML → `attrEsc()`**, o un
proveedor llamado `Peanut "Gold" SA` rompe el atributo y el botón deja de
funcionar. `crosscheck.py` detecta el caso `data-x="'+esc(`.

### Caché de estado del cliente: invalidación manual

```js
var _cliStCache=null,_cliStMemo=null;
function invalidateCliSt(){_cliStCache=null;_cliStMemo=null;}
function buildCliStIndex(){
  // Object.create(null): un cliente llamado "Constructor" o "ToString" no debe
  // matchear contra Object.prototype.
  var m=Object.create(null);
  /* ... */
}
```

Dos cosas:

- **`Object.create(null)`**: con un objeto normal, `'constructor' in mapa` da
  `true` por herencia y devuelve una función en vez de un estado.
- **Invalidar a mano** en los 4 puntos que tocan `allRows` (carga, alta,
  edición in-place, logout). Mirar `allRows.length` **no alcanza**: editar el
  Estado de una empresa existente no cambia la cantidad de filas.

### Precios: siempre por `priceNum()`

El Sheet devuelve strings con separadores locales. `parseFloat('1.780')` da
`1.78`, no `1780`.

```js
priceNum('1.780,50') // 1780.5
priceNum('1,780.50') // 1780.5
priceNum('USD 1780') // 1780
priceNum('a consultar') // null
```

`fmtPrice()` formatea para mostrar y, si no hay número pero sí texto
(`"a consultar"`), **devuelve el texto** en vez de comérselo.

### `persistCfg()` vs `saveConfig()`

Para guardar un valor suelto en `cfg` usar `persistCfg()`. `saveConfig()` es la
de la pantalla de Configuración: además reinicia el auth y salta de vista.

### No reusar la clase `.empty` para modificadores

`.empty` es el **estado vacío** ("Sin ofertas") con `padding:60px 24px`. Cualquier
elemento con esa clase hereda ese padding. El modificador "sin precio" se llamaba
`empty` (`cprice empty`) y por eso cada fila se estiraba ~150px. Los modificadores
de precio vacío usan `.np`, no `.empty`. Mismo cuidado con cualquier clase corta y
genérica: fijarse que no exista ya como componente.

---

## Secciones

`matcher · empresas · ofertas · demandas · oport · agenda · calc · config`

Cada una: `renderX()` pinta el chrome en `#content`, `renderXList()` pinta la
lista. Alta en `showView()`, en el dispatch de sincronización, en el nav y en
el tabbar (móvil).

### 📋 Demandas

Filas agrupadas en pedidos por `demGroupKey()` (cliente+fecha+puerto+país+
incoterm), porque un pedido de 3 calibres son 3 filas.

Abre en **vista compacta**. Acciones por fila: 📄 pedido, ✏️ editar,
🗑 eliminar. El punto de color abre el semáforo.

**Orden de dos niveles**: los pedidos **sin semáforo van siempre al fondo**,
sin importar la fecha; recién dentro de cada bloque manda la fecha.
"Inactivo" **es** un estado y no va al fondo.

Demanda nueva arranca en **"En conversación"** (`fuSemaforo='En conversación'`, por valor — el orden de SEMAFORO cambió en 4.25.0),
justamente para que no caiga al fondo apenas la cargás.

Filtro por **estado del cliente**: cruza Follow up → Database con
`statusOfCustomer()` (exacto → substring → Levenshtein ≥ 0.7, mismo criterio
que `findFU`). Hoy no se puede cargar una demanda de un cliente que no esté en
Database; los huérfanos son legado y caen en "Sin estado" a propósito.

### Generar pedido de texto

```
Cliente / Destino / Calibre (uno por línea) / Crop / Incoterm /
Precio / Shipment / Packaging / Pallet

Comentarios extras:
- <texto libre del shipment>
- <nota del pedido>
```

`fmtShipmentRange()` imprime el shipment en **MM/AA agrupando consecutivos**:
`Diciembre 2026, Enero 2027, Febrero 2027` → `12/26 - 02/27`. Ordena y
deduplica solo. **`Prompt` y cualquier texto que no pueda parsear pasan tal
cual** — nunca descarta información que no entiende.

### 💡 Oportunidades

Cruza **pedidos concretos contra ofertas concretas** por precio.

**No confundir con el Matcher.** El Matcher cruza una oferta contra el perfil
histórico de Database ("qué empresas compran este calibre"). Esto cruza Follow
up contra Availability y lo que manda es la plata.

Un cruce entra si: ambos tienen precio, el calibre se pisa (`sizeMatch`, por
solapamiento de rangos numéricos), el tipo es compatible (`typeMatch`; sin tipo
cargado no filtra), la oferta no está "No disponible", y la brecha no supera la
tolerancia.

```js
var gap=op-dp;                                 // >0: piden más de lo que paga
var limit=Math.max(tol.usd,dp*tol.pct/100);    // gana la más amplia
if(gap>limit)return;
```

Default 3% y 50 USD, editables desde el panel. Si la oferta es **más barata**
se marca "conviene" en verde y va primero.

**Descartes** en la pestaña `Descartes` del Sheet, para que los vea el equipo.
Se crea sola al primer descarte (`ensureDescTab`). La clave (`oppKey`) incluye
los dos precios **a propósito**: si alguno cambia, el descarte deja de aplicar
y la oportunidad vuelve. Un "no" a 1800 no es un "no" a 1750.

### 🧮 Calculadora

Lee de `cfg.calcSheetId` (o el principal): Precios FOB, Fletes, Adicionales.
FOB base → adicionales pre-flete → FOB ajustado → flete → adicionales
post-flete → total. La **etapa** de cada adicional define de qué lado del flete
entra. `CALC_STALE_DAYS=30` avisa si el flete está viejo. Las tablas se editan
desde la app.

---

## Convenciones

- `esc()` en contenido, `attrEsc()` en atributos.
- Deshacer al borrar (`showUndo()` con snapshot).
- `toast()` para feedback, `prog()` para la barra.
- Tras escribir en el Sheet, actualizar la caché en memoria en vez de recargar.
- Colores por variable CSS (`--bg`, `--text`, `--accent`, `--ok`, `--warn`,
  `--danger`, y sus `-light`). Tres temas: claro, sepia, oscuro.

---

## Checklist

- [ ] `./tools/check.sh` en verde
- [ ] `./tools/bump.sh <version>`
- [ ] Probado en tema claro **y** oscuro
- [ ] Probado en pantalla angosta (el flex de las filas compactas hace wrap)
- [ ] ZIP → Netlify → refrescar → confirmar la pastilla

---

## Historial

- **4.38.0** — Link de configuración para el equipo (Configuración → 🔗 Link para el equipo).
  - `cfgShareLink()` arma `origen+ruta#cfg=<base64url(JSON)>` con `CFG_SHARE_KEYS`
    (clientId, sheetId, sheetName, calcSheetId, oppPct, oppUsd). Va en el **hash**:
    el navegador no lo manda a ningún servidor. No lleva tokens ni contraseñas (el
    token de Google no se persiste nunca; cada uno se conecta con su cuenta).
  - Al cargar la app, un IIFE justo después de armar `cfg` lee `#cfg=`, aplica esas
    claves, guarda en localStorage, borra el hash (`history.replaceState`) y avisa
    con un toast (`cfgDesdeLink`). Corre antes de `initGoogleAuth`.
  - El link usa `location.origin`: hay que copiarlo desde la URL donde lo van a
    usar (GitHub Pages), no desde otra.
  - `crosscheck.py` marca como handler roto cualquier `onclick="this.metodo()"`
    (lo lee como una función global que no existe). Usar una función propia.
- **4.37.0** — Agenda: calendario mensual, Seguimientos con eventos, borrar eventos.
  - Calendario del equipo es una grilla mensual lun→dom estilo Google Calendar
    (`renderAgendaEventos`): ‹ › cambia de mes (`agendaMesMove`), "Hoy"
    (`agendaMesHoy`). Cada celda muestra hasta 3 eventos + "+N más"; en celular
    (<768px) solo puntitos de color. Tocar un día (`agendaSelDia`) lista abajo sus
    eventos con ✏️ y 🗑 (`agendaEvFila`). Los eventos se agrupan una vez por
    render (`agendaEvPorDia`). Color fijo por persona (`persColor`, variables).
  - Pestañas: Calendario a la izquierda y por defecto (`agendaSub='eventos'`),
    Seguimientos a la derecha.
  - Seguimientos = fechas de Database + eventos de la Agenda (`agendaEvCard`).
    Del calendario entran hoy en adelante y, de los pasados, solo los que tienen 🔔
    de los últimos 7 días. El filtro por persona también aplica acá.
  - `deleteAgendaEv(idx)` acepta el índice (🗑 desde listas) además del modal.
  - Fix: `getTabGid` cacheaba `null` si la pestaña todavía no existía (Agenda,
    Descartes se crean solas) y el borrado fallaba con "No pude ubicar la hoja"
    hasta recargar. Ahora solo cachea cuando la encuentra.
- **4.36.0** — Suppliers: diagnóstico cuando no cargan + rango con comillas.
  - `loadSuppliers` deja en `supDiag` qué pasó (no pudo abrir el archivo / no
    encontró la pestaña, listando las que ve / encontró la pestaña pero no la pudo
    leer, con el HTTP). `renderSuppliers` lo muestra en un cartel con
    "↻ Reintentar" (`reloadSuppliers`, recarga solo suppliers). El título muestra
    cuántas filas leyó.
  - El rango va con el nombre de la pestaña entre comillas (`supA1()` →
    `'Database suppliers'!A1:AZ3000`), en la lectura, el alta y la edición. El
    borrado usa el `sheetId` que ya vino en la carga (`supGid`).
  - `supSheetId()` = `cfg.sheetId`: "Database suppliers" vive en el mismo archivo
    que la Database (confirmado por el usuario).
- **4.35.0** — Disponibilidades muestran el grado (Split A/B/C) al lado del calibre.
  - `mapHeaders` pide el encabezado exacto; si en Availability la columna no se llamaba
    justo "Grado"/"Grade" quedaba la posición por defecto y la ficha no mostraba el
    grado. `applyAvGradoLoose` (en los 3 puntos donde se mapea AV) busca también por
    cómo empieza el encabezado: grado*, grade*, calidad*, quality*.
  - `ofProdGrado(r)`: "Split" + "A" → **Split A**; si el grado ya dice "Split B", usa
    eso; si el producto es un calibre (38/42) el grado va en una pastilla "Grado A".
    Se usa en la ficha (`ofItemHtml`, sale de la línea gris de meta) y en la compacta
    (`ofCompactRow`, que antes no mostraba el grado).
- **4.34.0** — Empresas con pestañas Clientes / Suppliers + eliminar empresas.
  - `empSub` ('cli' | 'sup'), `setEmpSub`, `empSubTabsHtml`. `renderEmpresas`
    despacha a `renderSuppliers` si está en Suppliers.
  - **Hoja de suppliers**: `loadSuppliers` busca la pestaña llamada
    "Database suppliers" (o, si no, la primera cuyo nombre tenga supplier/proveedor
    y no sea Availability) → `supTab`. **No hay columnas fijas**: `supHeaders` =
    fila 1 y el formulario (`openSupModal`) se arma con esos encabezados, igual que
    la edición de la calculadora. La columna nombre se detecta con `SUP_NAME_HDR`
    (si no reconoce ninguna, usa la 1ra). Se carga en cada sincronización.
  - Lista de suppliers con búsqueda, ✏️ editar (PUT de la fila), + Agregar
    (append), duplicados bloqueados por `normHdr`. Abajo "Solo en Availability":
    proveedores de Availability que no están en la Database, con ➕ Pasar a
    Database (abre el alta con el nombre ya puesto).
  - `provNamesList` ahora suma los de la Database suppliers (Agenda y chips).
  - **Eliminar** (clientes: botón en el modal de edición → `deleteDbCompany`;
    suppliers: en su modal → `deleteSupplier`). `confirmarBorrado`: dos `confirm`
    + `prompt` donde hay que escribir "confirmar" (sin importar mayúsculas).
    Borra la fila con `deleteDimension`. En clientes se saca del caché, se corre
    `_sheetRow` de las filas de abajo y se llama `invalidateCliSt`.
  - Fix: `var(--bg1)` no existe (es `--bg`); lo usaban las tarjetas de eventos
    de la Agenda (4.28) y quedaban sin fondo.
- **4.33.0** — Agenda: la empresa tiene que ser real. Si elegiste Cliente o
  Proveedor, `saveAgendaEv` no guarda hasta que el nombre coincida con uno de la
  lista de ese tipo. `agevEmpresaReal` compara con `normHdr` (sin mayúsculas ni
  tildes) contra `agevIdx` y devuelve el nombre **tal cual figura en la planilla**,
  que es lo que se guarda. Campo vacío con tipo elegido tampoco guarda (hay que
  elegir o desmarcar el tipo). Aviso en vivo debajo del campo (`checkAgevEmpresa`,
  `#agev-emp-hint`: ✓ nombre / ✗ no existe). Cambiar de tipo limpia el campo.
  Un evento viejo con una empresa que ya no existe abre con ✗ y hay que corregirla
  para volver a guardarlo.
- **4.32.0** — Agenda: fecha con calendario, hora con reloj y empresa opcional.
  - `agev-fecha` es `<input type="date">` y `agev-hora` es `<input type="time">`
    (los dos también se pueden tipear). El date trabaja en AAAA-MM-DD:
    `dmyToIso`/`isoToDmy` convierten y en la planilla siempre queda DD/MM/YYYY.
    `normHora` pasa horas viejas ("15hs", "9.30") a HH:MM para el reloj.
  - La vista semanal compara con `parseDMY`+`fmtDMY`, así que un evento viejo
    escrito "25/9/2026" igual cae en su día.
  - Empresa opcional: primero chip 👤 Cliente / 📦 Proveedor (`setAgevTipo`,
    `agevTipo`), recién ahí se habilita un input con `<datalist>` (se puede elegir
    o escribir). La lista se arma una vez por cambio de tipo (`agevEmpresas`):
    clientes de Database (`COL.COMPANY`, si no `COL.CLIENT`), proveedores de
    Availability (`provNamesList`). Tocar el mismo chip otra vez lo desmarca.
  - Hoja Agenda pasa de 6 a 8 columnas: + `Tipo empresa`, `Empresa` (A:H). Si la
    hoja es vieja (6 encabezados), al guardar se reescribe la fila 1 con los 8
    (`agendaEvHdrOk`). La tarjeta del evento muestra la empresa.
  - Fix: no existía una clase `.hidden` global (solo `.modal-overlay.hidden` y
    `.ac-list.hidden`). Por eso el botón Eliminar salía en eventos nuevos y el
    input "Nuevo valor" de la calculadora (4.27) se veía siempre. Agregada
    `.hidden{display:none !important;}`.
- **4.31.0** — Aviso de "precio dudoso": celda de precio con más de un número
  (varios calibres con su precio, o un rango tipo `1780-1800`). `priceNum` usa solo
  el primero, así que ahora se avisa:
  - `priceAmbiguo(v)`: saca calibres (mismo patrón que `priceNum`) y da `true` si
    quedan 2+ números. `precioWarn(v)` devuelve el ⚠ con tooltip.
  - ⚠ al lado del precio en Demandas (compacta y ficha) y en Disponibilidades
    (compacta y ficha), y un banner arriba de la lista de Demandas con la cantidad.
  - Oportunidades: `computeOpps` agrega `dudoso`; banner arriba con la cantidad y,
    en cada tarjeta afectada, una línea con lo que dice la celda.
  - Al abrir ✏️ un pedido con precio dudoso sale un `alert` que lista los calibres.
  - Los formularios de la app ya son numéricos: esto entra solo si se escribe
    directo en la planilla.
  - El patrón de calibre va inline en `priceNum` y `priceAmbiguo` (no en una var
    global) porque los tests cargan las funciones sueltas.
- **4.30.0** — `priceNum`: el filtro de calibres era de 2 dígitos (`\d{2}/\d{2}`) y no
  sacaba `80/100` ni `100/120` (con `"80/100: 1820"` leía 80). Ahora es
  `\d{2,3}\s*[/-]\s*\d{2,3}`: 2 o 3 dígitos de cada lado, con barra o guion.
  Los precios tienen 4 dígitos, así que `1780/1800` o `1820 / 50/60` no se confunden.
- **4.29.0** — Fix precios millonarios en Oportunidades + Agenda detecta al usuario por mail.
  - `priceNum` ahora saca los calibres tipo `40/50` antes de leer el número y toma el
    primer número que queda. Antes `"40/50: 1.820"` se leía 40.501.820 (se pegaban
    los dígitos del calibre) y eso inflaba Oportunidades. Tests agregados en precios.js.
  - Scope nuevo `userinfo.email`: al conectar Google se lee el mail (`loadUserEmail`,
    `userEmail`). `personaDeEmail` mapea adol*→Adol, manu*→Manu, feli*→Feli; si no,
    usa la parte antes del @. `yoPersona()` se usa como persona por defecto en la
    Agenda y como "Usuario" en Descartes. Cada uno tiene que volver a conectar Google
    una vez (pide el permiso nuevo de mail).
- **4.28.0** — Calendario del equipo dentro de Agenda (ítem 4). Nuevo sub-tab
  "🗓 Calendario del equipo" al lado de "📋 Seguimientos" (`agendaSub`,
  `setAgendaSub`, `agendaSubTabsHtml`). Datos en una hoja nueva **"Agenda"**
  (se crea sola al guardar el primer evento, como Descartes): columnas Fecha,
  Hora, Persona, Título, Notas, Recordatorio (`AGEV_TAB`, `AGEV_HDR`, `AGEV`,
  `loadAgendaEv`, `ensureAgendaEvTab`, `saveAgendaEv`, `deleteAgendaEv`).
  - Vista semanal (próximos 7 días) con un "+" por día para cargar evento.
  - Persona por defecto al abrir el modal: `cfg.userName` (la config existente
    de "Descartes"); lista de personas = Adol/Feli/Manu + cualquier otro
    nombre ya usado (`agendaPersonasList`).
  - Filtro por persona (chips "Todos"/cada nombre) para ver el calendario de
    uno o de todos juntos.
  - Recordatorio es un checkbox (Sí/No en la planilla) que agrega 🔔 al
    evento; no dispara notificaciones push, es solo visual por ahora.
- **4.27.0** — Calculadora/Fletes: histórico + fecha automática + desplegables.
  - `saveCalcRow` ya NO pisa la fila al "editar": siempre hace `calcAppendRow`
    (fila nueva al final), y completa la columna Fecha con hoy (`fmtDMY`)
    automáticamente — la fila vieja queda de histórico en la planilla.
  - `fobRowFor`/`fleteRowFor`/`adicGroups` ahora recorren de atrás para
    adelante (o reemplazan por la última coincidencia), así la fila más nueva
    es la que gana en el cálculo, no la más vieja.
  - Agregado `FECHA` a `ADI_SPEC` (Adicionales no la tenía).
  - En el modal "Editar tablas de precios" (`openCalcRow`), todos los campos
    pasan a ser desplegables con los valores ya cargados en esa columna
    (+ opción "Nuevo valor..." con texto libre), **excepto** la columna de
    precio de cada tabla (FOB.PRECIO / FLE.VALOR / ADI.VALOR) que sigue
    siendo texto libre, y la columna Fecha que ya no se muestra (es automática).
- **4.26.0** — Chips de proveedores ofrecidos en Demandas/Ofertas a clientes.
  Nueva columna agregada en Follow up ("Proveedores ofrecidos"), formato
  compacto `Nombre:estado||Nombre2:estado2` (`FU.CHIPS`, `applyFuChipsStrict`,
  `parseChips`/`serializeChips`). Desde la ficha (👥 + Gestionar proveedores) se
  agrega un proveedor (autocompleta con los de Availability) y cada chip tiene
  3 estados clickeables: Pendiente (amarillo) / Rechazado (rojo) / Cerrado
  (verde). Se guarda en todas las filas del pedido (mismo patrón que la nota).
  La vista compacta muestra un contador 👥N si el pedido tiene chips cargados.
  Como CROP/CLASE: sin la columna en la hoja, queda deshabilitado (avisa).
- **4.25.0** — Dos fixes/features en Demandas:
  1. **Bug de toneladas millonarias**: `groupOf`/lista de Demandas agrupaban
     pedidos solo por `cliente+fecha+puerto+país+incoterm`; con esos campos
     vacíos (carga rápida), pedidos DISTINTOS del mismo cliente colisionaban en
     la misma clave y se mezclaban — de ahí toneladas infladas en la vista
     compacta/Oportunidades y ficha vacía (mostraba la primera fila del grupo
     mezclado). Fix: solo se agrupan filas **contiguas** en la hoja con la
     misma clave (los calibres de un pedido se cargan uno debajo del otro), y
     una fila sin cliente nunca se mezcla con otras.
  2. **Nuevo estado "Consulta de precios"**: agregado a `SEMAFORO`, ubicado
     entre Inactivo y En conversación. `semaforoOf` ahora busca por valor
     (`semByVal`) en vez de por índice fijo, para poder reordenar el array sin
     romper nada.
- **4.24.0** — Texto del pedido (`generarPedido`) refleja el **precio que ya nos
  pasó el cliente** (columna Price de Follow up) en vez de decir siempre "A cotizar".
  Sin precio → "Precio: A cotizar"; un solo precio → "Precio: X USD/Tn"; precios
  distintos por calibre → cada línea Calibre muestra `@ X USD/Tn` y el resumen dice
  "según calibre (ver detalle arriba)".
- **4.23.0** — Botón ⇄ en cada pedido (compacta y ficha) para **mover** entre
  Demandas y Ofertas a clientes (`moverClase`): cambia la columna Clase en todas
  las filas del pedido vía `updateFuCell`, actualiza caché y re-renderiza.
  Reversible. Pide la columna Clase; confirma antes de mover.
- **4.22.0** — Nueva sección **Ofertas a clientes** (lo que ofrecemos nosotros),
  separada de Demandas (pedidos del cliente). NO es hoja nueva: una columna
  **Clase** (Demanda / Oferta a cliente) en Follow up, resuelta estricta
  (`applyFuClaseStrict`, `claseDe`, `activeClase`). Reusa TODO el motor de
  Demandas (form, semáforo, embarque, filtros); `renderDemandas`/`List`/filtros
  y la sección se dispatchan con `view==='ofcli'`. Sin la columna, todo cae en
  "demanda". Oportunidades cruza ambas clases (ya usaba `fuRows`) y marca las que
  vienen de una Oferta a cliente.
- **4.21.0** — La sección "Ofertas" pasa a llamarse **Disponibilidades** (labels
  visibles; la key interna sigue siendo `ofertas`/AV/availRows). **Fix**: `sumTn`
  usaba `parseFloat` ingenuo y leía "3.000" (miles) como 3; ahora pasa por
  `priceNum`.
- **4.20.0** — Compacta estilo lista (Ofertas y Demandas): cada exportador es un
  bloque con borde + banda accent y renglones finos separados por hairline
  (`.ofcgroup`, `.clist-boxed`), filas ~31px. **Fix**: el `s/precio` usaba la
  clase `empty`, que choca con `.empty{padding:60px 24px}` del estado vacío y
  estiraba cada fila a ~150px; renombrado a `.np` (ver Trampas).
- **4.19.0** — Exportador (proveedor) más notorio en Ofertas: banda con fondo
  accent, borde y label "Exportador" arriba de cada ficha (`ofg-head`), y header
  del grupo compacto con banda accent y borde izquierdo.
- **4.18.0** — Vista compacta más densa (menos padding/fuente, `.crow`) en Ofertas
  y Demandas. Sub-fila de Ofertas al set "Media" (calibre · tipo · tns · precio ·
  origen); estado + fecha quedan en el `title` (tooltip) en vez de ocupar columna.
- **4.17.0** — Ofertas: la vista **compacta** también agrupa por proveedor
  (`ofCompactGroup`): header del proveedor + sub-filas por disponibilidad
  (calibre · tipo · tns · precio · origen · estado · fecha).
- **4.16.0** — Ofertas: ficha agrupada **por proveedor** (`ofGroupKey`/`ofGroupCard`/
  `ofItemHtml`), una disponibilidad por ítem con calibre/tipo/precio/estado;
  comentario por disponibilidad (reusa AV.OBS, modal `ofnota`); "sin precio"
  minimalista; filtros por calibre y tipo. Demandas: type completo al lado del
  calibre en compacta, badge/chip **Birdfood** (`isBirdfood`), filtros por tipo y
  por **país de la empresa** (`countryOfCustomer`, cruza Database con matcheo
  tolerante como el estado).
- **4.15.0** — Embarque en el pedido y la ficha con mes en 3 letras español
  (`DIC 26 - FEB 27`) en vez de MM/AA. En Demandas, el incoterm muestra el puerto
  cuando es CFR/CIF (`incoWithPort`) y el campo Destino pasa a mostrar solo el país.
- **4.14.0** — Contador de oportunidades vivas en el nav y el tabbar (verde si
  alguna conviene), para que el panel se anuncie solo. Precio por calibre más
  explícito al cargar la demanda. Precio de la fila compacta de Demandas movido
  a la derecha, minimalista (sin fondo). Pastillas/columnas de precio más
  grandes en fichas de Demandas y Availability.
- **4.13.0** — Columna Price en Availability. Precio más visible. Panel
  Oportunidades con descartes compartidos.
- **4.12.0** — Sin estado al fondo del orden; vista compacta por defecto;
  eliminar desde la compacta; demanda nueva en "En conversación".
- **4.11.0** — Shipment MM/AA; comentarios extras como apartado; 📄 en compacta.
- **4.10.0** — Filtro por estado del cliente en Demandas.
- **4.9.0** — Calculadora de cotizaciones.
- **4.4.0** — Blindaje por encabezado, multi-calibre, semáforo, deshacer, gate.
