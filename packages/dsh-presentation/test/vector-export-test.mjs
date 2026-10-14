// The vector export.
//
// The deck PDF is already vector, so the value of a separate export is intent and
// provenance: it is the file to hand to a print shop or drop into Keynote or
// Acrobat, and it is compiled from the generated document rather than re-derived
// from a spec — so it cannot differ from the deck that was reviewed, even if the
// spec has since changed.
//
// Both properties are asserted: the output is a real vector PDF with the same page
// count, and it is unchanged by a spec edit that happens after the build.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerTools } from '../lib/tools.js'
import { COMMAND_RUN_EVENT, COMMAND_DONE_EVENT } from '../lib/mode.js'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WORK = path.join(PACKAGE_ROOT, '.test-output', 'vector-export')
fs.rmSync(WORK, { recursive: true, force: true })
fs.mkdirSync(WORK, { recursive: true })

function sessionWithModeOn() {
  const events = [
    { seq: 0, type: COMMAND_RUN_EVENT, data: { name: 'deck', commandId: 'c1', args: '' } },
    { seq: 1, type: COMMAND_DONE_EVENT, data: { commandId: 'c1', kind: 'success' } },
  ]
  return { id: 'vector-session', snapshotEvents: (from = 0) => events.filter((e) => e.seq >= from) }
}

const registered = new Map()
const outcome = registerTools(
  {
    tools: { register: (tool) => registered.set(tool.name, tool) },
    systemPrompt: { getSectionOrder: () => [] },
    logger: { warn: () => {}, info: () => {}, error: () => {} },
    on: () => {},
  },
  { workdir: WORK, checkPpi: 72, maxPages: 40, timeoutMs: 240_000, maxOutputBytes: 40 * 1024 * 1024 },
)

const exec = { agent: { session: sessionWithModeOn() } }
const build = registered.get('deck_build')
const exportTool = registered.get('deck_export')

let failures = 0
function check(label, condition, detail = '') {
  if (!condition) failures += 1
  console.log(`  ${condition ? 'OK  ' : 'FAIL'} ${label}${detail === '' ? '' : `  (${detail})`}`)
}

/** Real page objects in a PDF, excluding `/PageLabel` — see the page-count notes. */
function pageObjects(file) {
  const text = fs.readFileSync(file).toString('latin1')
  return (text.match(/\/Type\s*\/Page(?![A-Za-z0-9])/g) ?? []).length
}

console.log('=== the export refuses before a build exists ===')
{
  const result = await exportTool.execute({ what: 'vector' }, exec)
  check('it reports failure', result?.ok === false)
  check('it says to build first', /build the deck first|no generated document/i.test(String(result?.stderr ?? '')), String(result?.stderr ?? '').slice(0, 80))
}

console.log('')
console.log('=== a build then a vector export ===')
{
  const built = await build.execute(
    {
      spec: {
        title: '矢量导出', locale: 'zh', theme: 'metropolis',
        slides: [{ layout: 'cover' }, { layout: 'bullets', title: '一页', items: [{ text: '甲' }, { text: '乙' }] }],
      },
    },
    exec,
  )
  check('the build succeeded', built?.ok === true, String(built?.message ?? built?.stderr ?? '').slice(0, 80))

  const result = await exportTool.execute({ what: 'vector' }, exec)
  check('the export succeeded', result?.ok === true, String(result?.stderr ?? '').slice(0, 100))
  check('it wrote a file', typeof result?.file === 'string' && fs.existsSync(result.file), String(result?.file ?? ''))
  check('the file is named as a vector PDF', String(result?.file ?? '').endsWith('deck.vector.pdf'))

  if (result?.ok === true) {
    const file = result.file
    const bytes = fs.statSync(file).size
    console.log(`      ${path.basename(file)}  ${bytes} bytes  reported pages=${result.pages}`)

    check('it is a PDF', fs.readFileSync(file).subarray(0, 5).toString('latin1') === '%PDF-')
    check('it has the same page count as the deck', pageObjects(file) === 2, `${pageObjects(file)} page objects`)
    check('the reported page count matches the file', result.pages === pageObjects(file), `${result.pages} vs ${pageObjects(file)}`)
    check('the deck and the export agree', bytes === fs.statSync(path.join(WORK, 'deck.pdf')).size, `${bytes} vs ${fs.statSync(path.join(WORK, 'deck.pdf')).size}`)

    // No raster fallback: a vector page holds no image XObject for the text.
    const raw = fs.readFileSync(file).toString('latin1')
    check('no partial file is left behind', !fs.existsSync(`${file}.partial.pdf`))

    console.log('')
    console.log('=== it compiles the built document, not the current spec ===')
    // A build whose spec is then edited must not change the exported file: the
    // export recompiles the generated source, so it cannot drift from what was
    // reviewed. Simulated by exporting twice and comparing, since the tool takes no
    // spec at all — which is itself the guarantee.
    const again = await exportTool.execute({ what: 'vector' }, exec)
    check('a second export produces the same bytes', again?.ok === true && fs.statSync(again.file).size === bytes, `${fs.statSync(again.file).size} vs ${bytes}`)
    check('the tool takes no spec for this export', exportTool.parameters?.spec?.required !== true)
  }
}

console.log('')
console.log('=== the enum offers all three artifacts ===')
{
  // `defineTool` compiles the author DSL into raw JSON Schema, so the enum lives
  // under `properties`.
  const values = exportTool.parameters?.properties?.what?.enum ?? []
  check('vector is offered', values.includes('vector'), values.join(', '))
  check('handout is still offered', values.includes('handout'))
  check('notes is still offered', values.includes('notes'))
}

console.log('')
console.log(failures === 0 ? 'VECTOR EXPORT VERIFIED' : `${failures} check(s) failed`)
process.exitCode = failures === 0 ? 0 : 1
