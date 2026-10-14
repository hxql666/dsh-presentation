// Locale plumbing: the `locale` key must actually reach the generated Typst
// document and change the language facts Typst uses. Asserting on the generated
// source is what proves it is wired, and rendering proves it compiles.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDeckPdf } from '../lib/build.js'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRATCH = process.env.DSH_PRESENTATION_SCRATCH ?? path.join(PACKAGE_ROOT, '.test-output')

const base = {
  title: 'Locale check',
  slides: [
    { layout: 'cover' },
    { layout: 'bullets', title: 'A page', items: [{ text: 'one', detail: 'two' }] },
  ],
}

/** Build one deck and return the locale line from its generated source. */
async function buildLocale(tag, spec) {
  const dir = path.join(SCRATCH, 'locale', tag)
  const result = await buildDeckPdf({ spec, buildDir: dir, outFile: path.join(dir, 'deck.pdf') })
  const source = fs.readFileSync(path.join(dir, 'body.typ'), 'utf8')
  const emitted = /^\s*locale: "([a-z-]+)",\s*$/m.exec(source)?.[1]
  return { result, emitted }
}

let failures = 0
const cases = [
  ['default', base, 'zh'],
  ['explicit-en', { ...base, locale: 'en' }, 'en'],
  ['explicit-ja', { ...base, locale: 'ja' }, 'ja'],
]

for (const [tag, spec, expected] of cases) {
  const { result, emitted } = await buildLocale(tag, spec)
  const ok = result.ok === true && emitted === expected
  if (!ok) failures += 1
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${tag.padEnd(12)} emitted locale=${JSON.stringify(emitted)} expected=${JSON.stringify(expected)} pages=${result.pages}`)
  if (!result.ok) console.log(`        ${(result.stderr ?? '').split('\n')[0]}`)
}

// An unknown locale must be refused with the list of valid keys, not silently
// accepted and then fail inside Typst with an opaque `.at()` error.
{
  try {
    await buildDeckPdf({
      spec: { ...base, locale: 'klingon' },
      buildDir: path.join(SCRATCH, 'locale', 'invalid'),
      outFile: path.join(SCRATCH, 'locale', 'invalid', 'deck.pdf'),
    })
    failures += 1
    console.log('  FAIL invalid locale was accepted')
  } catch (error) {
    const actionable = /zh, zh-tw, en/.test(error.message)
    if (!actionable) failures += 1
    console.log(`  ${actionable ? 'OK  ' : 'FAIL'} invalid locale refused: ${error.message.slice(0, 96)}`)
  }
}

console.log('')
console.log(failures === 0 ? 'LOCALE WIRING VERIFIED' : `${failures} locale case(s) failed`)
process.exitCode = failures === 0 ? 0 : 1
