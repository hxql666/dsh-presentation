// dsh-presentation layout primitives.
//
// The presentation mode never lets the model write raw Typst layout. The model
// emits structured page data; `lib/render.js` translates it into calls to these
// primitives. Every primitive owns its own spacing, type scale and overflow
// behaviour, so a deck assembled from any combination of them stays visually
// consistent across regenerations.
//
// Layout rules learned the hard way, applied throughout:
//   * A grid cell that holds two differently sized text runs must wrap them in
//     an explicit `block` (plus `align: top`), or both runs share one line box
//     and overlap.
//   * `grid` takes `column-gutter` / `row-gutter`; its `gutter` parameter does
//     not accept a dictionary.
//   * `raw(theme: ...)` is a path to a `.tmTheme` file, not a theme name.
//   * Content is anchored to the bottom of the body area via `deck-composer`.

#import "@preview/touying:0.8.0": *

#let _accent = rgb("#2f6f9f")
#let _ink = rgb("#1d2733")
#let _muted = rgb("#5b6b7c")
#let _hairline = rgb("#d6dee7")
#let _soft = rgb("#f4f7fa")

// --- slide composition -----------------------------------------------------

/// Push a slide's content block to the bottom of its body area.
///
/// A slide whose content only fills the top half of the frame reads as
/// unfinished; anchoring content to the bottom is what presentation decks
/// conventionally do. The flexible first row absorbs the slack, so short and
/// tall slides both end flush with the footer.
#let deck-composer = grid.with(
  columns: 1,
  rows: (1fr, auto),
  align: bottom,
)

// --- text runs -------------------------------------------------------------

/// A small eyebrow above a title.
#let deck-kicker(label, accent: _accent) = text(
  size: 0.78em,
  weight: "semibold",
  fill: accent,
  tracking: 0.08em,
  label,
)

/// A lead paragraph: larger and muted, for one-sentence framing.
#let deck-lead(body) = block(above: 0.2em, below: 0.7em, text(size: 1.18em, fill: _muted, body))

/// A secondary/caption line.
#let deck-caption(body) = text(size: 0.82em, fill: _muted, body)

/// Render a list of plain strings or content as stacked lines.
#let deck-lines(lines) = {
  if lines == none { return [] }
  if type(lines) != array { return lines }
  if lines.len() == 0 { return [] }
  block(width: 100%, stack(dir: ttb, spacing: 0.42em, ..lines.map(line =>
    if type(line) == str { text(line) } else { line }
  )))
}

/// One list row: a marker cell plus a two-line text cell.
///
/// The two text runs are wrapped in an explicit `block(width: 100%, stack(...))`
/// inside a top-aligned grid cell. Verified by bisection: a bare `stack` in the
/// cell, or a `stack` reached through a spread of mapped rows, collapses the two
/// runs into one line box under Touying's slide layout.
#let _deck-row(marker, item, gap) = block(
  above: gap,
  width: 100%,
  grid(
    columns: (1.5em, 1fr),
    column-gutter: 0.6em,
    align: top,
    marker,
    block(
      width: 100%,
      stack(
        dir: ttb,
        spacing: 0.3em,
        text(weight: "medium", item.text),
        if item.detail != none { text(size: 0.88em, fill: _muted, item.detail) },
      ),
    ),
  ),
)

/// A dense bullet list with an optional per-item detail line.
#let deck-bullets(items, gap: 0.62em) = {
  for item in items {
    _deck-row(text(fill: _accent, weight: "bold", "•"), item, gap)
  }
}

/// A numbered step list, for sequences and procedures.
#let deck-steps(items, gap: 0.7em) = {
  for (index, item) in items.enumerate() {
    _deck-row(
      box(
        width: 1.5em,
        height: 1.5em,
        radius: 50%,
        fill: _accent,
        align(center + horizon, text(fill: white, weight: "bold", size: 0.85em, str(index + 1))),
      ),
      item,
      gap,
    )
  }
}

