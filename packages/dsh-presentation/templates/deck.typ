// dsh-presentation deck template.
//
// Generated source imports this module and calls `render-deck` once, passing a
// plain data dictionary. The model never writes layout: it produces structured
// page data, `lib/render.js` translates that into Typst data literals, and this
// module owns the entire composition.

#import "@preview/touying:0.8.0": *
#import "layout.typ": *

// Touying exposes each theme through its `themes` module, and the documented
// access form is a path import (`import themes.metropolis: *`); a plain
// `import themes: name` does not resolve. Every theme this plugin offers is
// therefore pulled in with the documented form, which also brings the shared
// theme helpers (`utils`, `components`) into scope. The imports are idempotent
// even though each theme module re-imports `src/exports.typ` internally.
#import themes.default: *
#import themes.simple: *
#import themes.metropolis: *
#import themes.dewdrop: *
#import themes.university: *
#import themes.aqua: *
#import themes.stargazer: *

#let dsh-themes = (
  metropolis: metropolis-theme,
  simple: simple-theme,
  university: university-theme,
  dewdrop: dewdrop-theme,
  stargazer: stargazer-theme,
  aqua: aqua-theme,
  default: default-theme,
)

/// Human-facing names for the theme registry, surfaced by the deck_themes tool.
#let dsh-theme-notes = (
  metropolis: "Dense and professional, strong section bar. Default for technical talks.",
  simple: "Quiet and high whitespace. Good for teaching and reading-heavy decks.",
  university: "Academic institutional look. Good for seminars and defenses.",
  dewdrop: "Soft rounded look with generous padding. Good for product and business decks.",
  stargazer: "Dark, high contrast. Good for demos and stage projection.",
  aqua: "Light cyan accents. Good for data and metrics decks.",
  default: "Plain Touying default. Use only when a theme is deliberately unwanted.",
)

/// Font stacks a deck may select. Index 0 is the Latin family, index 1 the CJK
/// family; the remaining entries are fallbacks in order.
#let dsh-font-stacks = (
  sans: ("New Computer Modern", "Noto Sans SC", "Microsoft YaHei", "SimSun"),
  serif: ("Libertinus Serif", "Noto Serif SC", "SimSun", "Microsoft YaHei"),
  cjk-sans: ("Noto Sans SC", "Microsoft YaHei", "New Computer Modern", "SimSun"),
)

/// Language settings a deck may select.
///
/// This is not cosmetic. Typst derives line breaking, hyphenation, and
/// punctuation shaping from `lang`/`region`, so forcing zh-CN on an English deck
/// gives it Chinese line-breaking rules — visible as odd spacing and quote
/// shaping. The default suits the CJK-first font stacks; a Latin deck should
/// select `en`.
#let dsh-locales = (
  zh: (lang: "zh", region: "cn"),
  zh-tw: (lang: "zh", region: "tw"),
  en: (lang: "en", region: "us"),
  ja: (lang: "ja", region: "jp"),
  ko: (lang: "ko", region: "kr"),
  de: (lang: "de", region: "de"),
  fr: (lang: "fr", region: "fr"),
  es: (lang: "es", region: "es"),
  ru: (lang: "ru", region: "ru"),
)

/// Normalise a bullet/step list: plain strings become `(text, detail: none)`.
#let dsh-list(items) = items.map(item =>
  if type(item) == dictionary { item } else { (text: item, detail: none) }
)

