/** Agrupa las líneas de un bloque en párrafos y listas, respetando el orden. */
function segments(lines) {
  const out = []
  for (const l of lines) {
    if (l.startsWith('- ')) {
      const last = out[out.length - 1]
      if (last?.list) last.items.push(l.slice(2))
      else out.push({ list: true, items: [l.slice(2)] })
    } else {
      out.push({ list: false, text: l })
    }
  }
  return out
}

const isHeading = (l) => l.length <= 60 && !/[.:;,]$/.test(l) && !l.startsWith('- ')

/**
 * Muestra el texto de una política (texto plano): bloques separados por línea en blanco,
 * líneas con "- " como lista y la primera línea corta sin punto final como subtítulo.
 */
export default function PolicyText({ body = '', className = '' }) {
  const blocks = String(body).replace(/\r/g, '').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)
  return (
    <div className={`space-y-3 text-sm leading-relaxed text-slate-700 dark:text-white/75 ${className}`}>
      {blocks.map((block, i) => {
        const lines = block.split('\n').map((l) => l.trim()).filter(Boolean)
        const head = isHeading(lines[0]) ? lines[0] : null
        const rest = head ? lines.slice(1) : lines
        return (
          <section key={i}>
            {head && <h3 className="font-semibold text-slate-900 dark:text-white mb-1">{head}</h3>}
            {segments(rest).map((s, j) =>
              s.list ? (
                <ul key={j} className="list-disc pl-5 space-y-0.5 my-1">
                  {s.items.map((t, k) => (
                    <li key={k}>{t}</li>
                  ))}
                </ul>
              ) : (
                <p key={j}>{s.text}</p>
              ),
            )}
          </section>
        )
      })}
    </div>
  )
}
