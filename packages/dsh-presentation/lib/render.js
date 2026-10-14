/**
 * Deck renderer: structured page data -> Typst source.
 *
 * This module is the reason the presentation mode is deterministic. The model
 * supplies page data (a layout id plus slots); this module owns every byte of
 * Typst that reaches the compiler, emitting nothing but a data literal. No
 * model-authored layout code is ever emitted, so a deck rebuilt after an edit
 * keeps its untouched pages identical.
 *
 * @module @hxql/dsh-presentation/render
 */

/** Page layouts the template understands. */
export const LAYOUTS = [
  'cover',
  'section',
  'agenda',
  'bullets',
  'steps',
  'cards',
  'kpis',
  'timeline',
  'compare',
  'quote',
  'table',
  'code',
  'image-text',
  'columns',
]

/** Locales a deck may select; the keys of the template's `dsh-locales`. */
export const LOCALES = ['zh', 'zh-tw', 'en', 'ja', 'ko', 'de', 'fr', 'es', 'ru']

/** Validate and normalise a raw deck spec. */
export function normalizeDeckSpec(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('deck spec must be an object')
  }
  const slides = raw.slides
  if (!Array.isArray(slides) || slides.length === 0) {
    throw new TypeError('deck spec needs a non-empty `slides` array')
  }
  const locale = str(raw.locale) ?? 'zh'
  if (!LOCALES.includes(locale)) {
    throw new TypeError(`deck spec locale ${JSON.stringify(locale)} is not one of: ${LOCALES.join(', ')}`)
  }
  return {
    title: str(raw.title) ?? 'Untitled deck',
    subtitle: str(raw.subtitle),
    author: str(raw.author),
    institution: str(raw.institution),
    date: str(raw.date),
    theme: str(raw.theme) ?? 'metropolis',
    aspectRatio: str(raw.aspectRatio) ?? '16-9',
    fontStack: str(raw.fontStack) ?? 'sans',
    locale,
    slides: slides.map((slide, index) => normalizeSlide(slide, index)),
  }
}

function normalizeSlide(raw, index) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError(`slide ${index + 1} must be an object`)
  }
  const layout = str(raw.layout) ?? 'bullets'
  if (!LAYOUTS.includes(layout)) {
    throw new TypeError(
      `slide ${index + 1} uses unknown layout ${JSON.stringify(layout)}; valid layouts: ${LAYOUTS.join(', ')}`,
    )
  }
  return { ...raw, layout }
}

const str = (value) => (typeof value === 'string' && value.trim() !== '' ? value : undefined)

// --- Typst literal emission -----------------------------------------------

/** A Typst string literal with newlines preserved. */
function q(text) {
  return `"${String(text)
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\r', '')
    .replaceAll('\n', '\\n')}"`
}

/**
 * Turn model-authored inline text into a Typst content block.
 *
 * A Typst *string* renders literally: `text("a *b* c")` prints the asterisks,
 * which is why `**bold**` used to reach the page as `*bold*`. Markup is only
 * parsed inside a content block, so the emitted value is `[...]`.
 *
 * Everything inside that block is escaped, including `*` and `_`, so a model
 * cannot smuggle in Typst syntax. The two documented emphases become explicit
 * `strong[…]` / `emph[…]` calls, which is why their markers do not need to
 * survive escaping.
 *
 * The scan is one pass over the text, so a backslash introduced while escaping one
 * character can never be escaped again by a later step — the bug a sequence of
 * `replaceAll` passes invites.
 *
 * @param {unknown} text
 * @returns {string} A Typst content block, e.g. `[plain #strong[bold] plain]`.
 */
