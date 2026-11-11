# Sonrisas — Sistema visual

Aspecto: SaaS sobrio y profesional (tipo Linear / Stripe / Notion) adaptado a un centro infantil.
Superficies neutras (blanco / slate), **un solo color de acento**, colores semánticos sólo para estados.
Nada de degradados, emojis ni formas "infladas".

## Tokens (client/src/index.css)

| Variable CSS | Utilidad Tailwind | Uso |
|---|---|---|
| `--accent` | `bg-accent`, `text-accent`, `border-accent`, `ring-accent` | Botón primario, elemento activo, enlaces de acción |
| `--accent-hover` | `bg-accent-hover` | Hover del primario |
| `--accent-fg` | `text-accent-fg` | Texto sobre `bg-accent` (blanco) |
| `--accent-soft` | `bg-accent-soft` | Fondo de ítem activo / chip de acento / selección |
| `--accent-soft-strong` | `bg-accent-soft-strong` | Hover sobre `accent-soft` |
| `--accent-text` | `text-accent-text` | Texto de acento sobre blanco o `accent-soft` (más legible que `text-accent`; en oscuro se aclara) |
| `--accent-ring` | `ring-accent-ring` | Anillos de foco (`focus-visible:ring-2 focus-visible:ring-accent-ring`) |
| `--bg-app` | `bg-app` | Fondo de página (slate-50 / casi negro) |
| `--bg-surface` | `bg-surface` | Tarjetas en oscuro (`bg-white dark:bg-surface`) |
| `--bg-elevated` | `bg-elevated` | Modales, menús, popovers, barras fijas en oscuro |

- Acento por defecto: azul `#2563eb`. Si dirección eligió otro color en **Marca y logo** (distinto del
  default del servidor `#4f46e5`) y el blanco encima tiene contraste ≥ 4.5:1, `BrandingContext` lo pone
  en `--accent`. Por eso **nunca** escribas `blue-600`/`indigo-600` para "el color de la marca": usa `accent`.
- Las variantes (`hover`, `soft`, `text`, `ring`) se derivan con `color-mix`, así que funcionan con cualquier color.
- Opacidades funcionan: `bg-accent/10`, `ring-accent/20`.

### Neutros
- Página: `bg-app` (lo pone el layout). Tarjeta: `bg-white dark:bg-surface border border-slate-200 dark:border-white/8 rounded-xl shadow-xs`.
- Texto: títulos `text-slate-900 dark:text-white`; cuerpo `text-slate-600 dark:text-white/65`; secundario `text-slate-500 dark:text-white/45`.
- Bordes: `border-slate-200` / `dark:border-white/8–10`. Divisores `divide-slate-100 dark:divide-white/5`.
- Hover de fila / ítem: `hover:bg-slate-50 dark:hover:bg-white/4`.

### Estados (semántica, tonos apagados: fondo suave + texto fuerte)
| Significado | Tono | Chip (`<Badge tone>`) | Texto suelto |
|---|---|---|---|
| Hecho / ok | `green` (emerald) | `bg-emerald-50 text-emerald-700` | `text-emerald-700 dark:text-emerald-300` |
| Parcial / aviso | `amber` | `bg-amber-50 text-amber-800` | `text-amber-700 dark:text-amber-300` |
| No hecho / error / peligro | `red` (alias heredado `rose`) | `bg-red-50 text-red-700` | `text-red-600 dark:text-red-400` |
| Pendiente / neutro | `slate` | `bg-slate-100 text-slate-700` | `text-slate-500` |
| Información | `sky` | `bg-sky-50 text-sky-700` | `text-sky-700 dark:text-sky-300` |
| Destacado / marca | `accent` (alias heredado `violet`) | `bg-accent-soft text-accent-text` | `text-accent-text` |

`TONES` (exportado de `ui.jsx`) tiene `chip`, `icon` y `bar` por tono para reutilizar en componentes propios.
`rose` ya NO es el color de la marca: significa error/no hecho (se ve rojo).

### Tipografía
- **Inter Variable** (autoalojada, `@fontsource-variable/inter`).
- Título de página `text-xl font-semibold tracking-tight`; título de tarjeta `text-sm font-semibold` o `text-base font-semibold`.
- Etiquetas de sección: `text-xs font-semibold uppercase tracking-wider text-slate-500` (usa `<SectionTitle>`).
- Pesos: `font-medium` / `font-semibold`. **No** `font-black`/`font-extrabold`; `font-bold` sólo en casos muy puntuales.
- Números: siempre `tabular-nums`.

