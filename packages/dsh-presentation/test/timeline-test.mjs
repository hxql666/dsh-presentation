// The timeline page, and the spec check that would have caught its silence.
//
// The page drew its rules and printed nothing: the renderer emitted `label`/`detail`
// while the documented shape is `when`/`what`, so a model that followed the natural
// reading produced an empty track — with no diagnostic, because the layout happily
// drew boxes around empty content. Two things are asserted here: both key spellings
// render, and `validateSpec` refuses a page that could only come out empty.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDeckPdf, renderDeckPages } from '../lib/build.js'
import { inkFraction } from '../lib/png.js'
import { validateSpec } from '../lib/tools.js'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WORK = path.join(PACKAGE_ROOT, '.test-output', 'timeline')
fs.rmSync(WORK, { recursive: true, force: true })
fs.mkdirSync(WORK, { recursive: true })

let failures = 0
function check(label, condition, detail = '') {
  if (!condition) failures += 1
  console.log(`  ${condition ? 'OK  ' : 'FAIL'} ${label}${detail === '' ? '' : `  (${detail})`}`)
}

console.log('=== the documented keys render ===')
{
  const dir = path.join(WORK, 'documented')
  fs.mkdirSync(dir, { recursive: true })
  const built = await buildDeckPdf({
    spec: {
      title: 'TL', locale: 'zh', theme: 'metropolis',
      slides: [{ layout: 'cover' }, { layout: 'timeline', title: '时间线', items: [{ when: '一月', what: '立项' }, { when: '三月', what: '原型' }] }],
    },
    buildDir: dir,
    outFile: path.join(dir, 'deck.pdf'),
  })
  check('it builds', built.ok === true, built.ok === true ? '' : String(built.stderr ?? '').slice(0, 90))

  const source = fs.readFileSync(built.typFile, 'utf8')
  check('the emitted items carry when and what', /when: \[一月\]/.test(source) && /what: \[立项\]/.test(source))
  check('no label/detail keys are emitted', !/label: \[/.test(source) && !/detail: \[/.test(source))

  // The milestone text must reach the page, which is the property that was broken.
  const rendered = await renderDeckPages({ typFile: built.typFile, buildDir: dir, outputPattern: path.join(dir, 'p-{p}.png'), ppi: 90 })
  const page = path.join(dir, 'p-2.png')
  check('the page rendered', rendered.files.length === 2, String(rendered.files.length))

  // Compared against the same page with no items, not against a byte count: the broken
  // version measured 6492 bytes against 14789 with labels on one font set, and a byte
  // threshold is a property of that font set rather than of this plugin.
  const emptyDir = path.join(WORK, 'empty')
  fs.mkdirSync(emptyDir, { recursive: true })
  const emptyBuilt = await buildDeckPdf({
    spec: { title: 'TL', locale: 'zh', theme: 'metropolis', slides: [{ layout: 'cover' }, { layout: 'timeline', title: '时间线' }] },
    buildDir: emptyDir,
    outFile: path.join(emptyDir, 'deck.pdf'),
  })
  if (emptyBuilt.ok === true) {
    await renderDeckPages({ typFile: emptyBuilt.typFile, buildDir: emptyDir, outputPattern: path.join(emptyDir, 'p-{p}.png'), ppi: 90 })
    const emptyPage = path.join(emptyDir, 'p-2.png')
    if (fs.existsSync(page) && fs.existsSync(emptyPage)) {
      const withText = inkFraction(page)
      const without = inkFraction(emptyPage)
      check(
        'the page carries more ink than an empty track',
        withText.ink > without.ink,
        `${withText.ink.toFixed(4)} vs ${without.ink.toFixed(4)}`,
      )
    }
  }
}

console.log('')
console.log('=== the older spelling still renders ===')
{
  const dir = path.join(WORK, 'legacy')
  fs.mkdirSync(dir, { recursive: true })
  const built = await buildDeckPdf({
    spec: {
      title: 'TL', locale: 'zh', theme: 'metropolis',
      slides: [{ layout: 'cover' }, { layout: 'timeline', title: '旧写法', items: [{ label: '一月', detail: '立项' }] }],
    },
    buildDir: dir,
    outFile: path.join(dir, 'deck.pdf'),
  })
  check('label/detail still build', built.ok === true, built.ok === true ? '' : String(built.stderr ?? '').slice(0, 90))
  const source = fs.readFileSync(built.typFile, 'utf8')
  check('they are folded into when/what', /when: \[一月\]/.test(source) && /what: \[立项\]/.test(source))
}

console.log('')
console.log('=== validateSpec refuses a page that could only be empty ===')
{
  const cases = [
    { label: 'timeline with no items', spec: { slides: [{ layout: 'timeline', title: 'x' }] }, fatal: true },
    { label: 'timeline with an item that has no keys', spec: { slides: [{ layout: 'timeline', items: [{}] }] }, fatal: true },
    { label: 'quote with no quote', spec: { slides: [{ layout: 'quote', author: 'a' }] }, fatal: true },
    { label: 'code with no source', spec: { slides: [{ layout: 'code', title: 'x' }] }, fatal: true },
    { label: 'kpis with no items', spec: { slides: [{ layout: 'kpis', title: 'x' }] }, fatal: true },
    { label: 'compare with one empty side', spec: { slides: [{ layout: 'compare', left: { items: ['a'] } }] }, fatal: false },
    { label: 'a good timeline', spec: { slides: [{ layout: 'timeline', items: [{ when: '一月', what: '立项' }] }] }, fatal: false },
    { label: 'an unknown layout', spec: { slides: [{ layout: 'not-a-layout' }] }, fatal: true },
  ]
  for (const { label, spec, fatal } of cases) {
    const { errors } = validateSpec(spec)
    const isFatal = errors.length > 0
    check(`${label} -> ${isFatal ? 'refused' : 'accepted'}`, isFatal === fatal, isFatal === fatal ? '' : errors[0]?.slice(0, 80) ?? '')
  }
}

console.log('')
console.log('=== an unread key is reported, not fatal ===')
{
  // The exact mistake that produced the empty track: the right data under a name
  // the layout never reads.
  const { errors, warnings } = validateSpec({
    slides: [{ layout: 'bullets', title: 'x', items: [{ text: 'a' }], bullets: ['mistyped'] }],
  })
  check('it is not fatal', errors.length === 0)
  check('it is named in a warning', warnings.some((w) => w.includes('"bullets"')), warnings[0]?.slice(0, 80) ?? '(none)')
}

console.log('')
console.log(failures === 0 ? 'TIMELINE AND SPEC CHECK VERIFIED' : `${failures} check(s) failed`)
process.exitCode = failures === 0 ? 0 : 1
