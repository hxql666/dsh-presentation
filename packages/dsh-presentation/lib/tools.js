/**
 * Model-facing tools for presentation mode.
 *
 * Every tool stays registered while the mode is inactive — entering or leaving
 * the mode changes only the prompt section, never the request tool catalog, so
 * the model's prefix cache stays valid across transitions. Each `execute`
 * therefore rejects a call made outside the mode, exactly as plan mode's exit
 * tool does.
 *
 * Schemas are written in the host's author DSL (`{ type: 'object', required:
 * true, additionalProperties: true }`), which `host.defineTool` compiles to the
 * raw JSON Schema the provider requires, and every returned value is passed
 * through `jsonSafe` because the host rejects a result that does not survive a
 * JSON round trip — an `undefined` member is a rejection, not an absent field.
 *
 * @module @hxql/dsh-presentation/tools
 */
import path from 'node:path'
import { buildDeckPdf, prepareDeck, renderDeckPages, writePdfpc } from './build.js'
import { EngineError, REQUIRED_TYPST, VENDORED_TOUYING, resolveBinary } from './engine.js'
import { defineTool } from './host.js'
import { isActive, readModeState, DECK_DIR } from './mode.js'
import { LAYOUTS, LOCALES, normalizeDeckSpec } from './render.js'
import { SCENES, applyScene, findScene } from './scenes.js'

/** Layout id -> what the page is for. Kept next to `LAYOUTS` so they cannot drift. */
export const LAYOUT_HELP = {
  cover: '{ } — cover page; reads title/subtitle/author/institution/date from the deck-level fields.',
  section: '{ title, kicker? } — section divider.',
  agenda: '{ title, items[] } — table of contents.',
  bullets: '{ title, lead?, items[], takeaway? } — the workhorse content page.',
  steps: '{ title, lead?, items[], takeaway? } — numbered procedure.',
  cards: '{ title, lead?, cards[], perRow?, takeaway? } — 2-4 parallel cards.',
  kpis: '{ title, lead?, items[], takeaway? } — large metric tiles.',
  timeline: '{ title, lead?, items[], takeaway? } — milestones along a track.',
  compare: '{ title, left[], right[], leftTitle?, rightTitle? } — two-column contrast.',
  quote: '{ title, quote, author? } — pull quote.',
  table: '{ title, lead?, headers[], rows[][], takeaway? } — tabular data.',
  code: '{ title, lead?, source, language?, takeaway? } — a code block.',
  'image-text': '{ title, body[], image?, caption? } — text beside an image.',
  columns: '{ title, lead?, columns[][], ratios? } — two or three freeform columns.',
}

const THEMES = ['metropolis', 'simple', 'university', 'dewdrop', 'stargazer', 'aqua', 'default']
const FONT_STACKS = ['sans', 'serif', 'cjk-sans']

/** Resolve the session's working directory, falling back to the process cwd. */
function sessionCwd(exec) {
  const header = exec?.agent?.session?.header
  if (header !== undefined && typeof header.cwd === 'string' && header.cwd !== '') return header.cwd
  return process.cwd()
}

/** The deck working directory for a session. */
export function deckDir(exec, configuredDir) {
  if (typeof configuredDir === 'string' && configuredDir.trim() !== '') {
    return path.isAbsolute(configuredDir) ? configuredDir : path.join(sessionCwd(exec), configuredDir)
  }
  return path.join(sessionCwd(exec), DECK_DIR)
}

/**
 * Require a calling session that is in presentation mode.
 *
 * The mode cannot be turned on from here: mode state is derived from the
 * session log's command events, so only the `/deck` command selects it. That
 * makes this rejection text load-bearing — it is the one thing a model gets
 * when it reaches for a deck tool too early, so it states what the mode
 * provides and exactly what to ask the user for, instead of only refusing.
 *
 * @param {object} exec     Tool execution context.
 * @param {string} toolName For the error when there is no session at all.
 * @returns {object} The calling session.
 */
