# Tablas, filtros y selector de niños

Piezas para listas grandes (100–300 niños, ~20 por sala). Todo sin tildes ni mayúsculas al buscar.

| Archivo | Qué exporta |
|---|---|
| `SmartTable.jsx` | `SmartTable` (default), `RowMenu`, `FilterChips`, y re-exporta `DataToolbar`, `SearchInput`, `FilterMenu` |
| `DataToolbar.jsx` | `DataToolbar`, `SearchInput`, `FilterMenu`, `Popover`, `LoadMore` |
| `dataView.js` | `useDataView`, `normText`, `getByPath`, `readTableStore`, `writeTableStore` |
| `ChildPicker.jsx` | `ChildPicker` (default) |
| `childSearch.js` | `matchChild`, `childName`, `toPickerChild`, `highlightParts`, `formatDocumentId`, `compactDoc`, `documentIdError`, `isValidCedula` |

---

## 1. SmartTable (compatible con lo anterior)

Todo lo que ya existía sigue igual (`rows`, `columns`, `searchKeys`, `onRowClick`, `toolbar`, `maxHeight`…).
Nuevo:

| Prop | Uso |
|---|---|
| `filters` | Chips desplegables con contador (ver §3). |
| `searchFn(row, qNorm, qRaw)` | Búsqueda propia en vez de `searchKeys`. |
| `searchKeys` | Ahora acepta funciones `(row) => texto/array` además de rutas (`'child.name'`). Coinciden **todas** las palabras en cualquier campo. |
| `storageKey` | Recuerda tamaño de página, filtros y columnas ocultas (localStorage `sonrisas.table.<key>`). |
| `renderExpanded(row)` | Fila desplegable: chevron a la izquierda en desktop; en móvil va dentro de «Más detalles». |
| `expandOnRowClick` | Con `renderExpanded`, el clic en la fila la despliega (por defecto sí si no hay `onRowClick`). |
| `columnToggle` | Botón «Columnas» (sólo desktop). En la columna: `defaultHidden`, `alwaysVisible`. `primary` y columnas sin label nunca se ocultan. |
| `defaultSort` | `{ key, dir: 'asc' \| 'desc' }` (la columna necesita `sortValue`). |
| `itemLabel` | `['niño', 'niños']` → «Mostrando 1–25 de 240 niños». |
| `onFiltered(rows)` | Filas tras buscar/filtrar/ordenar (p. ej. exportar CSV de lo visible). Pásale una función estable (`useCallback`). |

Pie: «Mostrando 1–25 de 240» + «Por página 10/25/50/100» + páginas. Clic en botones/enlaces dentro de una fila ya no dispara `onRowClick`.

```jsx
<SmartTable
  rows={children}
  columns={columns}
  searchKeys={['fullName', 'documentId', 'code', 'classroomName']}
  searchPlaceholder="Buscar por nombre, cédula o matrícula…"
  filters={[
    { key: 'room', label: 'Sala', multiple: true, value: (c) => c.classroomName, emptyLabel: 'Sin sala' },
    { key: 'doc', label: 'Cédula', value: (c) => (c.documentId ? 'yes' : 'no'),
      options: [{ value: 'yes', label: 'Con cédula' }, { value: 'no', label: 'Sin cédula' }] },
  ]}
  storageKey="children"
  columnToggle
  itemLabel={['niño', 'niños']}
  renderExpanded={(c) => <ChildQuickInfo child={c} />}
/>
```

## 2. useDataView + DataToolbar (listas que no son tabla)

```jsx
import { DataToolbar, LoadMore } from '../components/DataToolbar'
import { useDataView } from '../components/dataView'

const view = useDataView({ rows, searchKeys, searchFn, filters, storageKey })
// view.filtered, view.search/setSearch, view.values/setFilter(key, v), view.clearFilters(), view.clearAll(),
// view.activeCount, view.total, view.filters (con options y counts resueltos)

<DataToolbar view={view} searchPlaceholder="Buscar niño o cédula…" actions={<Button>…</Button>} />
{view.filtered.slice(0, limit).map(...)}
<LoadMore shown={Math.min(limit, n)} total={n} step={30} label="niños"
          onMore={() => setLimit((l) => l + 30)} onAll={() => setLimit(n)} />
```
Para volver al principio al cambiar la búsqueda/filtros, compara una firma
`${view.search}|${JSON.stringify(view.values)}` durante el render (ver TasksPage / JustificationsPage).

