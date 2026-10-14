/**
 * Typst engine: resolve a verified compiler binary, build an isolated package
 * directory, and compile a deck spec to PDF (or per-page PNG).
 *
 * Everything here is deliberately self-contained: no DSH service is required, so
 * the same code runs under any agent preset. The plugin never writes to the
 * user's `%LOCALAPPDATA%\typst` store — package lookup, package cache, and
 * compiled output all stay inside explicit paths we own.
 *
 * @module @hxql/dsh-presentation/engine
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = path.resolve(HERE, '..')

/** Platform package names, in resolution order for the current platform. */
const PLATFORM_PACKAGES = {
  'win32-x64': ['@flukxr/typst-cli-win32-x64'],
  'win32-arm64': ['@flukxr/typst-cli-win32-arm64'],
  'linux-x64': ['@flukxr/typst-cli-linux-x64'],
  'linux-arm64': ['@flukxr/typst-cli-linux-arm64'],
  'darwin-x64': ['@flukxr/typst-cli-darwin-x64'],
  'darwin-arm64': ['@flukxr/typst-cli-darwin-arm64'],
}

/** The single Typst release this plugin is built and verified against. */
export const REQUIRED_TYPST = '0.15.1'

/**
 * The lowest Typst release the vendored Touying can compile under.
 *
 * Touying 0.8.0 declares `compiler = "0.15.0"`, so a Typst older than this is
 * rejected rather than tried: it would fail deep inside the template with an
 * error that says nothing about the real cause.
 */
export const MIN_TYPST = '0.15.0'

/** The Touying release vendored under `vendor/preview/touying`. */
export const VENDORED_TOUYING = '0.8.0'

/**
 * Compare two `major.minor.patch` version strings.
 *
 * Intentionally not semver: Typst publishes plain three-part versions, and the
 * only question asked here is whether one is at least as new as another.
 *
 * @returns {number} negative when `a < b`, zero when equal, positive when `a > b`.
 */