/// Emit one slide.
#let dsh-slide(spec, info: (:)) = {
  let layout = spec.at("layout", default: "bullets")
  let title = spec.at("title", default: none)
  let lead = spec.at("lead", default: none)
  let takeaway = spec.at("takeaway", default: none)

  if layout == "cover" {
    // Composed locally rather than through a theme's `title-slide`: importing
    // several themes makes their `title-slide` definitions shadow one another,
    // and a zero-argument call would bind to whichever won.
    slide[
      #deck-cover(info)
    ]
  } else if layout == "section" {
    slide[
      #block(above: 1.2em)[
        #text(size: 1.9em, weight: "bold", title)
      ]
    ]
  } else if layout == "agenda" {
    slide(title: title, composer: deck-composer)[
      #deck-bullets(dsh-list(spec.at("items", default: ())), gap: 0.75em)
    ]
  } else if layout == "quote" {
    slide(title: title, composer: deck-composer)[
      #deck-quote(spec.at("quote", default: ""), author: spec.at("author", default: none))
    ]
  } else if layout == "kpis" {
    slide(title: title, composer: deck-composer)[
      #if lead != none { deck-lead(lead) }
      #deck-kpis(spec.at("items", default: ()))
      #if takeaway != none { deck-takeaway(takeaway) }
    ]
  } else if layout == "timeline" {
    slide(title: title, composer: deck-composer)[
      #if lead != none { deck-lead(lead) }
      #deck-timeline(spec.at("items", default: ()))
      #if takeaway != none { deck-takeaway(takeaway) }
    ]
  } else if layout == "cards" {
    let cards = spec.at("cards", default: ())
    let per-row = if cards.len() > 0 { cards.first().at("per-row", default: 2) } else { 2 }
    slide(title: title, composer: deck-composer)[
      #if lead != none { deck-lead(lead) }
      #deck-cards(cards, per-row: per-row)
      #if takeaway != none { deck-takeaway(takeaway) }
    ]  } else if layout == "steps" {
    slide(title: title, composer: deck-composer)[
      #if lead != none { deck-lead(lead) }
      #deck-steps(dsh-list(spec.at("items", default: ())))
      #if takeaway != none { deck-takeaway(takeaway) }
    ]
  } else if layout == "compare" {
    slide(title: title, composer: deck-composer)[
      #deck-compare(
        deck-lines(spec.at("left", default: ())),
        deck-lines(spec.at("right", default: ())),
        left-title: spec.at("left-title", default: "Before"),
        right-title: spec.at("right-title", default: "After"),
      )
    ]
  } else if layout == "table" {
    slide(title: title, composer: deck-composer)[
      #if lead != none { deck-lead(lead) }
      #deck-table(spec.at("headers", default: ()), spec.at("rows", default: ()))
      #if takeaway != none { deck-takeaway(takeaway) }
    ]
  } else if layout == "code" {
    slide(title: title, composer: deck-composer)[
      #if lead != none { deck-lead(lead) }
      #deck-code(spec.at("source", default: ""), language: spec.at("language", default: "typ"))
      #if takeaway != none { deck-takeaway(takeaway) }
    ]
  } else if layout == "image-text" {
    slide(title: title, composer: deck-composer)[
      #deck-image-text(
        {
          if lead != none { deck-lead(lead) }
          deck-lines(spec.at("body", default: ()))
        },
        image: spec.at("image", default: none),
        caption: spec.at("caption", default: none),
      )
    ]
  } else if layout == "columns" {
    slide(title: title, composer: deck-composer)[
      #if lead != none { deck-lead(lead) }
      #grid(
        columns: spec.at("ratios", default: (1fr, 1fr)),
        gutter: 1.1em,
        ..spec.at("columns", default: ()).map(col => deck-lines(col)),
      )
    ]
  } else {
    // "bullets" and any unmodelled layout degrade to a bullet page instead of
    // failing the whole compilation.
    slide(title: title, composer: deck-composer)[
      #if lead != none { deck-lead(lead) }
      #deck-bullets(dsh-list(spec.at("items", default: ())))
      #if takeaway != none { deck-takeaway(takeaway) }
    ]
  }

  // Speaker notes become pdfpc notes; Touying attaches a note that directly
  // follows a slide to that slide.
  let note = spec.at("note", default: none)
  if note != none and note != "" {
    speaker-note(note)
  }
}

/// Render every slide of a deck.
#let render-slides(slides, info: (:)) = {
  for spec in slides { dsh-slide(spec, info: info) }
}

/// Build the whole presentation.
///
/// - theme (str): key of `dsh-themes`.
/// - font-stack (str): key of `dsh-font-stacks`.
/// - locale (str): key of `dsh-locales`; selects the language facts Typst uses
///   for line breaking, hyphenation, and punctuation, not a display preference.
/// - slides (array): ordered page data dictionaries.
/// - info (dict): `config-info` fields.
/// - handout (bool): collapse subslides so each logical slide prints once.
/// - breakable (bool): allow content that does not fit to flow onto an extra
///   page. Touying's default `true` is kept: nothing is ever clipped, and the
///   alternative overflow-measurement route is unreliable for these layouts.
/// - body: the document body this function is applied to (a show rule target);
///   the deck ignores it and renders `slides` instead.
#let render-deck(
  theme: "metropolis",
  font-stack: "sans",
  locale: "zh",
  aspect-ratio: "16-9",
  slides: (),
  info: (:),
  handout: false,
  align: top,
  breakable: true,
  body,
) = {
  let theme-fn = dsh-themes.at(theme)
  let fonts = dsh-font-stacks.at(font-stack)

  // Both show rules are installed from *inside* this body, never by the caller.
  // Touying's configuration only takes effect when the theme's show rule is
  // installed where the configuration is lexically in scope: packing a
  // configuration dictionary into `render-deck.with(...)` at the call site
  // silently drops it (verified against Touying 0.8.0 — the same deck reports
  // overflow when the rule is installed here and reports nothing when the
  // dictionary arrives as a call argument). The generated document therefore
  // passes plain scalars and this body builds the configuration.
  //
  // `align: top` keeps a deck's content block anchored under the header, so
  // consecutive slides do not drift up and down as their content length changes.
  //
  // `breakable` stays Touying's default `true`: content that does not fit flows
  // onto an extra page instead of being clipped, which is predictable and never
  // loses text. The alternative — `breakable: false` plus `detect-overflow` —
  // was measured and rejected: Touying reports a 0pt content height for slides
  // built from the grid/stack composition these layouts use, so it flags pages
  // that are visibly full as unmeasured and cannot be trusted to catch a real
  // overflow. Overflow is therefore caught by looking at the rendered pages.
  show: theme-fn.with(
    aspect-ratio: aspect-ratio,
    align: align,
    (info: info),
    (
      handout: handout,
      enable-pdfpc: true,
      breakable: breakable,
    ),
  )

  show: it => {
    // `locale` selects the language facts Typst uses for line breaking,
    // hyphenation, and punctuation shaping — not just a display preference.
    let language = dsh-locales.at(locale)
    set text(font: fonts, lang: language.lang, region: language.region)
    set par(justify: true, leading: 0.68em, first-line-indent: 0em)
    it
  }

  render-slides(slides, info: info)
}