`DataToolbar` props: `view`, `searchPlaceholder`, `actions`, `extra` (nodo junto a los chips), `showCount` (default true:
«12 de 240»), `bordered`, `className`.

## 3. Especificación de un filtro

```js
{
  key: 'room',                // único
  label: 'Sala',
  icon,                       // opcional (de icons.js)
  multiple: true,             // varias opciones (OR). Por defecto una sola, con «Todos».
  type: 'select' | 'dateRange',
  options: [{ value, label }] | [[value, label]] | (rows) => options,   // si falta: valores distintos de las filas
  value: (row) => valor | valor[],   // por defecto row[key]; con array basta que coincida uno
  match: (row, selected) => bool,    // lógica propia (selected = string | string[] | {from,to})
  optionLabel: (value) => texto,     // para opciones derivadas (ej. id → nombre)
  emptyLabel: 'Sin sala',            // añade una opción para filas sin valor
  defaultValue, allLabel: 'Todas', counts: false,
}
```
`dateRange`: `value(row)` devuelve `'YYYY-MM-DD'` o `[desde, hasta]` (se filtra por solapamiento).
Los contadores son facetados: cada uno tiene en cuenta la búsqueda y los demás filtros.
En móvil el menú se abre como hoja inferior; Escape cierra sólo el menú (no el modal).

## 4. ChildPicker (selector en modales)

```jsx
import ChildPicker from '../components/ChildPicker'

<ChildPicker
  items={kids}                         // [{ id, fullName|name|firstName+lastName, photoUrl, documentId, classroomName, code }]
  value={selectedIds}                  // multiple → array; single → id
  onChange={setSelectedIds}
  multiple                             // default true
  quickSelect={[{ label: 'Todos los presentes', ids: (list) => list.filter(isPresent).map((c) => c.id) }]}
  filters={[
    { key: 'present', label: 'Presentes', match: isPresent },
    { key: 'pending', label: 'Sin llegar', match: (c) => !isPresent(c) },
  ]}
  renderMeta={(c) => arrivalTime(c)}   // texto a la derecha (opcional)
  disabledIds={[]}
/>
```
- `compactThreshold` (12): con pocos niños dibuja la rejilla de avatares de 1 toque (las salas pequeñas no cambian).
  Pon `0` para usar siempre la lista con buscador (como en «Registrar aviso»).
- Lista: buscador (nombre/cédula/matrícula, resalta coincidencias), chips de filtro con contador, «Todos»/«Ninguno»
  (con búsqueda: «Marcar los N visibles»), seleccionados arriba como chips («3 seleccionados · Limpiar»), 30 en 30
  («Ver más» o al desplazar), teclado ↑ ↓ Inicio Fin Enter/Espacio, roles `listbox`/`option` + `aria-selected`.
- Otros props: `showAllNone`, `defaultFilter`, `placeholder`, `showDocument` (true), `showClassroom` (auto si hay
  varias salas), `pageSize` (30), `maxListHeight` (`'min(52vh, 420px)'`), `label`, `emptyMessage`.

## 5. Buscar niños por cédula en cualquier sitio

```js
import { matchChild, formatDocumentId } from '../components/childSearch'
list.filter((c) => matchChild(c, query))   // nombre (sin tildes, en cualquier orden), cédula (con o sin guion), matrícula
formatDocumentId('1710034065')             // '171003406-5'
```
Servidor: `GET /children?search=` busca lo mismo (nombre, apellido, nombre completo, matrícula, cédula; sin tildes).
Paginación opcional: `GET /children?page=1&pageSize=25[&search=&classroomId=&includeInactive=true]` →
`{ items, total, page, pageSize }` (sin `page` devuelve el array completo, como siempre).

## 6. Eliminar niño (contrato para la ficha)

- Recomendado primero: **Dar de baja** = `PATCH /children/:id { active: false }` (no borra nada).
- `GET /children/:id/delete-preview` (sólo admin) → `{ id, fullName, active, counts: { attendanceDays, meals,
  dailyLogs, reports, photos, consents, justifications, guardians } }`. Muéstralo en el aviso.
- Pedir que se escriba el nombre completo (comparar sin tildes/mayúsculas) y luego `DELETE /children/:id` →
  `{ ok: true, removedFiles }`. Borra en cascada todo el historial del niño, sus fotos etiquetadas y los archivos que
  ya nadie usa. Las cuentas de los representantes se conservan. Queda en auditoría.