function contentOf(text) {
  const raw = String(text ?? '')
  // Everything Typst treats specially inside a content block.
  const SPECIAL = new Set([...'\\#$@~`[]<>_"\'*_'])
  const escapeRun = (run) => {
    let out = ''
    for (const ch of run) out += SPECIAL.has(ch) ? `\\${ch}` : ch
    return out
  }

  let out = ''
  let plain = ''
  let index = 0
  while (index < raw.length) {
    // `**` is bold, a lone `*` is italic — the longer marker is tested first so
    // the pair is never read as two italics.
    const marker = raw.startsWith('**', index) ? '**' : raw[index] === '*' ? '*' : undefined
    if (marker === undefined) {
      plain += raw[index]
      index += 1
      continue
    }

    const closing = raw.indexOf(marker, index + marker.length)
    if (closing === -1) {
      // No closing marker: the asterisk is literal text, not emphasis.
      plain += marker
      index += marker.length
      continue
    }

    out += escapeRun(plain)
    plain = ''
    // The `#` is required: inside a content block, `strong[...]` is the literal
    // text "strong[…]" — the hash is what makes it a call.
    out += `#${marker === '**' ? 'strong' : 'emph'}[${escapeRun(raw.slice(index + marker.length, closing))}]`
    index = closing + marker.length
  }
  out += escapeRun(plain)
  return `[${out}]`
}

/** Emit a Typst string from model text, or `none` for an absent value. */
function t(text) {
  if (text === undefined || text === null) return 'none'
  return contentOf(text)
}

/**
 * Wrap already-rendered Typst elements in an array literal.
 *
 * The trailing comma is load-bearing. Typst unwraps a parenthesised single
 * value — `((value: 1))` is that dictionary, not a one-element array — so a
 * one-item collection must be emitted as `((value: 1),)` or the template's
 * `for`/`.len()` sees the element instead of the collection.
 */
function arr(elements) {
  if (elements.length === 1) return `(${elements[0]},)`
  return `(${elements.join(', ')})`
}

/** Emit an array of plain strings. */
function tArr(values) {
  if (!Array.isArray(values)) return '()'
  return arr(values.map((value) => t(value)))
}

/** Emit an array of short body lines, accepting one multi-line string. */
function lines(value) {
  return tArr(toLines(value))
}

/** Accept either an array of lines or one multi-line string. */
function toLines(value) {
  if (Array.isArray(value)) return value.map((line) => String(line))
  if (typeof value === 'string') {
    return value
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
  }
  return []
}

/** Emit bullet/step items as `(text, detail)` dictionaries. */
function bulletItems(items) {
  if (!Array.isArray(items)) return '()'
  return arr(items.map((item) => {
    if (typeof item === 'string') return `(text: ${t(item)}, detail: none)`
    return `(text: ${t(item?.text ?? '')}, detail: ${t(item?.detail)})`
  }))
}

/** Emit card dictionaries, carrying the grid width on each card. */
function cardItems(items, perRow) {
  if (!Array.isArray(items)) return '()'
  const width = Number.isFinite(perRow) ? Number(perRow) : 2
  return arr(items.map((card) => {
    const c = typeof card === 'string' ? { title: card } : (card ?? {})
    return `(title: ${t(c.title)}, eyebrow: ${t(c.eyebrow)}, body: ${lines(c.lines ?? c.body)}, footer: ${t(c.footer)}, per-row: ${width})`
  }))
}

/** Emit KPI dictionaries. */
function kpiItems(items) {
  if (!Array.isArray(items)) return '()'
  return arr(items.map((item) => {
    const k = item ?? {}
    return `(value: ${t(k.value ?? '')}, label: ${t(k.label ?? '')}, note: ${t(k.note)})`
  }))
}

/** Emit timeline items. */
function timelineItems(items) {
  if (!Array.isArray(items)) return '()'
  return arr(items.map((item) => {
    const m = item ?? {}
    return `(label: ${t(m.label ?? '')}, detail: ${t(m.detail)})`
  }))
}

/** Emit table headers and rows. */
function tableParts(input) {
  const headers = Array.isArray(input?.headers) ? input.headers : []
  const rows = Array.isArray(input?.rows) ? input.rows : []
  return {
    headers: arr(headers.map((h) => t(h))),
    rows: arr(rows.map((row) => arr((Array.isArray(row) ? row : [row]).map((cell) => t(cell))))),
  }
}