### Formas
- Tarjetas y paneles `rounded-xl`; controles (botones, inputs, chips grandes) `rounded-lg`; chips pequeños `rounded-md`; avatares `rounded-full`.
- Bordes 1px; sombras mínimas (`shadow-xs` tarjetas/controles, `shadow-xl` sólo modales y menús flotantes).
- Sin glassmorphism: el único `backdrop-blur` permitido es el de la barra superior / barras fijas.

## Iconos

- Set: **Phosphor** (`@phosphor-icons/react`), peso `regular` por defecto (IconContext en `main.jsx`).
- Importa SIEMPRE desde `components/icons.js`:
  ```js
  import { Plus, CheckCircle2, Database } from '../components/icons'
  ```
  `icons.js` exporta los nombres que ya usa el código (p. ej. `CheckCircle2` → Phosphor `CheckCircle`,
  `Trash2` → `Trash`, `Loader2` → `CircleNotch`) y algunos nombres Phosphor tal cual. Si necesitas uno nuevo,
  **añádelo a icons.js** (busca en https://phosphoricons.com). No importes `lucide-react` (ya no existe).
- Tamaño con clases: `w-4 h-4` (botones, listas), `w-5 h-5` (navegación, cabeceras), `w-[18px] h-[18px]` (cabecera de página).
- Color: hereda `currentColor`. Iconos decorativos en gris (`text-slate-400`) o con el tono del estado.
- `weight="fill"` sólo para indicar selección (p. ej. estrella marcada); `weight="duotone"` sólo en estados vacíos grandes.
- Pesos disponibles en producción: **regular, fill, duotone**. El plugin `client/phosphor-weights.mjs` quita del
  bundle los demás (bold/light/thin se ven como regular) para que el chunk de iconos pese ~33 kB gzip en vez de ~72 kB.
- **Nunca icono solo para dar significado**: siempre icono + texto (o `aria-label` + texto visible en touch).

## Componentes (client/src/components)

- `ui.jsx`: `PageHeader`, `Card`, `SectionTitle`, `Button` (`primary | secondary | ghost | success | danger | warning`, tamaños `sm | md | lg`),
  `Badge` (`tone`: `slate | accent | green | amber | red | sky`), `Field`, `inputClass`, `EmptyState`, `StatTile`, `Avatar`,
  `Loading`, `Kbd`, `Skeleton`, `ProgressBar`, `SegmentedControl`, `StickyActionBar`, `TONES`.
- `Modal`, `ConfirmDialog` (`variant`: `info | success | warning | danger`), `SmartTable` (+ `RowMenu`, `FilterChips`), `DayFilters`.
- Botón primario = `<Button>` (acento sólido). Para un botón propio: `bg-accent text-accent-fg hover:bg-accent-hover rounded-lg`.
- Ítem seleccionado (opción, pestaña, fila): `bg-accent-soft text-accent-text border-accent/30` (o `ring-1 ring-accent/30`).
- Pestañas de página: subrayado (`border-b-2 border-accent text-slate-900`) o `SegmentedControl`.
- Checkbox / radio nativos: `accent-accent` (color del acento).
- Gráficos SVG (recharts): los atributos `fill`/`stroke` no resuelven `var()`; lee el acento con
  `getComputedStyle(document.documentElement).getPropertyValue('--accent')` (ver GeneralReportsPage).
- Estadísticas: `<StatTile>` (tarjeta blanca + icono pequeño coloreado), no fondos de color.
- Avatares: iniciales en gris neutro; las fotos no cambian.

## Gráficos (recharts)
Usa la paleta: serie principal `var(--accent)`; estados `#10b981` (hecho), `#f59e0b` (parcial), `#ef4444` (no / falta),
`#94a3b8` (neutro). Rejilla `#e2e8f0` (oscuro `rgba(255,255,255,0.08)`), ejes `#64748b`, sin degradados en barras/áreas.

## Hacer / No hacer

| Hacer | No hacer |
|---|---|
| `bg-accent` para la acción principal | Degradados (`bg-linear-*`, `from-*`, `to-*`, `bg-gradient-*`) |
| Icono + texto (Phosphor desde `icons.js`) | Emojis en la interfaz (😀 ✅ 👋 🍽️…) |
| Chips con `<Badge tone>` | Fondos pastel decorativos (`bg-amber-50` de página, manchas `blur-3xl`) |
| `rounded-xl` tarjetas, `rounded-lg` controles | `rounded-3xl`, `rounded-full` en botones grandes |
| `font-semibold` en títulos | `font-black`, mayúsculas con tracking enorme |
| Colores de estado sólo para estados | Rosa/ámbar/violeta "porque sí" |
| `focus-visible:ring-2 focus-visible:ring-accent-ring` | Quitar el foco visible |

Los textos de WhatsApp que se envían a las familias los genera el backend (pueden llevar emojis); no es parte de este sistema.