function ensureMode(exec, toolName) {
  const session = exec?.agent?.session
  if (session === undefined) throw new Error(`${toolName} requires a calling agent session`)
  if (!isActive(session)) {
    const cwd = session.header?.cwd
    const dir = typeof cwd === 'string' && cwd !== '' ? `${cwd}\\${DECK_DIR}` : DECK_DIR
    throw new Error(
      `${toolName} needs presentation-document mode, and it is off for this session. ` +
      'Ask the user to send the /deck command, then call this tool again. ' +
      'That mode compiles a deck spec into a PDF presentation: ' +
      `${LAYOUTS.length} page layouts, seven themes, a visual self-review step that renders pages to PNG, ` +
      'and handout / speaker-note exports. ' +
      `Decks are authored as structured page data and written under ${dir}.`,
    )
  }
  return session
}

const text = (value) => [{ type: 'text', text: String(value) }]

/**
 * Copy a returned value without its absent fields, recursively.
 *
 * The host validates a tool's result as lossless JSON before rendering it: an
 * `undefined` member is not "absent", it fails the whole result. Optional
 * fields are therefore dropped here rather than passed through as `undefined`.
 *
 * @param {unknown} value Returned value, array, or scalar.
 * @returns {unknown} The same data with every `undefined` member removed.
 */
function jsonSafe(value) {
  if (Array.isArray(value)) return value.map((entry) => jsonSafe(entry))
  if (value === null || typeof value !== 'object') return value
  const out = {}
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = jsonSafe(entry)
  }
  return out
}

/** Summarize structured diagnostics for the model. */
function diagnosticText(diagnostics) {
  if (!Array.isArray(diagnostics) || diagnostics.length === 0) return ''
  return diagnostics
    .slice(0, 12)
    .map((d) => {
      const at = d.file === undefined ? '' : ` (${path.basename(d.file)}:${d.line ?? '?'}:${d.column ?? '?'})`
      const hint = d.hint === undefined ? '' : `\n    hint: ${d.hint}`
      return `${d.severity}: ${d.message}${at}${hint}`
    })
    .join('\n')
}

/**
 * Register every presentation tool on `ctx.tools`.
 *
 * Each definition is compiled and its schemas validated individually. A
 * definition that fails that check is skipped and reported rather than thrown:
 * a tool whose schema does not compile makes the provider reject every request
 * in the session, so one bad definition must never take the whole catalog — or
 * the other tools — down with it.
 *
 * @param {object} ctx    Registrant context carrying the tool registry.
 * @param {object} config Resolved plugin config.
 * @returns {{ registered: string[], skipped: { name: string, reason: string }[] }}
 */
export function registerTools(ctx, config) {
  const registered = []
  const skipped = []

  for (const definition of buildToolDefinitions(config)) {
    let tool
    try {
      // `defineTool` compiles the author DSL to raw JSON Schema and asserts the
      // host's supported subset, so this is the same gate activation runs.
      tool = defineTool(definition)
    } catch (/** @type {any} */ error) {
      const reason = Array.isArray(error?.violations) ? error.violations.join('; ') : String(error?.message ?? error)
      skipped.push({ name: definition.name, reason })
      ctx.logger?.warn?.(`@hxql/dsh-presentation: skipped tool ${definition.name} — its schema did not compile: ${reason}`)
      continue
    }
    ctx.tools.register(tool)
    registered.push(definition.name)
  }

  return { registered, skipped }
}

/**
 * Build the tool definitions. Split from registration so a broken definition
 * can be reported and skipped instead of aborting the whole catalog.
 *
 * @param {object} config Resolved plugin config.
 * @returns {object[]} Tool definitions in the author DSL.
 */