export function compareVersions(a, b) {
  const parse = (value) => String(value).split('.').map((part) => Number.parseInt(part, 10) || 0)
  const left = parse(a)
  const right = parse(b)
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

/**
 * A Typst executable already on this machine, if it is new enough to use.
 *
 * Shipping a 50 MB platform binary is the largest cost this plugin imposes on a
 * user, and anyone who already has Typst installed should not pay it. The
 * version is asked of the binary itself rather than assumed, because a Typst
 * older than the vendored Touying needs gives a confusing failure at compile
 * time instead of a clear refusal here.
 *
 * @param {string} command
 * @returns {{path: string, version: string, source: string, verified: boolean}|undefined}
 */
/**
 * Run `<candidate> --version` and return the version it reports.
 *
 * Windows cannot spawn a `.cmd` or `.bat` shim directly — Node raises EINVAL —
 * and the usual workaround, `shell: true`, makes Node warn (DEP0190) that
 * arguments are concatenated rather than escaped. Calling `cmd.exe /d /s /c`
 * explicitly handles the shims (which npm global installs create) without the
 * warning and without involving a shell for a real `.exe`.
 */
function readTypstVersion(candidate) {
  const extension = path.extname(candidate).toLowerCase()
  const needsCommandInterpreter = process.platform === 'win32' && (extension === '.cmd' || extension === '.bat')
  const file = needsCommandInterpreter ? process.env.ComSpec ?? 'cmd.exe' : candidate
  const args = needsCommandInterpreter ? ['/d', '/s', '/c', candidate, '--version'] : ['--version']

  let probe
  try {
    probe = spawnSync(file, args, { encoding: 'utf8', timeout: 10000, windowsHide: true })
  } catch {
    return undefined
  }
  if (probe.error !== undefined || probe.status !== 0) return undefined

  // `typst --version` prints e.g. "typst 0.15.1 (…)".
  return /\b(\d+\.\d+\.\d+)\b/.exec(`${probe.stdout ?? ''}${probe.stderr ?? ''}`)?.[1]
}

/**
 * A Typst executable already on this machine, if it is new enough to use.
 *
 * Shipping a 50 MB platform binary is the largest cost this plugin imposes on a
 * user, and anyone who already has Typst installed should not pay it. The
 * version is asked of the binary itself rather than assumed, because a Typst
 * older than the vendored Touying needs gives a confusing failure at compile
 * time instead of a clear refusal here.
 *
 * @param {string} command
 * @returns {{path: string, version: string, source: string, verified: boolean}|undefined}
 */
function findSystemTypst(command) {
  // Resolve the name to a concrete path first: `where` and `which` are the
  // platform's own resolvers, so PATHEXT handling stays correct and the result
  // can be inspected before it is executed.
  const locator = process.platform === 'win32' ? 'where' : 'which'
  let located
  try {
    located = spawnSync(locator, [command], { encoding: 'utf8', timeout: 10000, windowsHide: true })
  } catch {
    return undefined
  }
  if (located.error !== undefined || located.status !== 0) return undefined

  const candidate = `${located.stdout ?? ''}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line !== '' && fs.existsSync(line))
  if (candidate === undefined) return undefined

  const version = readTypstVersion(candidate)
  if (version === undefined) return undefined
  if (compareVersions(version, MIN_TYPST) < 0) return undefined

  return { path: candidate, version, source: `system:${command}`, verified: false }
}

/** Engine failures carry a stable `code` for the model-facing tool layer. */
export class EngineError extends Error {
  constructor(code, message, details = undefined) {
    super(message)
    this.name = 'EngineError'
    this.code = code
    this.details = details
  }
}

/** The vendored Typst package directory (the `--package-path` value). */
export function packagePath() {
  return path.join(PLUGIN_ROOT, 'vendor')
}

/** The vendored deck template directory. */
export function templatePath() {
  return path.join(PLUGIN_ROOT, 'templates')
}

/**
 * Resolve the Typst executable.
 *
 * Order: an explicit `configured` path, then the platform binary this plugin
 * depends on. A configured path is trusted as-is (the user chose it); a
 * dependency-provided binary is hash-verified against the digest the package
 * publishes, and a mismatch refuses to run.
 *
 * @param {{ configured?: string, verify?: boolean }} options
 * @returns {{ path: string, version: string, source: string, verified: boolean, expectedSha256?: string }}
 */
export function resolveBinary(options = {}) {
  const configured = options.configured?.trim()
  if (configured !== undefined && configured !== '') {
    if (!fs.existsSync(configured)) {
      throw new EngineError('binary-missing', `configured typstBinaryPath does not exist: ${configured}`)
    }
    return { path: configured, version: 'unknown', source: 'configured', verified: false }
  }

  const key = `${process.platform}-${process.arch}`

  // An already-installed Typst is preferred when the user asks for it, because
  // it costs no download at all. The bundled binary stays the default so an
  // existing installation keeps behaving exactly as before.
  const useSystemFirst = options.preferSystem === true
  if (useSystemFirst) {
    const system = findSystemTypst(options.systemCommand ?? 'typst')
    if (system !== undefined) return system
  }

  const candidates = PLATFORM_PACKAGES[key]
  if (candidates === undefined) {
    // No bundled binary exists for this platform, so a system Typst is the only
    // remaining option. Try it before refusing: this is what makes a 32-bit or
    // linux-armv7 machine work without the user discovering a config key.
    const system = findSystemTypst(options.systemCommand ?? 'typst')
    if (system !== undefined) return system
    throw new EngineError(
      'platform-unsupported',
      `no bundled Typst binary for platform ${key}, and no Typst ${MIN_TYPST}+ was found on PATH. ` +
        `Install Typst ${REQUIRED_TYPST} or newer, or set typstBinaryPath in the plugin config.`,
    )
  }

  const attempted = []
  for (const name of candidates) {
    let root
    try {
      root = packageRoot(name)
    } catch (error) {
      attempted.push(`${name}: ${String(error?.message ?? error)}`)
      continue
    }
    if (root === undefined) {
      attempted.push(`${name}: installed but no package.json found`)
      continue
    }
    const manifest = readJson(path.join(root, 'package.json'))
    const meta = manifest?.typst ?? {}
    const binary = path.join(root, 'vendor', process.platform === 'win32' ? 'typst.exe' : 'typst')
    if (!fs.existsSync(binary)) {
      attempted.push(`${name}: binary not found at ${binary}`)
      continue
    }
    const expected = typeof meta.binarySha256 === 'string' ? meta.binarySha256.toLowerCase() : undefined
    let verified = false
    if (options.verify !== false && expected !== undefined) {
      const actual = sha256File(binary)
      if (actual !== expected) {
        throw new EngineError(
          'binary-hash-mismatch',
          `the Typst binary failed its integrity check; refusing to execute it. expected ${expected}, got ${actual}`,
          { binary, expected, actual },
        )
      }
      verified = true
    }
    return {
      path: binary,
      version: typeof meta.version === 'string' ? meta.version : 'unknown',
      source: name,
      verified,
      ...(expected !== undefined ? { expectedSha256: expected } : {}),
    }
  }

  // The bundled binary is missing even though this platform has one (usually a
  // skipped optional dependency). A Typst the user already has is a better
  // answer than an error, so try that before giving up.
  const system = findSystemTypst(options.systemCommand ?? 'typst')
  if (system !== undefined) return system

  throw new EngineError(
    'binary-unavailable',
    `no Typst binary is available for ${key}. Install the plugin's platform dependency, install Typst ` +
      `${MIN_TYPST}+ and put it on PATH, or set typstBinaryPath. Tried: ${attempted.join(' | ')}`,
  )
}

