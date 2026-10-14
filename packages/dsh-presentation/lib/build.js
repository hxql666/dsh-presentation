/**
 * Build orchestration: lay a deck's build directory out on disk, compile it,
 * and render page images for visual review.
 *
 * The build directory is self-contained and disposable. Nothing is written
 * outside it except the caller's chosen output PDF/PNG paths, and the Typst
 * compiler is given `--root` pointing at that directory, so a deck can never
 * read or write outside its own folder.
 *
 * @module @hxql/dsh-presentation/build
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  EngineError,
  VENDORED_TOUYING,
  countPdfPages,
  ensureDir,
  fileSize,
  packagePath,
  parseDiagnostics,
  parseOverflowWarnings,
  resolveBinary,
  runTypst,
  templatePath,
} from './engine.js'
import { normalizeDeckSpec, renderDeckSource } from './render.js'

/** How deep a `.typ` may pull in other files before we stop scanning. */
const MAX_DEPTH = 12

/** Recursively copy a directory. */
function copyTree(from, to) {
  ensureDir(to)
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name)
    const target = path.join(to, entry.name)
    if (entry.isDirectory()) copyTree(source, target)
    else fs.copyFileSync(source, target)
  }
}

/**
 * Lay out a build directory: templates, vendored packages are referenced in
 * place (not copied), and the generated document plus its assets are written.
 *
 * @param {object} options
 * @param {object} options.spec        Raw deck spec.
 * @param {string} options.buildDir    Directory to (re)create.
 * @param {boolean} [options.handout]  Emit the handout form.
 * @returns {{ typFile: string, specFile: string, spec: object }}
 */
export function prepareDeck({ spec, buildDir, handout = false }) {
  const normalized = normalizeDeckSpec(spec)
  ensureDir(buildDir)

  // Templates are copied because Typst resolves imports relative to the
  // document, and a build directory must stay portable if the user moves it.
  // `deck.typ` is the template; the generated document is `body.typ`, so a
  // rebuild can never overwrite the template it imports.
  copyTree(templatePath(), buildDir)

  const specFile = path.join(buildDir, 'deck-spec.json')
  fs.writeFileSync(specFile, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')

  const body = renderDeckSource(normalized, { handout })
  const typFile = path.join(buildDir, 'body.typ')
  fs.writeFileSync(typFile, body, 'utf8')

  copyReferencedAssets(normalized, buildDir)
  return { typFile, specFile, spec: normalized }
}

/**
 * Copy images a spec references into the build directory, so the deck folder
 * stays self-contained. Missing files are skipped: the template renders a
 * placeholder instead of failing the whole compilation.
 */
function copyReferencedAssets(spec, buildDir) {
  const assets = path.join(buildDir, 'assets')
  const seen = new Set()
  const visit = (value, depth = 0) => {
    if (depth > MAX_DEPTH || value === null || value === undefined) return
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1)
      return
    }
    if (typeof value === 'object') {
      for (const item of Object.values(value)) visit(item, depth + 1)
      return
    }
    if (typeof value !== 'string') return
    if (!/\.(png|jpe?g|svg|webp|gif)$/i.test(value)) return
    if (seen.has(value)) return
    seen.add(value)
    if (!fs.existsSync(value) || !fs.statSync(value).isFile()) return
    ensureDir(assets)
    try {
      fs.copyFileSync(value, path.join(assets, path.basename(value)))
    } catch {
      // An unreadable asset is not fatal; the template's placeholder covers it.
    }
  }
  visit(spec)
}

/**
 * Compile a deck to PDF.
 *
 * @param {object} options
 * @param {object} options.spec
 * @param {string} options.buildDir
 * @param {string} options.outFile
 * @param {string} [options.typstBinary]  Explicit compiler path.
 * @param {string} [options.typstPath]    Which Typst to prefer: auto, system, or bundled.
 * @param {boolean} [options.handout]     Emit the handout form.
 * @param {number} [options.timeoutMs]
 * @param {number} [options.maxOutputBytes]
 * @returns {Promise<object>} build facts, including structured diagnostics.
 */