function buildToolDefinitions(config) {
  // Both values travel together so no call site can pass one and forget the
  // other: the explicit path, and which Typst the user prefers to use.
  const binaryOption = () => ({ typstBinary: config.typstBinaryPath, typstPath: config.typstPath })

  // --- deck_build --------------------------------------------------------
  const deckBuild = {
    name: 'deck_build',
    description:
      'Compile a deck spec into a PDF presentation. In presentation-document mode only. ' +
      'Pass the complete deck as structured data: the layout engine owns all typesetting, so never write Typst markup. ' +
      'Inline emphasis in text slots uses **bold** and *italic*. Returns the PDF path, page count, and any structured compiler diagnostics.',
    parameters: {
      spec: {
        type: 'object',
        required: true,
        additionalProperties: true,
        description: 'The deck: { title, subtitle?, author?, institution?, date?, theme?, aspectRatio?, fontStack?, locale?, slides[] }.',
        properties: {
          title: { type: 'string', required: true, description: 'Deck title, shown on the cover.' },
          subtitle: { type: 'string', description: 'Cover subtitle.' },
          author: { type: 'string', description: 'Cover author.' },
          institution: { type: 'string', description: 'Cover institution.' },
          date: { type: 'string', description: 'Cover date.' },
          theme: { type: 'string', enum: THEMES, description: `Visual theme. Default ${config.theme}.` },
          aspectRatio: { type: 'string', enum: ['16-9', '4-3', '16-10'], description: `Frame ratio. Default ${config.aspectRatio}.` },
          fontStack: { type: 'string', enum: FONT_STACKS, description: `Font stack. Default ${config.fontStack}.` },
          locale: {
            type: 'string',
            enum: LOCALES,
            description:
              `Language facts Typst uses for line breaking, hyphenation and punctuation — not a display preference. ` +
              `Default ${config.locale}. Use "en" for a Latin-script deck: Chinese rules on English text give odd spacing and quote shaping.`,
          },
          slides: {
            type: 'array',
            required: true,
            description: `Ordered pages. Each page needs a layout id: ${LAYOUTS.join(', ')}. Call deck_status for each layout's slots.`,
            items: { type: 'object', additionalProperties: true },
          },
        },
      },
      outFile: { type: 'string', description: 'PDF output path. Defaults to <deck dir>/deck.pdf.' },
      scene: {
        type: 'string',
        enum: SCENES.map((scene) => scene.id),
        description:
          'Starting point for a known kind of talk: sets the theme, frame ratio, and font stack unless the spec ' +
          'already sets them. Call deck_status for each scene\'s page sequence and register.',
      },
      handout: {
        type: 'boolean',
        description:
          'Emit Touying\'s handout form, which collapses each logical slide\'s subslides onto one frame. ' +
          'The bundled layouts never create subslides, so this currently changes nothing unless the generated ' +
          'source is edited to add explicit pauses; it is wired so the export stays correct if that changes.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          ok: { type: 'boolean', required: true },
          pdf: { type: 'string' },
          pages: { type: 'integer' },
          bytes: { type: 'integer' },
          diagnostics: { type: 'array', items: { type: 'object', additionalProperties: true } },
        },
      },
      render: (_args, value) => {
        if (value.ok !== true) {
          return text(`Deck build FAILED.\n${diagnosticText(value.diagnostics) || value.stderr || 'no diagnostics reported'}`)
        }

        // Overflow findings are measured, not guessed. A slide Touying could not
        // measure is reported as unmeasured rather than dropped: an unmeasured
        // page still needs a look, and silence would read as a clean bill.
        const findings = value.overflow ?? []
        const measured = findings.filter((entry) => entry.slide !== undefined && entry.unmeasured !== true)
        const unmeasured = findings.filter((entry) => entry.unmeasured === true)
        const refused = findings.filter((entry) => entry.refused === true)

        const parts = []
        if (measured.length > 0) {
          parts.push(
            `\n\nSLIDES THAT DO NOT FIT (measured):\n${measured
              .map((entry) => `- ${entry.message} (${Math.round(entry.ratio * 100)}% of the frame)`)
              .join('\n')}\nTrim these pages (fewer bullets, shorter lines, or split the page) and rebuild.`,
          )
        }
        if (unmeasured.length > 0) {
          parts.push(
            `\n\nCOULD NOT MEASURE (${unmeasured.length}): ${unmeasured.map((entry) => `slide ${entry.slide}`).join(', ')}` +
            '\nTouying returned no height for these pages. Read their rendered images with deck_check before delivering.',
          )
        }
        if (refused.length > 0) parts.push(`\n\n${refused[0].message}`)
        if (value.diagnostics?.length) parts.push(`\n\nDiagnostics:\n${diagnosticText(value.diagnostics)}`)

        return text(`Deck built: ${value.pdf}\nPages: ${value.pages ?? 'unknown'} (${value.bytes} bytes)${parts.join('')}`)
      },
    },
    async execute(args, exec) {
      const session = ensureMode(exec, 'deck_build')
      const modeState = readModeState(session)
      const handout = args.handout ?? modeState.handout ?? false
      const dir = deckDir(exec, config.workdir)
      // A scene fills in the presentation register only where the spec is
      // silent, so an explicit per-deck choice always wins.
      const scene = findScene(args.scene) ?? findScene(modeState.scene)
      const spec = applyScene(applyDefaults(args.spec, config, modeState), scene?.id)
      const outFile = args.outFile === undefined
        ? path.join(dir, 'deck.pdf')
        : path.isAbsolute(args.outFile)
          ? args.outFile
          : path.join(dir, args.outFile)

      const result = await buildDeckPdf({
        spec,
        buildDir: path.join(dir, 'build'),
        outFile,
        ...binaryOption(),
        timeoutMs: config.timeoutMs,
        maxOutputBytes: config.maxOutputBytes,
      })

      if (result.ok && handout) {
        // Handout form is a second export of the same source; report it too so
        // the model does not have to guess whether it was produced.
        const handoutFile = outFile.replace(/\.pdf$/i, '.handout.pdf')
        try {
          const second = await buildDeckPdf({
            spec,
            buildDir: path.join(dir, 'build-handout'),
            outFile: handoutFile,
            ...binaryOption(),
            timeoutMs: config.timeoutMs,
            maxOutputBytes: config.maxOutputBytes,
            handout: true,
          })
          if (second.ok) result.handoutPdf = handoutFile
        } catch {
          // A failed handout export must not fail the deck build itself.
        }
      }

      return jsonSafe({
        ok: result.ok,
        pdf: result.ok ? outFile : undefined,
        specFile: result.specFile,
        pages: result.pages,
        bytes: result.bytes,
        diagnostics: result.diagnostics,
        warnings: (result.warnings ?? []).map((w) => w.message),
        overflow: (result.overflow ?? []).map((w) => w.message),
        stderr: result.ok ? undefined : result.stderr,
      })
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `Build deck: ${args?.spec?.title ?? 'untitled'}`,
      kind: 'other',
      rawInput: jsonSafe({ slides: args?.spec?.slides?.length ?? 0, theme: args?.spec?.theme }),
    }),
  }

  // --- deck_check --------------------------------------------------------
  const deckCheck = {
    name: 'deck_check',
    description:
      'Render a compiled deck to per-page PNG images so you can actually look at the layout before delivering it. ' +
      'In presentation-document mode only. Build first with deck_build, then read the images back with the image-reading tool and inspect them for ' +
      'overlap, overflow, cramped or empty frames, and wording that does not fit. Fix the spec and rebuild until the pages look right.',
    parameters: {
      pages: {
        type: 'array',
        description: '1-based page numbers to render. Omit to render every page (bounded by the plugin maxPages setting).',
        items: { type: 'integer' },
      },
      ppi: { type: 'integer', description: `Raster resolution. Default ${config.checkPpi}.` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          ok: { type: 'boolean', required: true },
          images: { type: 'array', items: { type: 'string' } },
          diagnostics: { type: 'array', items: { type: 'object', additionalProperties: true } },
        },
      },
      render: (_args, value) => {
        if (value.ok !== true) return text(`Rendering failed.\n${diagnosticText(value.diagnostics) || value.stderr || ''}`)
        return text(
          `Rendered ${value.images.length} page image(s):\n${value.images.join('\n')}\n\n` +
          'Read these images with the image-reading tool and inspect them before delivering the deck.',
        )
      },
    },
    async execute(args, exec) {
      ensureMode(exec, 'deck_check')
      const dir = deckDir(exec, config.workdir)
      const buildDir = path.join(dir, 'build')
      const typFile = path.join(buildDir, 'body.typ')
      const requested = Array.isArray(args.pages) ? args.pages.filter((p) => Number.isInteger(p) && p > 0) : []
      const pages = requested.length > 0 ? requested.slice(0, config.maxPages) : undefined

      const result = await renderDeckPages({
        typFile,
        buildDir,
        outputPattern: path.join(dir, 'preview', 'page-{p}.png'),
        ppi: Number.isInteger(args.ppi) ? args.ppi : config.checkPpi,
        pages,
        ...binaryOption(),
        timeoutMs: config.timeoutMs,
      })
      return jsonSafe({
        ok: result.files.length > 0,
        images: result.files.slice(0, config.maxPages),
        diagnostics: result.diagnostics,
        stderr: result.files.length > 0 ? undefined : result.stderr,
      })
    },
  }

  // --- deck_export -------------------------------------------------------
  const deckExport = {
    name: 'deck_export',
    description:
      'Produce derived artifacts from the last successful build. In presentation-document mode only. ' +
      '`handout` writes the print form (Touying collapses subslides; see the deck_build notes on why the bundled ' +
      'layouts produce none yet); `notes` writes a .pdfpc speaker-note sidecar for pdfpc two-screen presenting.',
    parameters: {
      what: {
        type: 'string',
        required: true,
        enum: ['handout', 'notes'],
        description: 'Which artifact to produce.',
      },
      spec: { type: 'object', additionalProperties: true, description: 'The deck spec. Required for `handout`; omit for `notes`, which reuses the last build.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          ok: { type: 'boolean', required: true },
          file: { type: 'string' },
          bytes: { type: 'integer' },
          diagnostics: { type: 'array', items: { type: 'object', additionalProperties: true } },
        },
      },
      render: (_args, value) =>
        value.ok === true
          ? text(`Wrote ${value.file}${value.bytes === undefined ? '' : ` (${value.bytes} bytes)`}.`)
          : text(`Export failed.\n${diagnosticText(value.diagnostics) || value.stderr || ''}`),
    },
    async execute(args, exec) {
      const session = ensureMode(exec, 'deck_export')
      const dir = deckDir(exec, config.workdir)

      if (args.what === 'notes') {
        const result = await writePdfpc({
          typFile: path.join(dir, 'build', 'body.typ'),
          buildDir: path.join(dir, 'build'),
          outFile: path.join(dir, 'deck.pdfpc'),
          ...binaryOption(),
          timeoutMs: config.timeoutMs,
        })
        return jsonSafe({ ok: result.ok, file: result.outFile, bytes: result.bytes, diagnostics: result.diagnostics, stderr: result.stderr })
      }

      if (args.spec === undefined) throw new Error('deck_export handout needs the deck spec')
      const modeState = readModeState(session)
      const spec = applyDefaults(args.spec, config, modeState)
      const outFile = path.join(dir, 'deck.handout.pdf')
      const result = await buildDeckPdf({
        spec,
        buildDir: path.join(dir, 'build-handout'),
        outFile,
        ...binaryOption(),
        timeoutMs: config.timeoutMs,
        maxOutputBytes: config.maxOutputBytes,
        handout: true,
      })
      return jsonSafe({ ok: result.ok, file: result.ok ? outFile : undefined, bytes: result.bytes, pages: result.pages, diagnostics: result.diagnostics, stderr: result.ok ? undefined : result.stderr })
    },
  }

  // --- deck_status -------------------------------------------------------
  const deckStatus = {
    name: 'deck_status',
    description:
      'Report presentation-document mode state plus the available page layouts, themes, and font stacks. ' +
      'Call this before authoring a deck so every page uses a layout that exists and every slot is spelled correctly.',
    // An empty map is the correct spelling for a tool with no inputs: the host
    // compiles a property map into an object root, so `{}` yields
    // `{ type: 'object', properties: {} }`. Writing `{ type: 'object' }` here
    // instead declares a property named `type`, which fails compilation.
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          active: { type: 'boolean', required: true },
          scene: { type: 'string' },
          layouts: { type: 'array', items: { type: 'object', additionalProperties: true } },
        },
      },
      render: (_args, value) => text(value.summary),
    },
    async execute(_args, exec) {
      const session = exec?.agent?.session
      // The fallback carries every ModeState field so the value below has one
      // shape whether or not a session exists.
      /** @type {import('./mode.js').ModeState} */
      const noSession = { active: false, handout: false, theme: undefined, scene: undefined }
      const state = session === undefined ? noSession : readModeState(session)

      let binary
      try {
        binary = resolveBinary({ configured: config.typstBinaryPath, preferSystem: config.typstPath === 'system' })
      } catch (error) {
        binary = undefined
      }

      const layoutLines = LAYOUTS.map((id) => `- ${id} ${LAYOUT_HELP[id] ?? ''}`).join('\n')
      const sceneLines = SCENES.map(
        (scene) => `- ${scene.id} — ${scene.label}: ${scene.who}\n    theme=${scene.theme} ratio=${scene.aspectRatio} fonts=${scene.fontStack}\n    usual page order: ${scene.sequence.join(' -> ')}\n    register: ${scene.register}`,
      ).join('\n')
      const summary = [
        `Presentation-document mode: ${state.active ? 'ACTIVE' : 'inactive'}`,
        `Handout form: ${state.handout ? 'on' : 'off'}`,
        `Defaults: theme=${state.theme ?? config.theme} aspect=${config.aspectRatio} fontStack=${config.fontStack} locale=${config.locale}`,
        `Deck directory: ${deckDir(exec, config.workdir)}`,
        `Engine: Typst ${binary?.version ?? REQUIRED_TYPST} from ${binary?.source ?? 'unresolved'}${binary?.verified === true ? ' (integrity verified)' : ''}; Touying ${VENDORED_TOUYING} vendored`,
        '',
        'Scenes (pass `scene` to deck_build; a scene only fills in what the spec leaves unset):',
        sceneLines,
        '',
        'Layouts:',
        layoutLines,
        '',
        `Themes: ${THEMES.join(', ')}`,
        `Font stacks: ${FONT_STACKS.join(', ')}`,
      ].join('\n')

      return jsonSafe({
        active: state.active === true,
        handout: state.handout === true,
        theme: state.theme ?? config.theme,
        scene: state.scene,
        aspectRatio: config.aspectRatio,
        fontStack: config.fontStack,
        deckDir: deckDir(exec, config.workdir),
        engine: { typst: binary?.version ?? REQUIRED_TYPST, source: binary?.source, verified: binary?.verified === true, touying: VENDORED_TOUYING },
        scenes: SCENES,
        layouts: LAYOUTS.map((id) => ({ id, slots: LAYOUT_HELP[id] })),
        themes: THEMES,
        fontStacks: FONT_STACKS,
        summary,
      })
    },
  }

  // --- deck_scaffold -----------------------------------------------------
  const deckScaffold = {
    name: 'deck_scaffold',
    description:
      'Lay out the deck working directory for this session without compiling: writes the deck spec and the generated Typst source. ' +
      'In presentation-document mode only. Rarely needed — deck_build writes the same files — but useful to inspect the generated source.',
    parameters: {
      spec: { type: 'object', required: true, additionalProperties: true, description: 'The deck spec.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          ok: { type: 'boolean', required: true },
          specFile: { type: 'string' },
          typFile: { type: 'string' },
        },
      },
      render: (_args, value) => text(`Wrote ${value.specFile}\nGenerated source: ${value.typFile}`),
    },
    async execute(args, exec) {
      ensureMode(exec, 'deck_scaffold')
      const dir = deckDir(exec, config.workdir)
      const result = prepareDeck({ spec: normalizeDeckSpec(args.spec), buildDir: path.join(dir, 'build') })
      return jsonSafe({ ok: true, specFile: result.specFile, typFile: result.typFile })
    },
  }
  return [
    deckBuild,
    deckCheck,
    deckExport,
    deckStatus,
    deckScaffold,
  ]
}

/** Fold deployment defaults and the session's mode selections into a spec. */
function applyDefaults(spec, config, modeState) {
  if (spec === null || typeof spec !== 'object') throw new EngineError('bad-spec', 'deck spec must be an object')
  return {
    ...spec,
    theme: spec.theme ?? modeState.theme ?? config.theme,
    aspectRatio: spec.aspectRatio ?? config.aspectRatio,
    fontStack: spec.fontStack ?? config.fontStack,
    // A scene may pin a locale (an English-language scene should not inherit
    // Chinese line-breaking); an explicit spec value still wins.
    locale: spec.locale ?? config.locale,
  }
}
