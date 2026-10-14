// The two page types added for image-heavy and document-style decks.
//
// `image` is a full-width picture page and `sources` is a numbered reference list.
// Both are checked end to end: a real image file is written, referenced by the
// spec, and the rendered page inspected for the marks that prove the image and the
// caption actually landed.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { buildDeckPdf, renderDeckPages } from '../lib/build.js'
import { inkFraction } from '../lib/png.js'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WORK = path.join(PACKAGE_ROOT, '.test-output', 'new-layouts')
fs.rmSync(WORK, { recursive: true, force: true })
fs.mkdirSync(WORK, { recursive: true })

/** Write a small solid-colour PNG, so the test needs no fixture binary. */
function writePng(file, width, height, [r, g, b]) {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1)
    raw[row] = 0
    for (let x = 0; x < width; x += 1) {
      raw[row + 1 + x * 3] = r
      raw[row + 2 + x * 3] = g
      raw[row + 3 + x * 3] = b
    }
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body) >>> 0)
    return Buffer.concat([length, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]))
}

let CRC_TABLE = null
function crc32(buffer) {
  if (CRC_TABLE === null) {
    CRC_TABLE = new Int32Array(256)
    for (let n = 0; n < 256; n += 1) {
      let c = n
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      CRC_TABLE[n] = c
    }
  }
  let crc = -1
  for (const byte of buffer) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff]
  return crc ^ -1
}

let failures = 0
function check(label, condition, detail = '') {
  if (!condition) failures += 1
  console.log(`  ${condition ? 'OK  ' : 'FAIL'} ${label}${detail === '' ? '' : `  (${detail})`}`)
}

const ASSET = path.join(WORK, 'photo.png')
writePng(ASSET, 240, 160, [40, 90, 160])
check('the test image was written', fs.existsSync(ASSET) && fs.statSync(ASSET).size > 0, `${fs.statSync(ASSET).size} bytes`)

/** Build a deck whose second page is `frame` and report where the images landed. */
async function build(label, frame) {
  const dir = path.join(WORK, label)
  fs.mkdirSync(dir, { recursive: true })
  const built = await buildDeckPdf({
    spec: { title: 'new layouts', locale: 'zh', theme: 'metropolis', slides: [{ layout: 'cover' }, frame] },
    buildDir: dir,
    outFile: path.join(dir, 'deck.pdf'),
  })
  if (built.ok !== true) {
    return { ok: false, error: String(built.stderr ?? '').split('\n').find((l) => l.includes('error')) ?? '', dir }
  }
  const rendered = await renderDeckPages({ typFile: built.typFile, buildDir: dir, outputPattern: path.join(dir, 'p-{p}.png'), ppi: 90 })
  return { ok: true, pages: built.pages, files: rendered.files, dir, source: fs.readFileSync(built.typFile, 'utf8') }
}

console.log('')
console.log('=== image: a full-width picture page ===')
{
  // The image lives inside the deck directory, because Typst compiles with that
  // directory as its `--root` and refuses to read outside it — measured, and
  // asserted just below. That is also the reason a deck cannot be used to read an
  // arbitrary file from the machine.
  const deckDir = path.join(WORK, 'image')
  fs.mkdirSync(deckDir, { recursive: true })
  writePng(path.join(deckDir, 'photo.png'), 240, 160, [40, 90, 160])

  const result = await build('image', { layout: 'image', title: '现场照片', image: 'photo.png', caption: '照片说明文字', credit: '来源：测试夹具' })
  check('it builds', result.ok === true, result.ok === true ? '' : result.error.slice(0, 120))
  if (result.ok) {
    check('two pages', result.pages === 2, String(result.pages))
    // The blue image must tint the page: a page with no image would be near-white.
    const density = inkFraction(path.join(result.dir, 'p-2.png'))
    check('the page carries the image', density.ink > 0.05, `ink ${density.ink.toFixed(3)}`)
    check('the caption reached the source', /照片说明文字/.test(result.source))
    check('the credit reached the source', /来源：测试夹具/.test(result.source))
  }
}

console.log('')
console.log('=== image: no path named draws a placeholder, not a failure ===')
{
  const result = await build('image-placeholder', { layout: 'image', title: '缺图' })
  check('it still builds', result.ok === true, result.ok === true ? '' : result.error.slice(0, 90))
  if (result.ok) check('two pages', result.pages === 2, String(result.pages))
}

console.log('')
console.log('=== sources: a numbered reference list ===')
{
  const items = ['张三. 《某项研究》. 某出版社, 2026.', '李四. 另一份资料. 2025.', '王五. 第三份. 2024.']
  const result = await build('sources', { layout: 'sources', title: '参考资料', items })
  check('it builds', result.ok === true, result.ok === true ? '' : result.error.slice(0, 90))
  if (result.ok) {
    check('two pages', result.pages === 2, String(result.pages))
    for (const item of items) {
      check(`the entry reached the source: ${item.slice(0, 14)}…`, result.source.includes(item.slice(0, 12)))
    }
    const density = inkFraction(path.join(result.dir, 'p-2.png'))
    check('the page is not blank', density.ink > 0.02, `ink ${density.ink.toFixed(3)}`)
  }
}

console.log('')
console.log('=== an image outside the deck directory is refused ===')
{
  // `photo.png` exists in the sibling `image/` directory but not in this one, so
  // Typst's `--root` confinement is what stops the build. The point is that a deck
  // cannot be used to read a file from elsewhere on the machine.
  const outside = await build('image-outside', { layout: 'image', title: '越界', image: '../image/photo.png' })
  check('a path escaping the deck directory does not build', outside.ok === false, outside.ok === true ? 'it built' : '')
  check('the refusal explains why', /escape the project root|not found/.test(outside.error), outside.error.slice(0, 96))
}

console.log('')
console.log('=== an unread key on a new page type is still reported ===')
{
  const { validateSpec } = await import('../lib/tools.js')
  const { errors, warnings } = validateSpec({ slides: [{ layout: 'sources', title: 'x', items: ['a'], cite: ['wrong'] }] })
  check('the build would be allowed', errors.length === 0)
  check('the unread key is named', warnings.some((w) => w.includes('"cite"')), warnings[0]?.slice(0, 76) ?? '(none)')
  const bad = validateSpec({ slides: [{ layout: 'image', title: 'x' }] })
  check('an image page with no image is refused', bad.errors.some((e) => e.includes('image would be empty')))
}

console.log('')
console.log(`artifacts: ${WORK}`)
console.log(failures === 0 ? 'NEW LAYOUTS VERIFIED' : `${failures} check(s) failed`)
process.exitCode = failures === 0 ? 0 : 1
