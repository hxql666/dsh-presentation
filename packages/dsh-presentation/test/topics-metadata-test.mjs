// The repository's GitHub topics and its npm metadata must agree.
//
// The topics are a claim about what this project is; `keywords` in package.json is
// the same claim on a second surface. They can drift — a topic added on GitHub and
// forgotten in the manifest is a claim that holds in one place and not the other —
// and nothing would notice.
//
// GitHub topics cannot be read from a build, so the list is duplicated here. That is
// the point: a test that hardcodes the expectation fails when the expectation
// changes, which is when someone should decide whether the metadata follows.
//
// Adding a topic means adding it here and to `keywords`. Removing one means the same.
const TOPICS = [
  'cordis',
  'deepseek-harness',
  'dsh',
  'dsh-plugin',
  'pdf-generation',
  'touying',
  'typst',
]

// Keywords that are deliberate extras: on npm and nowhere else, each with a reason.
// Keep this list short — every entry is a claim the repository does not make.
const EXTRA_KEYWORDS = {
  'typst-package': 'a Typst user browsing npm looks for this term, and the package vendors and redistributes two Typst packages',
}

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..')
const pkg = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'))
const root = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'))

let failures = 0
function check(label, condition, detail = '') {
  if (!condition) failures += 1
  console.log(`  ${condition ? 'OK  ' : 'FAIL'} ${label}${detail === '' ? '' : `  (${detail})`}`)
}

console.log('=== every topic appears as a keyword ===')
for (const topic of TOPICS) {
  check(topic, pkg.keywords.includes(topic))
}

console.log('')
console.log('=== nothing is claimed beyond them without a reason ===')
{
  const extra = pkg.keywords.filter((keyword) => !TOPICS.includes(keyword))
  const unexplained = extra.filter((keyword) => EXTRA_KEYWORDS[keyword] === undefined)
  check('every extra keyword is accounted for', unexplained.length === 0, unexplained.join(', ') || '(none)')
  for (const keyword of extra) {
    if (EXTRA_KEYWORDS[keyword] !== undefined) console.log(`      ${keyword}: ${EXTRA_KEYWORDS[keyword]}`)
  }
  check('unexplained extras: none', unexplained.length === 0)
}

console.log('')
console.log('=== each topic is backed by something in the code ===')
{
  const patch = fs.readFileSync(path.join(PACKAGE_ROOT, 'cordis.patch.yml'), 'utf8')
  const engine = fs.readFileSync(path.join(PACKAGE_ROOT, 'lib', 'engine.js'), 'utf8')
  const deck = fs.readFileSync(path.join(PACKAGE_ROOT, 'templates', 'deck.typ'), 'utf8')
  const build = fs.readFileSync(path.join(PACKAGE_ROOT, 'lib', 'build.js'), 'utf8')

  const EVIDENCE = {
    cordis: ['the patch writes cordis:group rows', patch.includes('cordis:group')],
    'deepseek-harness': ['the patch names @deepseek-ai/* packages', /name:\s*'@deepseek-ai\//.test(patch)],
    dsh: ['package.json declares dsh.bundle.patch', pkg.dsh?.bundle?.patch !== undefined],
    'dsh-plugin': ['same declaration — this is the plugin mechanism', pkg.dsh?.bundle?.patch !== undefined],
    'pdf-generation': ['the build compiles PDFs and the vector export recompiles one', engine.includes('countPdfPages') && build.includes('compileDocumentPdf')],
    touying: ['the generated document imports it and the package vendors it', deck.includes('@preview/touying:0.8.0') && fs.existsSync(path.join(PACKAGE_ROOT, 'vendor', 'preview', 'touying', '0.8.0'))],
    typst: ['the engine pins and hash-checks the compiler', /REQUIRED_TYPST\s*=/.test(engine)],
  }

  for (const topic of TOPICS) {
    const [why, ok] = EVIDENCE[topic]
    check(`${topic} — ${why}`, ok)
  }
}

console.log('')
console.log('=== the two descriptions name what the topics imply ===')
{
  check('the package description names the framework', /DeepSeek Harness/.test(pkg.description))
  check('the package description names the engine', /Typst/.test(pkg.description) && /Touying/.test(pkg.description))
  check('the package description names the output', /PDF/.test(pkg.description))
  // The repository description said "and its Agent preset" long after the preset
  // stopped being a separate package.
  check('the repository description does not resurrect the second package', !/and its Agent preset/.test(root.description))
  check('the repository description names the package', root.description.includes('@hxql/dsh-presentation'))
}

console.log('')
console.log(failures === 0 ? 'TOPICS AND METADATA AGREE' : `${failures} check(s) failed`)
process.exitCode = failures === 0 ? 0 : 1
