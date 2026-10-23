// Does the font stack actually change the rendered page?
//
// The earlier check confirmed the value reaches the generated source — `font-stack:
// "serif"` is emitted — but a value reaching the source is not the same as the page
// looking different. The test run reported it could not see a difference between
// scenes, and that report was never resolved either way. This measures the rendered
// page rather than the source.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildDeckPdf, renderDeckPages } from '../lib/build.js'
import { inkFraction } from '../lib/png.js'
import { resolveBinary } from '../lib/engine.js'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WORK = path.join(PACKAGE_ROOT, '.test-output', 'fonts')
fs.rmSync(WORK, { recursive: true, force: true })
fs.mkdirSync(WORK, { recursive: true })

let failures = 0
function check(label, condition, detail = '') {
  if (!condition) failures += 1
  console.log(`  ${condition ? 'OK  ' : 'FAIL'} ${label}${detail === '' ? '' : `  (${detail})`}`)
}

/** Build one page with a given font stack and return the page image. */
async function renderWithStack(stack) {
  const label = stack ?? 'default'
  const dir = path.join(WORK, label)
  fs.mkdirSync(dir, { recursive: true })
  const spec = {
    title: 'fonts', locale: 'zh', theme: 'metropolis',
    slides: [{ layout: 'cover' }, { layout: 'bullets', title: '字体测试', items: [{ text: '汉字与 Latin 混排 Aa Bb 1234' }] }],
  }
  // Omitting `fontStack` is how the default is exercised; passing `undefined`
  // literally would be a string that names no stack.
  if (stack !== undefined) spec.fontStack = stack
  const built = await buildDeckPdf({ spec, buildDir: dir, outFile: path.join(dir, 'deck.pdf') })
  if (built.ok !== true) return { ok: false, label, error: String(built.stderr ?? '').split('\n').find((l) => l.includes('error')) ?? '' }
  const rendered = await renderDeckPages({ typFile: built.typFile, buildDir: dir, outputPattern: path.join(dir, 'p-{p}.png'), ppi: 110 })
  const source = fs.readFileSync(path.join(dir, 'body.typ'), 'utf8')
  const page = path.join(dir, 'p-2.png')
  return {
    ok: true,
    label,
    dir,
    file: page,
    bytes: fs.statSync(page).size,
    ink: inkFraction(page),
    // The stack name as the generated document declares it.
    declared: /font-stack: "([\w-]+)"/.exec(source)?.[1] ?? '(not found)',
  }
}

// The stacks are a table in the template, so the families can be read from there
// rather than guessed. Only the `dsh-font-stacks` table is read: a looser pattern
// also matches the locale table, whose entries are dictionaries, and then the test
// tries to render a stack called `zh`.
const deckTemplate = fs.readFileSync(path.join(PACKAGE_ROOT, 'templates', 'deck.typ'), 'utf8')
const STACKS_TABLE = /#let dsh-font-stacks = \(([\s\S]*?)\n\)/.exec(deckTemplate)?.[1] ?? ''
const STACKS = [...STACKS_TABLE.matchAll(/^\s{2}([\w-]+): \(([^)]*)\),$/gm)].map((m) => ({
  name: m[1],
  families: m[2].split(',').map((f) => f.trim().replace(/^"|"$/g, '')).filter((f) => f !== ''),
}))
if (STACKS.length === 0) {
  console.log('  FAIL: no font stacks were read from the template')
  process.exit(1)
}
console.log('=== the stacks the template declares ===')
for (const stack of STACKS) console.log(`  ${stack.name.padEnd(10)} ${stack.families.join(' | ')}`)

console.log('')
console.log('=== each stack renders ===')
const results = new Map()
for (const stack of [...STACKS.map((s) => s.name), undefined]) {
  const result = await renderWithStack(stack)
  results.set(result.label, result)
  if (!result.ok) {
    console.log(`  ${result.label.padEnd(10)} BUILD FAILED  ${result.error.slice(0, 70)}`)
    continue
  }
  console.log(`  ${result.label.padEnd(10)} ${String(result.bytes).padStart(6)} B  ink=${result.ink.ink.toFixed(4)}  declared=${result.declared}`)
}

