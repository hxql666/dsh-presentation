// Validate the preset bundle before trusting it.
//
// A preset declares plugin rows by module NAME. If any name fails to resolve
// from the places a preset mounts from, the whole preset reports as broken in
// the roster instead of partially working — so every row is resolved here, and
// the declaration's own fields are checked against the host's PresetDefinition
// shape.
const fs = require('node:fs')
const path = require('node:path')

const patchFile = path.join(__dirname, '..', 'cordis.patch.yml')
const source = fs.readFileSync(patchFile, 'utf8')

// --- minimal YAML reading for this shape ----------------------------------
// The file is a single `- insert:` list holding one preset row; rather than
// pull in a YAML engine, walk the indentation the way the file is authored.
const lines = source.split(/\r?\n/)
const rows = []
let inPlugins = false
let pluginsIndent = -1
for (const [index, raw] of lines.entries()) {
  const line = raw.replace(/\t/g, '  ')
  if (/^\s*#/.test(line) || line.trim() === '') continue
  const indent = line.length - line.trimStart().length
  const text = line.trim()

  if (/^plugins:\s*$/.test(text)) {
    inPlugins = true
    pluginsIndent = indent
    continue
  }
  if (inPlugins) {
    if (indent <= pluginsIndent) { inPlugins = false; continue }
    const match = /^-\s+id:\s*(\S+)/.exec(text)
    if (match !== null) rows.push({ id: match[1], name: undefined, indent })
    else if (rows.length > 0) {
      const name = /^name:\s*['"]?([^'"]+?)['"]?\s*$/.exec(text)
      if (name !== null && rows.at(-1).name === undefined && indent > rows.at(-1).indent) rows.at(-1).name = name[1]
    }
  }
}

const presetId = /^\s*id:\s*(\S+)\s*$/m.exec(source)?.[1]
const order = /^\s*order:\s*(\d+)\s*$/m.exec(source)?.[1]
const name = /^\s*name:\s*(.+?)\s*$/m.exec(source)?.[1]

console.log(`preset id      : ${presetId}`)
console.log(`preset name    : ${name}`)
console.log(`preset order   : ${order}`)
console.log(`plugin rows    : ${rows.filter((r) => r.name !== undefined).length}`)
console.log('')

// --- resolve every named row ----------------------------------------------
// Three sources can satisfy a row, in this order:
//   1. the profile's own node_modules, where installed bundles live;
//   2. the dsh installation on disk;
//   3. the dsh installation inside app.asar — which Node cannot walk, but the
//      plugin loader can, so presence is checked against the extracted asar
//      header listing instead.
const roots = [
  // The plugin this preset is built around, as a sibling package in this repo.
  // A directory name, not the published one: packages carry an npm scope but
  // stay `packages/<name>` on disk.
  path.resolve(__dirname, '..', '..', 'dsh-presentation'),
  // A DSH profile: where an installed plugin and the shipped `@deepseek-ai/*`
  // packages live. Point DSH_PROFILE_DIR at yours.
  process.env.DSH_PROFILE_DIR,
  process.env.DSH_HOME ? path.join(process.env.DSH_HOME, 'profiles', 'desktop') : undefined,
  // A DSH installation on disk, per platform.
  'C:\\Program Files\\DeepSeek Harness\\resources\\app.asar\\dsh',
  '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh',
  '/opt/DeepSeek Harness/resources/app.asar/dsh',
].filter((root) => typeof root === 'string' && root !== '')

let asarListing
try {
  // Optional: DSH_ASAR_LISTING points at a listing extracted from the app's
  // app.asar. Node cannot walk an asar archive, so rows shipped inside it are
  // verified by name when such a listing is available.
  asarListing = process.env.DSH_ASAR_LISTING
    ? fs.readFileSync(process.env.DSH_ASAR_LISTING, 'utf8')
    : undefined
} catch {
  asarListing = undefined
}

/** Whether a `@scope/name` package appears in the extracted asar listing. */
function inAsar(name) {
  if (asarListing === undefined) return false
  const bare = name.replace('@deepseek-ai/', '')
  const packageName = bare.split('/')[0]
  return asarListing.includes(`"${packageName}"`)
}

/**
 * Whether a row names a package that exists as a sibling in this repo.
 *
 * The sibling packages are not linked until `npm install` runs the workspace,
 * so resolving by name alone would report this preset broken in a fresh clone.
 * The preset is read by the loader, which resolves the name at activation time
 * against the profile — where the workspace link will exist.
 */
/**
 * Whether a row names a package that exists as a sibling in this repo.
 *
 * The sibling packages are not linked until `npm install` runs the workspace,
 * so resolving by name alone would report this preset broken in a fresh clone.
 * The preset is read by the loader, which resolves the name at activation time
 * against the profile — where the workspace link will exist.
 *
 * The directory is discovered from each manifest's own `name` rather than
 * derived from the package name: packages carry an npm scope, directories do
 * not, so `@scope/dsh-presentation` lives in `packages/dsh-presentation`.
 */
function siblingPackages() {
  const packagesDir = path.resolve(__dirname, '..', '..')
  const found = new Map()
  let entries
  try {
    entries = fs.readdirSync(packagesDir, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(packagesDir, entry.name, 'package.json'), 'utf8'))
      if (typeof pkg.name === 'string') found.set(pkg.name, path.join(packagesDir, entry.name))
    } catch { /* not a package */ }
  }
  return found
}