// --- cards and metrics -----------------------------------------------------

/// A single card: title, optional eyebrow, body lines, optional footer.
///
/// Cards size to their content: a full-height card in an uneven grid leaves a
/// conspicuous empty block under the shorter ones.
#let deck-card(
  title: none,
  body: none,
  eyebrow: none,
  footer: none,
  accent: _accent,
  fill: white,
) = block(
  width: 100%,
  inset: (x: 0.9em, y: 0.85em),
  radius: 0.4em,
  stroke: 0.6pt + _hairline,
  fill: fill,
  {
    if eyebrow != none { deck-kicker(eyebrow, accent: accent) }
    if title != none {
      block(
        above: if eyebrow != none { 0.3em } else { 0pt },
        below: 0.45em,
        text(weight: "bold", size: 1.04em, title),
      )
    }
    if body != none { deck-lines(body) }
    if footer != none { block(above: 0.6em, deck-caption(footer)) }
  },
)

/// A grid of cards. `per-row` sets the column count.
///
/// Iterates with `for` rather than `array.map`. Typst treats a parenthesised
/// single-element collection as the element itself, so `(one-dict,)` reaches a
/// mapped callback as a dictionary instead of an array — a one-card or
/// one-metric page would then fail with "cannot access fields on type string".
#let deck-cards(cards, per-row: 2, gutter: 0.8em, row-gutter: 0.9em) = {
  let cells = ()
  for card in cards {
    cells.push(deck-card(
      title: card.at("title", default: none),
      body: card.at("body", default: none),
      eyebrow: card.at("eyebrow", default: none),
      footer: card.at("footer", default: none),
    ))
  }
  block(
    width: 100%,
    grid(
      columns: if type(per-row) == int and per-row > 0 { per-row } else { 2 },
      column-gutter: gutter,
      row-gutter: row-gutter,
      ..cells,
    ),
  )
}

/// A row of large metric tiles: value, label, optional note.
#let deck-kpis(items, per-row: none, accent: _accent) = {
  let count = if items.len() == 0 { 1 } else if per-row == none { calc.min(items.len(), 4) } else { per-row }
  let cells = ()
  for item in items {
    let lines = (text(size: 1.85em, weight: "bold", fill: accent, item.value), text(weight: "medium", item.label))
    if item.at("note", default: none) != none {
      lines.push(text(size: 0.82em, fill: _muted, item.note))
    }
    cells.push(block(
      width: 100%,
      inset: (x: 0.95em, y: 0.9em),
      radius: 0.4em,
      fill: _soft,
      stroke: 0.6pt + _hairline,
      stack(dir: ttb, spacing: 0.4em, ..lines),
    ))
  }
  block(
    width: 100%,
    grid(columns: count, column-gutter: 0.8em, ..cells),
  )
}

// --- comparison, quote, timeline ------------------------------------------

/// Two labelled columns for contrast.
#let deck-compare(left, right, left-title: "Before", right-title: "After", accent: _accent) = block(
  width: 100%,
  grid(
    columns: (1fr, 1fr),
    column-gutter: 0.9em,
    deck-card(title: left-title, body: left, accent: accent),
    deck-card(title: right-title, body: right, accent: accent),
  ),
)

/// A pull quote with attribution.
#let deck-quote(quote, author: none, accent: _accent) = block(
  width: 100%,
  inset: (x: 1.1em, y: 0.9em),
  radius: 0.4em,
  stroke: (left: 4pt + accent),
  fill: _soft,
  stack(
    dir: ttb,
    spacing: 0.8em,
    text(size: 1.3em, style: "italic", quote),
    if author != none { deck-kicker(author, accent: accent) },
  ),
)

