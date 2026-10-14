// Exercise `deck_build` itself, not only the validator it calls.
//
// The validator is covered directly in `timeline-test`. What matters here is that
// the tool consults it: a spec that could only render empty must be refused before
// anything is compiled, and an unread key must come back as a warning on an
// otherwise successful build.
//
// The mode is established the way the real application establishes it — by logging
// a `/deck` command and its successful completion — so the test passes through the
// same gate the tool uses in production rather than a shortcut into its state.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerTools } from '../lib/tools.js'
import { COMMAND_RUN_EVENT, COMMAND_DONE_EVENT } from '../lib/mode.js'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WORK = path.join(PACKAGE_ROOT, '.test-output', 'build-tool')
fs.rmSync(WORK, { recursive: true, force: true })
fs.mkdirSync(WORK, { recursive: true })

/** A session whose log turns presentation mode on, as `/deck` would. */
function sessionWithModeOn() {
  const events = [
    { seq: 0, type: COMMAND_RUN_EVENT, data: { name: 'deck', commandId: 'c1', args: '' } },
    { seq: 1, type: COMMAND_DONE_EVENT, data: { commandId: 'c1', kind: 'success' } },
  ]
  return { id: 'test-session', snapshotEvents: (from = 0) => events.filter((e) => e.seq >= from) }
}
const session = sessionWithModeOn()

const registered = new Map()
const ctx = {
  tools: { register: (tool) => registered.set(tool.name, tool) },
  systemPrompt: { getSectionOrder: () => [] },
  logger: { warn: () => {}, info: () => {}, error: () => {} },
  on: () => {},
}

const outcome = registerTools(ctx, { workdir: WORK, checkPpi: 90, maxPages: 40, timeoutMs: 240_000 })
console.log(`  registered: ${outcome.registered.join(', ')}`)
console.log(`  skipped:    ${outcome.skipped.length === 0 ? '(none)' : JSON.stringify(outcome.skipped)}`)
if (outcome.skipped.length > 0) process.exitCode = 1

const buildTool = registered.get('deck_build')
if (buildTool === undefined) {
  console.log('  FAIL deck_build was not registered')
  process.exit(1)
}

const exec = { agent: { session } }
let failures = 0
function check(label, condition, detail = '') {
  if (!condition) failures += 1
  console.log(`  ${condition ? 'OK  ' : 'FAIL'} ${label}${detail === '' ? '' : `  (${detail})`}`)
}

console.log('')
console.log('=== a page that could only render empty is refused ===')
{
  const before = fs.existsSync(path.join(WORK, 'deck.pdf'))
  const result = await buildTool.execute(
    { spec: { title: 'incomplete', slides: [{ layout: 'cover' }, { layout: 'timeline', title: '时间线' }] } },
    exec,
  )
  check('the tool reports failure', result?.ok === false)
  check('it names the problem', result?.error === 'spec-incomplete', String(result?.error))
  check('the problem explains which page', (result?.problems ?? []).some((p) => p.includes('timeline')))
  check('no PDF was produced', fs.existsSync(path.join(WORK, 'deck.pdf')) === before)
  console.log(`      ${String(result?.message ?? '').split('\n')[0].slice(0, 96)}`)
}

console.log('')
console.log('=== an unread key warns on a successful build ===')
{
  const result = await buildTool.execute(
    {
      spec: {
        title: 'typo', locale: 'zh',
        slides: [{ layout: 'cover' }, { layout: 'bullets', title: 'x', items: [{ text: 'a' }], bullet: ['mistyped'] }],
      },
    },
    exec,
  )
  check('the build succeeded', result?.ok === true, result?.ok === true ? '' : String(result?.stderr ?? result?.message ?? '').slice(0, 90))
  const warnings = result?.warnings ?? []
  check('the unread key is reported', warnings.some((w) => w.includes('"bullet"')), warnings[0]?.slice(0, 76) ?? '(none)')
  check('a PDF exists', fs.existsSync(path.join(WORK, 'deck.pdf')) === true)
}

console.log('')
console.log('=== a complete timeline builds ===')
{
  const result = await buildTool.execute(
    {
      spec: {
        title: 'good', locale: 'zh',
        slides: [{ layout: 'cover' }, { layout: 'timeline', title: '时间线', items: [{ when: '一月', what: '立项' }] }],
      },
    },
    exec,
  )
  check('the build succeeded', result?.ok === true, String(result?.message ?? result?.stderr ?? '').slice(0, 90))
  check('two pages', result?.pages === 2, String(result?.pages))
  check('it produced the PDF', typeof result?.pdf === 'string' && fs.existsSync(result.pdf))
}

console.log('')
console.log('=== the mode gate is real ===')
{
  const closed = { agent: { session: { id: 'other', snapshotEvents: () => [] } } }
  let refused = false
  try {
    const result = await buildTool.execute({ spec: { title: 'x', slides: [{ layout: 'cover' }] } }, closed)
    refused = result?.ok === false || String(result?.text ?? '').includes('presentation')
  } catch (error) {
    refused = true
  }
  check('a session without the mode is refused', refused)
}

console.log('')
console.log(failures === 0 ? 'DECK_BUILD SPEC CHECK VERIFIED' : `${failures} check(s) failed`)
process.exitCode = failures === 0 ? 0 : 1