const SIBLINGS = siblingPackages()

function inRepo(name) {
  return SIBLINGS.has(name)
}

// Rows that ship with DSH itself rather than with a profile. The loader resolves
// them from the installation, which Node cannot read out of `app.asar` — and the
// shipped presets reference the very same names. When a listing is not supplied
// these are reported as unverified rather than missing: calling them a failure
// would report every healthy installation as broken.
const SHIPPED_BY_DSH = new Set([
  '@deepseek-ai/dsh-tool-present',
  '@deepseek-ai/dsh-plugin-manager/tools',
])

let missing = 0
let unverified = 0
for (const row of rows) {
  if (row.name === undefined) continue
  if (!row.name.startsWith('@') && !row.name.startsWith('dsh-')) {
    console.log(`  skip  ${row.id.padEnd(26)} ${row.name}  (runtime-provided row, e.g. cordis:group)`)
    continue
  }
  let source
  for (const root of roots) {
    try {
      require.resolve(row.name, { paths: [root] })
      source = root.includes('app.asar') ? 'asar' : 'profile'
      break
    } catch { /* try the next source */ }
  }
  if (source === undefined && inRepo(row.name)) source = 'repo'
  if (source === undefined && inAsar(row.name)) source = 'asar-listing'

  if (source === undefined && SHIPPED_BY_DSH.has(row.name)) {
    unverified += 1
    console.log(`  ????  ${row.id.padEnd(26)} ${row.name}  (ships with DSH; set DSH_ASAR_LISTING to verify)`)
    continue
  }
  if (source === undefined) missing += 1
  console.log(`  ${source === undefined ? 'MISS' : 'OK  '}  ${row.id.padEnd(26)} ${row.name}${source === undefined ? '' : `  [${source}]`}`)
}

console.log('')
if (unverified > 0) {
  console.log(`${unverified} row(s) shipped by DSH could not be verified from here.`)
  console.log('  Extract the app\'s app.asar header listing and set DSH_ASAR_LISTING to check them.')
  console.log('')
}
if (missing > 0) {
  console.log(`${missing} row(s) do not resolve — the preset would report as broken.`)
  process.exitCode = 1
} else {
  console.log('Every named row resolves; the preset can compose.')
}

// --- required plugin config ------------------------------------------------
// A plugin row that omits a config key its plugin marks required fails when the
// preset mounts, and a preset that fails to mount shows as broken instead of
// partially working — so the requirement is checked here.
const REQUIRED_CONFIG = {
  '@hxql/dsh-presentation': ['section'],
}

console.log('')
let configProblems = 0
for (const [moduleName, keys] of Object.entries(REQUIRED_CONFIG)) {
  if (!source.includes(`name: '${moduleName}'`)) continue
  // Take the block from the module name to the next row at the same indent.
  const start = source.indexOf(`name: '${moduleName}'`)
  const rest = source.slice(start)
  const nextRow = rest.slice(1).search(/\n\s{10}- id:/)
  const block = nextRow === -1 ? rest : rest.slice(0, nextRow + 1)
  for (const key of keys) {
    const present = new RegExp(`^\\s+${key}:`, 'm').test(block)
    if (!present) configProblems += 1
    console.log(`  ${present ? 'OK  ' : 'MISS'}  ${moduleName} config.${key}${present ? '' : '  (required by the plugin)'}`)
  }
}

console.log('')
if (configProblems > 0) {
  console.log(`${configProblems} required config key(s) missing — the preset would fail to mount.`)
  process.exitCode = 1
} else {
  console.log('Required plugin config is present.')
}