export async function buildDeckPdf({ spec, buildDir, outFile, typstBinary, typstPath, timeoutMs = 180000, maxOutputBytes = 64 * 1024 * 1024, handout = false }) {
  const binary = resolveBinary({ configured: typstBinary, preferSystem: typstPath === 'system' })
  const { typFile, specFile, spec: normalized } = prepareDeck({ spec, buildDir, handout })
  ensureDir(path.dirname(outFile))

  const result = await runTypst({
    binary: binary.path,
    args: [
      'compile',
      '--root', buildDir,
      '--package-path', packagePath(),
      '--diagnostic-format', 'short',
      typFile,
      outFile,
    ],
    cwd: buildDir,
    timeoutMs,
  })

  if (result.timedOut) {
    throw new EngineError('compile-timeout', `the Typst compiler exceeded ${timeoutMs} ms and was stopped`)
  }

  const diagnostics = parseDiagnostics(result.stderr)

  if (result.code !== 0) {
    return {
      ok: false,
      binary,
      typFile,
      specFile,
      spec: normalized,
      output: outFile,
      diagnostics,
      stderr: result.stderr.slice(-8000),
      stdout: result.stdout.slice(-2000),
    }
  }

  const bytes = fileSize(outFile)
  if (bytes === undefined) {
    return {
      ok: false,
      binary,
      typFile,
      specFile,
      spec: normalized,
      output: outFile,
      diagnostics: [{ severity: 'error', message: 'the compiler reported success but wrote no output file', raw: result.stderr }],
      stderr: result.stderr.slice(-8000),
      stdout: result.stdout.slice(-2000),
    }
  }
  if (bytes > maxOutputBytes) {
    throw new EngineError('output-too-large', `the PDF is ${bytes} bytes, above the configured maxOutputBytes (${maxOutputBytes})`)
  }

  const warnings = diagnostics.filter((entry) => entry.severity === 'warning')
  // Touying's measurement is the useful signal, not the generic warning text:
  // it names the slide and both heights, so the model can decide what to cut.
  const overflow = parseOverflowWarnings(result.stderr)

  return {
    ok: true,
    binary,
    typFile,
    specFile,
    spec: normalized,
    output: outFile,
    bytes,
    pages: countPdfPages(outFile),
    diagnostics,
    warnings,
    overflow,
    stderr: result.stderr.slice(-8000),
  }
}

/**
 * Render page images next to a compiled PDF, for visual review.
 *
 * @param {object} options
 * @param {string} options.typFile
 * @param {string} options.buildDir
 * @param {string} options.outputPattern  e.g. `<dir>/page-{p}.png`
 * @param {number} [options.ppi]
 * @param {number[]} [options.pages]      Optional 1-based page subset.
 * @param {string} [options.typstBinary]  Explicit compiler path.
 * @param {string} [options.typstPath]    Which Typst to prefer: auto, system, or bundled.
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ files: string[], diagnostics: object[], stderr: string }>}   `stderr` is the tail the model needs when a page fails to render.
 */
export async function renderDeckPages({ typFile, buildDir, outputPattern, ppi = 110, pages, typstBinary, typstPath, timeoutMs = 180000 }) {
  const binary = resolveBinary({ configured: typstBinary, preferSystem: typstPath === 'system' })
  // Typst writes into an existing directory only; create it before compiling.
  const dir = path.dirname(outputPattern.replace('{p}', '1'))
  ensureDir(dir)

  // Remove this pattern's previous output first.
  //
  // Typst overwrites the pages it renders and leaves every other file alone, so a
  // later render of fewer pages — a deck edited down from 16 frames to 7, or a
  // render of just pages 1-5 — used to leave the older images sitting beside the
  // new ones. The visual self-review step then reads them: it inspects pages that
  // are not in the current deck, and can "fix" a problem the deck no longer has.
  // Only files matching this pattern are touched, so a neighbouring directory or
  // an unrelated image is safe.
  const stem = path.basename(outputPattern).replace('{p}', '')
  const prefix = stem.endsWith('.png') ? stem.slice(0, -4) : stem
  const stale = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((name) => name.startsWith(prefix) && name.endsWith('.png'))
    : []
  for (const name of stale) {
    try {
      fs.rmSync(path.join(dir, name), { force: true })
    } catch {
      // A locked file is not worth failing the render over; the count below will
      // still report only the pages that were asked for.
    }
  }

  const args = [
    'compile',
    '--root', buildDir,
    '--package-path', packagePath(),
    '--format', 'png',
    '--ppi', String(ppi),
  ]
  if (Array.isArray(pages) && pages.length > 0) {
    args.push('--pages', pages.join(','))
  }
  args.push('--diagnostic-format', 'short', typFile, outputPattern)

  const result = await runTypst({ binary: binary.path, args, cwd: buildDir, timeoutMs })
  if (result.timedOut) {
    throw new EngineError('render-timeout', `PNG rendering exceeded ${timeoutMs} ms and was stopped`)
  }
  const diagnostics = parseDiagnostics(result.stderr)
  if (result.code !== 0) {
    return { files: [], diagnostics, stderr: result.stderr.slice(-8000) }
  }

  // Report exactly the requested pages that now exist on disk, rather than every
  // PNG in the directory. Asking for pages 1-5 must not claim pages 6-8 exist.
  const wanted = Array.isArray(pages) && pages.length > 0 ? pages : undefined
  const files = []
  if (wanted !== undefined) {
    for (const page of wanted) {
      const file = outputPattern.replace('{p}', String(page))
      if (fs.existsSync(file)) files.push(file)
    }
  } else {
    // No explicit range: take the contiguous run Typst produced, starting at 1.
    for (let page = 1; ; page += 1) {
      const file = outputPattern.replace('{p}', String(page))
      if (!fs.existsSync(file)) break
      files.push(file)
    }
  }
  return { files, diagnostics, stderr: result.stderr.slice(-8000) }
}