/** SHA-256 of a file, lowercase hex. */
export function sha256File(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

/** A `require` bound to this plugin's own directory. */
function pluginRequire() {
  return createRequire(path.join(PLUGIN_ROOT, 'index.js'))
}

/**
 * The directory holding an installed package, found by walking up from its
 * resolved entry point until a `package.json` appears.
 *
 * @param {string} name Package name.
 * @returns {string|undefined}
 */
function packageRoot(name) {
  const entry = pluginRequire().resolve(name)
  let dir = path.dirname(entry)
  for (let depth = 0; depth < 8; depth += 1) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return undefined
}

/** Read and parse JSON, returning undefined on any failure. */
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * Run the Typst compiler.
 *
 * @param {object} options
 * @param {string} options.binary      Executable path.
 * @param {string[]} options.args      Complete argv after the executable.
 * @param {string} options.cwd         Working directory.
 * @param {number} options.timeoutMs   Hard deadline; the process is killed on expiry.
 * @returns {Promise<{ code: number|null, stdout: string, stderr: string, timedOut: boolean }>}
 */
export function runTypst({ binary, args, cwd, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(binary, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      reject(new EngineError('spawn-failed', `could not start the Typst compiler: ${String(error?.message ?? error)}`))
      return
    }
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const cap = 4 * 1024 * 1024
    child.stdout.on('data', (chunk) => { if (stdout.length < cap) stdout += chunk.toString('utf8') })
    child.stderr.on('data', (chunk) => { if (stderr.length < cap) stderr += chunk.toString('utf8') })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(new EngineError('spawn-failed', `the Typst compiler failed to run: ${String(error?.message ?? error)}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut })
    })
  })
}

/**
 * Parse Typst diagnostics into structured entries the model can act on.
 *
 * Typst prints `error: <message>` followed by a source frame containing
 * `┌─ <file>:<line>:<col>`; hints and extra notes follow on their own lines.
 *
 * @param {string} stderr
 * @returns {{ message: string, file?: string, line?: number, column?: number, hint?: string, raw: string }[]}
 */
export function parseDiagnostics(stderr) {
  const lines = stderr.split(/\r?\n/)
  const out = []
  let current = null
  const frame = /^\s*[┌│├]?─*\s*(.+?):(\d+):(\d+)\s*$/
  for (const line of lines) {
    const head = /^(error|warning):\s*(.*)$/.exec(line.trim())
    if (head !== null) {
      if (current !== null) out.push(current)
      current = { severity: head[1], message: head[2].trim(), raw: line }
      continue
    }
    if (current === null) continue
    const at = frame.exec(line)
    if (at !== null && current.file === undefined) {
      current.file = at[1].trim()
      current.line = Number(at[2])
      current.column = Number(at[3])
      continue
    }
    const hint = /^\s*=\s*hint:\s*(.*)$/.exec(line)
    if (hint !== null) {
      current.hint = hint[1].trim()
      continue
    }
    current.raw += `\n${line}`
  }
  if (current !== null) out.push(current)
  return out
}

/** Ensure a directory exists. */
export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** Byte size of a file, or undefined. */
export function fileSize(file) {
  try {
    return fs.statSync(file).size
  } catch {
    return undefined
  }
}

/**
 * Extract Touying's slide-overflow measurements from compiler output.
 *
 * With `breakable: false` Touying measures each slide against the available
 * height and warns when content does not fit:
 *
 *   warning: [touying] detecting slide content overflow at page 3 (slide 3,
 *   subslide 1, content height: 2079.8pt, available height: 383.56pt).
 *
 * That is an objective, per-page verdict — the model does not have to notice
 * overflow by eye — so it is parsed into data rather than left in the log. The
 * measurement cannot be produced while `breakable` is true: a request for it is
 * refused and the slide silently becomes several pages instead.
 *
 * @param {string} stderr Compiler stderr.
 * @returns {{ page?: number, slide?: number, subslide?: number, contentHeightPt?: number, availableHeightPt?: number, ratio?: number, message: string }[]}
 */
export function parseOverflowWarnings(stderr) {
  const text = String(stderr ?? '')
  const out = []

  // "detecting slide content overflow at page 2 (slide 2, subslide 1, content
  // height: 771.8pt, available height: 383.56pt)."
  const overflow = /detecting slide content overflow at page (\d+)\s*\(slide (\d+), subslide (\d+), content height: ([\d.]+)pt, available height: ([\d.]+)pt\)/g
  for (const match of text.matchAll(overflow)) {
    const contentHeightPt = Number(match[4])
    const availableHeightPt = Number(match[5])
    out.push({
      page: Number(match[1]),
      slide: Number(match[2]),
      subslide: Number(match[3]),
      contentHeightPt,
      availableHeightPt,
      ratio: availableHeightPt > 0 ? Math.round((contentHeightPt / availableHeightPt) * 100) / 100 : undefined,
      message: `slide ${match[2]} needs ${contentHeightPt}pt but the frame holds ${availableHeightPt}pt`,
    })
  }

  // "...detecting slide content is empty at page 2 (slide 2, subslide 1,
  // content height: 0pt, ...)". Touying emits this when its measurement finds
  // no height, which in practice means the measurement is unavailable for that
  // slide rather than that the slide has nothing on it. It is reported as
  // unmeasured so a reader does not treat the page as verified-empty.
  const empty = /detecting slide content is empty at page (\d+)\s*\(slide (\d+), subslide (\d+), content height: ([\d.]+)pt, available height: ([\d.]+)pt\)/g
  for (const match of text.matchAll(empty)) {
    if (Number(match[4]) !== 0) continue
    out.push({
      page: Number(match[1]),
      slide: Number(match[2]),
      subslide: Number(match[3]),
      unmeasured: true,
      message: `slide ${match[2]} could not be measured (Touying reported a 0pt content height); check its rendered page by eye`,
    })
  }

  // A refused detection request is itself worth surfacing: it means the deck was
  // compiled with breakable slides, so overflow is silently producing extra
  // pages rather than being reported.
  if (/cannot take effect while `?breakable`? is true/.test(text)) {
    out.push({
      message: 'overflow detection was refused because the deck was compiled with breakable slides; overflowing slides are silently split across extra pages instead of reported',
      refused: true,
    })
  }
  return out
}

/**
 * Count PDF pages without a parser: the page tree carries one `/Type /Page`
 * object per page (never `/Pages`, which is excluded by the trailing guard).
 *
 * @param {string} pdfPath
 * @returns {number|undefined}
 */
export function countPdfPages(pdfPath) {
  try {
    const buf = fs.readFileSync(pdfPath)
    let count = 0
    const needle = Buffer.from('/Type /Page')
    const alt = Buffer.from('/Type/Page')
    for (const n of [needle, alt]) {
      let from = 0
      for (;;) {
        const at = buf.indexOf(n, from)
        if (at === -1) break
        const next = buf[at + n.length]
        // `/Pages` continues with `s`; a page object ends or continues with
        // whitespace or a delimiter.
        if (next !== 0x73) count += 1
        from = at + n.length
      }
      if (count > 0) break
    }
    return count > 0 ? count : undefined
  } catch {
    return undefined
  }
}

export { PLUGIN_ROOT, PLUGIN_ROOT as pluginRoot }