console.log('')
console.log('=== do the stacks differ from each other? ===')
const images = [...results.values()].filter((r) => r.ok === true)
check('every stack built', images.length === STACKS.length + 1, `${images.length} of ${STACKS.length + 1}`)

const declared = STACKS.map((stack) => results.get(stack.name)?.declared)
check('every named stack declares itself in the source', declared.every((name, index) => name === STACKS[index].name), declared.join(', '))

// Distinct families are the mechanism; distinct pixels are the effect. The effect only
// shows where the families exist: on a machine missing every family a stack names,
// Typst substitutes and two stacks can legitimately render identically. So the pixels
// are compared where the resolved families differ, and substitution is recorded
// otherwise — asserting a difference there would test the runner's font collection,
// not this plugin.
const pixels = new Map(images.map((r) => [r.label, fs.readFileSync(r.file).toString('latin1')]))

/**
 * The family Typst will actually use for a stack: the first one installed.
 * `undefined` means every named family is missing and Typst falls back to its default.
 *
 * The binary is resolved through the plugin so the test uses whichever Typst this
 * platform installed. A hardcoded `@flukxr/typst-cli-win32-x64` path worked only on
 * Windows, which is the one platform CI did not need it on.
 */
const installedList = (() => {
  const binary = resolveBinary()
  const listed = spawnSync(binary.path, ['fonts'], { encoding: 'utf8' })
  return String(listed.stdout ?? '')
})()
const firstAvailable = (stack) => stack.families.find((family) => installedList.includes(family))

const names = STACKS.map((s) => s.name)
for (let i = 0; i < names.length; i += 1) {
  for (let j = i + 1; j < names.length; j += 1) {
    const left = STACKS[i]
    const right = STACKS[j]
    const differs = firstAvailable(left) !== firstAvailable(right)
    if (!differs) {
      console.log(`  recorded: ${left.name} and ${right.name} resolve to the same family here (${firstAvailable(left) ?? 'Typst default'}), so their pages may match`)
      continue
    }
    check(
      `${names[i]} and ${names[j]} render differently`,
      pixels.get(names[i]) !== pixels.get(names[j]),
      pixels.get(names[i]) === pixels.get(names[j]) ? 'identical pixels' : 'different',
    )
  }
}

// The declaration is platform-independent and must hold everywhere.
check(
  'every stack declares its own family list',
  new Set(STACKS.map((stack) => stack.families.join('|'))).size === STACKS.length,
)

// An unspecified stack must resolve to the template's default, not to a fourth
// stack of its own.
check(
  'an unspecified stack uses the default',
  results.get('default')?.declared === 'sans',
  String(results.get('default')?.declared),
)

console.log('')
console.log('=== is a named family actually installed? ===')
{
  // The stacks name families that may not be present. Typst substitutes without
  // warning, so a deck can render in a different face than the spec asked for and
  // nothing says so. This records which families are present, because "the font
  // stack works" and "the font you asked for was used" are different claims.
  // Recorded rather than asserted: which fonts a machine has is not this project's
  // to control, and CI runners differ from a desktop.
  const installed = installedList
  let missing = 0
  for (const stack of STACKS) {
    const present = stack.families.filter((family) => installed.includes(family))
    const absent = stack.families.filter((family) => !installed.includes(family))
    if (absent.length > 0) missing += 1
    console.log(`  ${stack.name.padEnd(10)} present: ${present.join(', ') || '(none)'}`)
    if (absent.length > 0) console.log(`  ${''.padEnd(10)} absent:  ${absent.join(', ')}`)
  }
  console.log('')
  console.log(`  ${missing} of ${STACKS.length} stacks name a family that is not installed on this machine.`)
  console.log('  Typst substitutes silently, so a deck can render in a different face than')
  console.log('  requested; the fallback order in each stack is what keeps that acceptable.')
}

console.log('')
console.log(`artifacts: ${WORK}`)
console.log(failures === 0 ? 'FONT STACKS VERIFIED' : `${failures} check(s) failed`)
process.exitCode = failures === 0 ? 0 : 1
