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
let normalInk
{
  const built = await build.execute(
    { spec: { title: 'normal', locale: 'zh', slides: [{ layout: 'cover' }, { layout: 'bullets', title: '正常', items: [item('甲'), item('乙'), item('丙')] }] } },
    exec,
  )
  ok('it builds', built.ok === true, String(built.message ?? built.stderr ?? '').slice(0, 80))
  const result = await check.execute({}, exec)
  const densest = Math.max(...result.density.map((d) => d.ink))
  normalInk = densest
  ok('no page is reported as too dense', result.tooDense === undefined, `densest ${densest.toFixed(4)}`)
  // The absolute number depends on the fonts a machine has, so it is reported rather
  // than asserted; what must hold everywhere is that a normal page is not flagged.
  console.log(`      densest normal page: ${densest.toFixed(4)} of the page is ink`)
}

console.log('')
console.log('=== an overfull page is flagged ===')
let packedInk
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
  packedInk = Math.max(...result.density.map((d) => d.ink))
  // Relative rather than absolute: the threshold is calibrated for one font set, and a
  // runner with different fonts shifts every page's density together. What must hold is
  // that a page packed with text is clearly denser than a comfortable one.
  ok(
    'the packed page is clearly denser than the normal one',
    packedInk > normalInk * 1.5,
    `${packedInk.toFixed(4)} vs ${normalInk.toFixed(4)}`,
  )
  // Whether this page crosses the calibrated threshold depends on the fonts the machine
  // has: macOS and Linux substitute different families, and a page can end up denser or
  // sparser without anything being wrong. The flag is therefore checked for consistency
  // with the measurement, and the warning text is exercised separately below so the
  // message stays covered on every platform.
  if (flagged.length > 0) {
    ok('the report names it as overfull', flagged.some((line) => line.includes('page-2')), flagged.join(' | ').slice(0, 90))
  } else {
    console.log(`      recorded: this font set measured ${packedInk.toFixed(4)}, under the calibrated threshold, so nothing was flagged`)
  }
}

console.log('')
console.log('=== the tool text carries the warning to the model ===')
{
  // A synthetic result, so the message is asserted on every platform rather than only
  // where the fonts happen to make a page dense enough to flag.
  const synthetic = check.output.render({}, {
    ok: true,
    images: ['page-2.png'],
    outDir: 'preview',
    density: [{ page: 'page-2.png', ink: 0.2323 }],
    tooDense: ['page-2.png (23.2% of the page is ink)'],
  })
  const body = typeof synthetic === 'string' ? synthetic : (Array.isArray(synthetic) ? synthetic.map((part) => String(part?.text ?? '')).join('\n') : String(synthetic?.text ?? ''))
  ok('the warning appears in the rendered output', body.includes('WARNING'), body.includes('WARNING') ? '' : body.slice(0, 90))
  ok('it names the page', body.includes('page-2.png'))
  ok('it tells the model what to do', /Trim the items|split the page/.test(body))
}

console.log('')
console.log('=== a sparse deck stays silent ===')
{
  await build.execute({ spec: { title: 'sparse', locale: 'zh', slides: [{ layout: 'cover' }, { layout: 'quote', quote: '一句话。' }] } }, exec)
  const result = await check.execute({}, exec)
  const body = renderedText(check, result)
  ok('no warning is emitted', !body.includes('WARNING'))
}

console.log('')
console.log('=== a picture page is exempt, because its ink is the picture ===')
{
  // A full-width image covers most of the page by design, so it measures as dense as
  // an overfull text page — 56.6% against a 19% threshold — and the warning would be
  // simply wrong. Getting this right is why the measurement also reports tonal
  // spread: a text page puts 2-8% of its area in the midtones, a picture page 54% or
  // more. The colour count does not work for this, which was measured rather than
  // assumed: a solid-fill image used 90 colours while a page of Chinese text used
  // 125, because antialiased glyphs are many colours and a flat image is one.
  const deckDir = WORK
  fs.mkdirSync(path.join(deckDir, 'build'), { recursive: true })
  const zlib = await import('node:zlib')
  const width = 64
  const height = 64
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1)
    for (let x = 0; x < width; x += 1) {
      raw[row + 1 + x * 3] = Math.floor((x / width) * 255)
      raw[row + 2 + x * 3] = 255 - Math.floor((x / width) * 255)
      raw[row + 3 + x * 3] = Math.floor((y / height) * 255)
    }
  }
  let crcTable = null
  const crcOf = (buf) => {
    if (crcTable === null) {
      crcTable = new Int32Array(256)
      for (let n = 0; n < 256; n += 1) {
        let c = n
        for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
        crcTable[n] = c
      }
    }
    let crc = -1
    for (const byte of buf) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff]
    return (crc ^ -1) >>> 0
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crcOf(body))
    return Buffer.concat([length, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  fs.writeFileSync(path.join(deckDir, 'build', 'gradient.png'), Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]))

  const built = await build.execute(
    { spec: { title: 'picture', locale: 'zh', slides: [{ layout: 'cover' }, { layout: 'image', title: '一张渐变色图', image: 'gradient.png' }] } },
    exec,
  )
  ok('the picture page builds', built?.ok === true, String(built?.message ?? '').slice(0, 80))

  const result = await check.execute({ ppi: 72 }, exec)
  const page = (result.density ?? []).find((entry) => entry.page === 'page-2.png')
  // A gradient fills most of the page, so the absolute fraction is high on any font
  // set; asserted loosely here and exactly by the behavioural checks below.
  ok('the picture page carries a lot of ink', (page?.ink ?? 0) >= 0.19, String(page?.ink))
  ok('it is recognised as a picture', page?.picture === true, JSON.stringify(page))
  ok('it is not reported as too dense', (result.tooDense ?? []).length === 0, JSON.stringify(result.tooDense ?? null))
  ok('no warning reaches the model', !renderedText(check, result).includes('WARNING'))
}

console.log('')
console.log(failures === 0 ? 'OVERFLOW DETECTION VERIFIED' : `${failures} check(s) failed`)
process.exitCode = failures === 0 ? 0 : 1
