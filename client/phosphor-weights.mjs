/**
 * Plugin de Vite: cada icono de Phosphor trae sus 6 pesos (thin, light, regular, bold, fill, duotone)
 * en el mismo módulo, así que el tree-shaking no puede quitar los que no usamos.
 * En el build se reescriben los módulos `defs/*` y los pesos no usados apuntan al trazo `regular`
 * (nunca quedan vacíos). Pesos conservados: los de KEEP (ver client/src/DESIGN.md).
 */
const DEFS = /@phosphor-icons[\\/]react[\\/]dist[\\/]defs[\\/][^\\/]+\.(es\.)?m?js$/
const KEEP = new Set(['regular', 'fill', 'duotone'])

export default function phosphorWeights() {
  return {
    name: 'phosphor-weights',
    apply: 'build',
    transform(code, id) {
      if (!DEFS.test(id.split('?')[0])) return null
      const marker = /\n {2}\[\n {4}"(\w+)",/g
      const starts = [...code.matchAll(marker)].map((m) => ({ index: m.index, weight: m[1] }))
      const end = code.indexOf('\n]);')
      if (starts.length < 2 || end < 0 || !starts.some((s) => s.weight === 'regular')) return null
      const head = code.slice(0, starts[0].index)
      const tail = code.slice(end)
      const kept = starts
        .map((s, i) => ({ ...s, text: code.slice(s.index, i + 1 < starts.length ? starts[i + 1].index : end).replace(/,\s*$/, '') }))
        .filter((s) => KEEP.has(s.weight))
      const dropped = starts.filter((s) => !KEEP.has(s.weight)).map((s) => s.weight)
      // La variable del Map es la que precede a "= /* @__PURE__ */ new Map(".
      const mapVar = /const (\w+) = \/\* @__PURE__ \*\/ new Map\(\[/.exec(head)?.[1]
      if (!mapVar) return null
      const alias = dropped.length
        ? `\n${dropped.map((w) => `${mapVar}.set(${JSON.stringify(w)}, ${mapVar}.get("regular"));`).join('\n')}`
        : ''
      const closeIdx = tail.indexOf(');') + 2
      return { code: head + kept.map((k) => k.text).join(',') + tail.slice(0, closeIdx) + alias + tail.slice(closeIdx), map: null }
    },
  }
}