/// A horizontal milestone track.
#let deck-timeline(items, accent: _accent) = {
  let cells = ()
  for item in items {
    let lines = (box(width: 100%, height: 3pt, fill: accent), text(weight: "bold", size: 0.95em, item.label))
    if item.at("detail", default: none) != none {
      lines.push(text(size: 0.84em, fill: _muted, item.detail))
    }
    cells.push(block(
      width: 100%,
      stack(dir: ttb, spacing: 0.5em, ..lines),
    ))
  }
  block(
    width: 100%,
    grid(
      columns: if items.len() > 0 { items.len() } else { 1 },
      column-gutter: 0.6em,
      align: top,
      ..cells,
    ),
  )
}

// --- table and code --------------------------------------------------------

/// A compact table with a tinted header row.
#let deck-table(headers, rows, accent: _accent) = block(
  width: 100%,
  table(
    columns: if headers.len() > 0 { headers.len() } else { 1 },
    inset: (x: 0.65em, y: 0.5em),
    stroke: 0.4pt + _hairline,
    fill: (_, row) => if row == 0 { _soft } else { white },
    table.header(..headers.map(h => text(weight: "bold", fill: accent, h))),
    ..rows.flatten(),
  ),
)

/// A code block that fits the slide instead of overflowing it.
#let deck-code(source, language: "typ", size: 0.78em) = block(
  width: 100%,
  inset: (x: 0.9em, y: 0.7em),
  radius: 0.35em,
  fill: rgb("#f7f9fb"),
  stroke: 0.6pt + _hairline,
  text(size: size, raw(source, lang: language, block: true)),
)

// --- image and text --------------------------------------------------------

/// A two-column image/text composition.
#let deck-image-text(body, image: none, ratio: (1.15fr, 1fr), caption: none) = block(
  width: 100%,
  grid(
    columns: ratio,
    column-gutter: 1em,
    align: top,
    body,
    if image == none {
      block(
        width: 100%,
        height: 3.2em,
        radius: 0.35em,
        fill: _soft,
        align(center + horizon, deck-caption("image")),
      )
    } else {
      block(width: 100%, {
        image(image, width: 100%)
        if caption != none { block(above: 0.35em, deck-caption(caption)) }
      })
    },
  ),
)

// --- emphasis --------------------------------------------------------------

/// A bordered callout box.
#let deck-callout(body, accent: _accent) = block(
  width: 100%,
  inset: (x: 1em, y: 0.8em),
  radius: 0.35em,
  stroke: (left: 3pt + accent),
  fill: _soft,
  body,
)

/// A quiet footer line for a slide, e.g. the one thing to remember.
#let deck-takeaway(body, accent: _accent) = block(
  width: 100%,
  above: 1em,
  inset: (x: 0.85em, y: 0.55em),
  radius: 0.3em,
  fill: _soft,
  stroke: (left: 3pt + accent),
  {
    text(weight: "semibold", fill: accent, "Takeaway  ")
    body
  },
)

/// A cover page. Every theme ships its own `title-slide`, and importing several
/// themes makes those definitions shadow one another, so the cover is composed
/// here instead: it stays identical no matter which theme is selected.
#let deck-cover(info, accent: _accent) = {
  let title = info.at("title", default: "")
  let subtitle = info.at("subtitle", default: none)
  let author = info.at("author", default: none)
  let institution = info.at("institution", default: none)
  let date = info.at("date", default: none)

  block(width: 100%, {
    box(width: 3.2em, height: 4pt, fill: accent)
    block(above: 1.2em, text(size: 2.15em, weight: "bold", title))
    if subtitle != none { block(above: 0.55em, text(size: 1.2em, fill: _muted, subtitle)) }
    if author != none or institution != none or date != none {
      block(
        above: 1.8em,
        stack(
          dir: ttb,
          spacing: 0.22em,
          if author != none { text(weight: "medium", author) },
          if institution != none { text(size: 0.92em, fill: _muted, institution) },
          if date != none { text(size: 0.88em, fill: _muted, date) },
        ),
      )
    }
  })
}