/**
 * Compile an already-generated document to PDF, without rebuilding it.
 *
 * `deck_build` writes both the spec and the Typst source, so a second export can
 * compile the same source again. That matters for the vector export: re-deriving it
 * from the spec risks a file that differs from the deck that was reviewed (a spec
 * edited after the build, a scene applied differently), while recompiling the source
 * cannot. Typst's PDF output is vector, so there is nothing to rasterise.
 *
 * The output is written through a temporary file and moved into place, so a failure
 * cannot leave a half-written PDF where a reader might pick it up.
 *
 * @param {object} options
 * @param {string} options.typFile
 * @param {string} options.buildDir
 * @param {string} options.outFile
 * @param {string} [options.typstBinary]
 * @param {string} [options.typstPath]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.maxOutputBytes]
 * @returns {Promise<{ ok: boolean, outFile?: string, bytes?: number, pages?: number,
 *   diagnostics: object[], stderr: string }>}
 */
export async function compileDocumentPdf({ typFile, buildDir, outFile, typstBinary, typstPath, timeoutMs = 120000, maxOutputBytes }) {
  if (!fs.existsSync(typFile)) {
    return { ok: false, diagnostics: [], stderr: `no generated document at ${typFile}; build the deck first` }
  }
  const binary = resolveBinary({ configured: typstBinary, preferSystem: typstPath === 'system' })
  ensureDir(path.dirname(outFile))
  // Typst infers the output format from the path's extension, so the temporary file
  // has to keep a `.pdf` suffix — `deck.vector.pdf.partial` is rejected with
  // "could not infer output format". Renaming it into place afterwards is what gives
  // the all-or-nothing property.
  const temporary = `${outFile}.partial.pdf`

  const result = await runTypst({
    binary: binary.path,
    args: ['compile', '--root', buildDir, '--package-path', packagePath(), '--diagnostic-format', 'short', typFile, temporary],
    cwd: buildDir,
    timeoutMs,
  })
  const diagnostics = parseDiagnostics(result.stderr)
  if (result.timedOut) {
    return { ok: false, diagnostics, stderr: `PDF compilation exceeded ${timeoutMs} ms and was stopped` }
  }
  if (result.code !== 0) {
    try {
      fs.rmSync(temporary, { force: true })
    } catch {
      // Nothing to clean up if it was never written.
    }
    return { ok: false, diagnostics, stderr: result.stderr.slice(-8000) }
  }

  const bytes = fs.statSync(temporary).size
  if (typeof maxOutputBytes === 'number' && bytes > maxOutputBytes) {
    fs.rmSync(temporary, { force: true })
    return { ok: false, diagnostics, stderr: `the PDF is ${bytes} bytes, above the configured maxOutputBytes (${maxOutputBytes})` }
  }

  fs.renameSync(temporary, outFile)
  return { ok: true, outFile, bytes, pages: countPdfPages(outFile), diagnostics, stderr: result.stderr.slice(-8000) }
}

/**
 * Extract the pdfpc speaker-note metadata into a `.pdfpc` sidecar file.
 *
 * @param {object} options
 * @param {string} options.typFile
 * @param {string} options.buildDir
 * @param {string} options.outFile
 * @param {string} [options.typstBinary]  Explicit compiler path.
 * @param {string} [options.typstPath]    Which Typst to prefer: auto, system, or bundled.
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ ok: boolean, outFile?: string, bytes?: number, entries?: number,
 *   diagnostics?: object[], stderr?: string }>}  A failed query reports no `outFile`,
 *   which is why it is optional.
 */
export async function writePdfpc({ typFile, buildDir, outFile, typstBinary, typstPath, timeoutMs = 120000 }) {
  const binary = resolveBinary({ configured: typstBinary, preferSystem: typstPath === 'system' })
  const result = await runTypst({
    binary: binary.path,
    args: ['query', '--root', buildDir, '--package-path', packagePath(), '--diagnostic-format', 'short', typFile, '<pdfpc-file>', '--format', 'json'],
    cwd: buildDir,
    timeoutMs,
  })
  if (result.code !== 0) {
    return { ok: false, diagnostics: parseDiagnostics(result.stderr), stderr: result.stderr.slice(-4000) }
  }
  try {
    const parsed = JSON.parse(result.stdout)
    const first = Array.isArray(parsed) ? parsed[0] : undefined
    const value = first?.value
    if (value === undefined) return { ok: false, diagnostics: [], stderr: 'no pdfpc metadata was found in the document' }
    fs.writeFileSync(outFile, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    return { ok: true, outFile, bytes: fileSize(outFile) }
  } catch (/** @type {any} */ error) {
    return { ok: false, diagnostics: [], stderr: `could not parse pdfpc metadata: ${String(error?.message ?? error)}` }
  }
}

export { VENDORED_TOUYING, packagePath, templatePath }
