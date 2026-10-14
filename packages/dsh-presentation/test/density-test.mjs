// Overflow detection, which the plugin otherwise has none of.
//
// The layouts compose with grid and stack, and Touying measures a 0pt content
// height for that composition, so its own overflow detection reports nothing for a
// page whose content has visibly run past the bottom — confirmed by rendering a
// bullets page with fourteen long items, whose last line drew through the footer,
// with no diagnostic anywhere. `deck_check` now measures how much of each page is
// ink and names the pages that are packed.
//
// The decoder is asserted against the PNG header, and the threshold is asserted
// against pages measured at both ends, so the check cannot pass by measuring
// nothing.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerTools } from '../lib/tools.js'
import { decodePng, inkFraction } from '../lib/png.js'
import { COMMAND_RUN_EVENT, COMMAND_DONE_EVENT } from '../lib/mode.js'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WORK = path.join(PACKAGE_ROOT, '.test-output', 'density-check')
fs.rmSync(WORK, { recursive: true, force: true })
fs.mkdirSync(WORK, { recursive: true })

function sessionWithModeOn() {
  const events = [
    { seq: 0, type: COMMAND_RUN_EVENT, data: { name: 'deck', commandId: 'c1', args: '' } },
    { seq: 1, type: COMMAND_DONE_EVENT, data: { commandId: 'c1', kind: 'success' } },
  ]
  return { id: 'density-session', snapshotEvents: (from = 0) => events.filter((e) => e.seq >= from) }
}

const registered = new Map()
registerTools(
  {
    tools: { register: (tool) => registered.set(tool.name, tool) },
    systemPrompt: { getSectionOrder: () => [] },
    logger: { warn: () => {}, info: () => {}, error: () => {} },
    on: () => {},
  },
  { workdir: WORK, checkPpi: 72, maxPages: 40, timeoutMs: 240_000 },
)

const exec = { agent: { session: sessionWithModeOn() } }
const build = registered.get('deck_build')
const check = registered.get('deck_check')

/** The text a tool's render callback produces, whatever shape it returns. */
function renderedText(tool, value) {
  const out = tool.output.render({}, value)
  if (typeof out === 'string') return out
  if (Array.isArray(out)) return out.map((part) => String(part?.text ?? '')).join('\n')
  return String(out?.text ?? '')
}

let failures = 0
function ok(label, condition, detail = '') {
  if (!condition) failures += 1
  console.log(`  ${condition ? 'OK  ' : 'FAIL'} ${label}${detail === '' ? '' : `  (${detail})`}`)
}

const long = '这是一条相当长的要点内容，用来占据页面上的一整行空间，以便把版面填满。'
const item = (text) => ({ text })

console.log('=== the decoder matches the PNG header ===')
{
  await build.execute({ spec: { title: 'd', locale: 'zh', slides: [{ layout: 'cover' }] } }, exec)
  const result = await check.execute({}, exec)
  const file = result.images[0]
  const buffer = fs.readFileSync(file)
  const decoded = decodePng(buffer)
  ok('width matches IHDR', decoded.width === buffer.readUInt32BE(16), `${decoded.width} vs ${buffer.readUInt32BE(16)}`)
  ok('height matches IHDR', decoded.height === buffer.readUInt32BE(20), `${decoded.height} vs ${buffer.readUInt32BE(20)}`)
  ok('the buffer holds every pixel', decoded.pixels.length === decoded.width * decoded.height * decoded.channels)
  ok('density is reported per page', Array.isArray(result.density) && result.density.length === result.images.length)
}

console.log('')
console.log('=== a normal page is not flagged ===')
{
  const built = await build.execute(
    { spec: { title: 'normal', locale: 'zh', slides: [{ layout: 'cover' }, { layout: 'bullets', title: '正常', items: [item('甲'), item('乙'), item('丙')] }] } },
    exec,
  )
  ok('it builds', built.ok === true, String(built.message ?? built.stderr ?? '').slice(0, 80))
  const result = await check.execute({}, exec)
  const densest = Math.max(...result.density.map((d) => d.ink))
  ok('no page is reported as too dense', result.tooDense === undefined, `densest ${densest}`)
  ok('the densest page stays under the threshold', densest < 0.19, String(densest))
}

console.log('')
console.log('=== an overfull page is flagged ===')
{
  const built = await build.execute(
    {
      spec: {
        title: 'packed', locale: 'zh',
        slides: [{ layout: 'cover' }, { layout: 'bullets', title: '十四条', items: Array.from({ length: 14 }, () => item(long)) }],
      },
    },
    exec,
  )
  ok('it builds (a packed page is not an error)', built.ok === true, String(built.message ?? built.stderr ?? '').slice(0, 80))
  const result = await check.execute({}, exec)
  const flagged = result.tooDense ?? []
  ok('the packed page is reported', flagged.length > 0, flagged.join(' | ').slice(0, 90))
  ok('the report names it as overfull', flagged.some((line) => line.includes('page-2')))
  const worst = Math.max(...result.density.map((d) => d.ink))
  ok('its density is above the threshold', worst >= 0.19, String(worst))
}

console.log('')
console.log('=== the tool text carries the warning to the model ===')
{
  const result = await check.execute({}, exec)
  const body = renderedText(check, result)
  ok('the warning appears in the rendered output', body.includes('WARNING'), body.includes('WARNING') ? '' : body.slice(0, 90))
  ok('it tells the model what to do', /Trim the items|split the page/.test(body))
}

console.log('')
console.log('=== a sparse deck stays silent ===')
{
  await build.execute({ spec: { title: 'sparse', locale: 'zh', slides: [{ layout: 'cover' }, { layout: 'quote', quote: '一句话。' }] } }, exec)
  const result = await check.execute({}, exec)
  const rendered = check.output.render({}, result)
  const body = typeof rendered === 'string' ? rendered : String(rendered?.text ?? '')
  ok('no warning is emitted', !body.includes('WARNING'))
}

console.log('')
console.log(failures === 0 ? 'OVERFLOW DETECTION VERIFIED' : `${failures} check(s) failed`)
process.exitCode = failures === 0 ? 0 : 1