/** Build the Typst data dictionary for one slide. */
function slideLiteral(slide) {
  const out = [`layout: ${q(slide.layout)}`]
  const push = (key, value) => {
    if (value !== undefined && value !== 'none') out.push(`${key}: ${value}`)
  }

  if (slide.layout !== 'cover') push('title', t(slide.title))
  push('lead', t(slide.lead))
  push('takeaway', t(slide.takeaway))
  push('note', t(slide.note))

  switch (slide.layout) {
    case 'agenda':
    case 'bullets':
    case 'steps':
      push('items', bulletItems(slide.items))
      break
    case 'cards':
      push('cards', cardItems(slide.cards, slide.perRow))
      break
    case 'kpis':
      push('items', kpiItems(slide.items))
      break
    case 'timeline':
      push('items', timelineItems(slide.items))
      break
    case 'compare':
      push('left', lines(slide.left))
      push('right', lines(slide.right))
      push('left-title', t(slide.leftTitle))
      push('right-title', t(slide.rightTitle))
      break
    case 'quote':
      push('quote', t(slide.quote))
      push('author', t(slide.author))
      break
    case 'table': {
      const { headers, rows } = tableParts(slide)
      push('headers', headers)
      push('rows', rows)
      break
    }
    case 'code':
      push('source', q(String(slide.source ?? '')))
      // A plain string, not a content block: this reaches `raw(…, lang: …)`, which
      // requires a string.
      push('language', q(slide.language ?? 'typ'))
      break
    case 'image-text':
      push('body', lines(slide.body))
      // A path, so also a string rather than content.
      push('image', slide.image === undefined ? undefined : q(String(slide.image)))
      push('caption', t(slide.caption))
      break
    case 'columns': {
      const columns = Array.isArray(slide.columns) ? slide.columns : []
      push('columns', arr(columns.map((column) => lines(column))))
      if (Array.isArray(slide.ratios) && slide.ratios.length > 0) {
        push('ratios', arr(slide.ratios.map((ratio) => (typeof ratio === 'string' ? ratio : `${Number(ratio)}fr`))))
      }
      break
    }
    default:
      break
  }
  return `(${out.join(', ')})`
}

/**
 * Render a normalized deck spec into a complete, compilable `.typ` document.
 *
 * @param {object} spec   A spec already passed through {@link normalizeDeckSpec}.
 * @param {object} [options]
 * @param {boolean} [options.handout] Emit the handout form: Touying collapses
 *   each logical slide's subslides onto one frame, so a deck written with
 *   `#pause` prints once per slide instead of once per step. Without this the
 *   "handout" export would be byte-identical to the presentation export.
 * @returns {string} Typst source.
 */
export function renderDeckSource(spec, options = {}) {
  const info = [
    `title: ${t(spec.title)}`,
    spec.subtitle === undefined ? undefined : `subtitle: ${t(spec.subtitle)}`,
    spec.author === undefined ? undefined : `author: ${t(spec.author)}`,
    spec.institution === undefined ? undefined : `institution: ${t(spec.institution)}`,
    spec.date === undefined ? undefined : `date: ${t(spec.date)}`,
  ]
    .filter((entry) => entry !== undefined)
    .join(', ')

  const slides = spec.slides.map((slide) => `    ${slideLiteral(slide)},`).join('\n')
  const handout = options.handout === true ? '  handout: true,\n' : ''

  // The document applies the deck through a closure rather than
  // `render-deck.with(...)`. Typst rejects `.with()` on any function whose body
  // installs a `show` rule ("unexpected argument", reported against the
  // definition), and `render-deck` installs the theme that way. A closure
  // forwards the body positionally and sidesteps the limitation.
  return `// Generated by @hxql/dsh-presentation. Do not edit by hand: this file is rebuilt
// from the deck spec on every build. Edit the spec, the layout, or the theme.
#import "deck.typ": render-deck

#show: it => render-deck(
  theme: ${q(spec.theme)},
  font-stack: ${q(spec.fontStack)},
  locale: ${q(spec.locale)},
  aspect-ratio: ${q(spec.aspectRatio)},
${handout}  info: (${info}),
  slides: (
${slides}
  ),
  it,
)
`
}