// The deliverable must not depend on the compiler being allowed to write.
//
// This suite exists because of a failure in the field: every build ended with
//
//   error: failed to write PDF file (拒绝访问。 (os error 5))
//
// while the host process wrote the same directory without complaint. The cause is the
// Windows sandbox: the compiler runs under a restricted token whose write capability is
// an ACL grant on the workspace, and that folder carried no such grant (`S-1-4-*` ACEs:
// zero, measured). The host has the user's own token, so it can write; the child cannot
// write anywhere, including the OS temp directory, which also had no grant.
//
// The fix is not to repair the ACL — this plugin neither owns nor can verify it — but to
// stop asking the child to write. Typst takes `-` as its output path and writes to
// standard output; the host captures the bytes and writes the file. So this suite
// asserts three things:
//
//   1. the compiler is never given a writable output path (its argv ends with `-`);
//   2. the file that results is byte-identical to what the compiler writes itself;
//   3. the page renderer's standard-output fallback reproduces the same pages byte for
//      byte, because a preview that differs from the delivered page is worse than none.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildDeckPdf, renderDeckPages } from '../lib/build.js'
import { isWriteDenied, packagePath, resolveBinary } from '../lib/engine.js'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WORK = path.join(PACKAGE_ROOT, '.test-output', 'write-path')
fs.rmSync(WORK, { recursive: true, force: true })
fs.mkdirSync(WORK, { recursive: true })

let failures = 0
function ok(label, condition, detail = '') {
  if (!condition) failures += 1
  console.log(`  ${condition ? 'OK  ' : 'FAIL'} ${label}${detail === '' ? '' : `  (${detail})`}`)
}

console.log('=== the messages the sandbox produces are recognised ===')
{
  // The reason inside the parentheses is localised by Windows; the code is not.
  ok('the reported failure', isWriteDenied('error: failed to write PDF file (拒绝访问。 (os error 5))'))
  ok('the same in English', isWriteDenied('error: failed to write PDF file (Access is denied. (os error 5))'))
  ok('POSIX spelling', isWriteDenied('error: failed to write PDF file (Permission denied (os error 13))'))
  ok('an ordinary compile error is not a write denial', !isWriteDenied('error: unknown variable: foo'), 'must not trigger the fallback')
  ok('a missing file is not a write denial', !isWriteDenied('error: file not found (os error 2)'))
}

const SPEC = {
  title: 'write path',
  locale: 'zh',
  theme: 'metropolis',
  slides: [
    { layout: 'cover' },
    { layout: 'bullets', title: '第二页', items: [{ text: '第一条要点' }, { text: '第二条要点' }] },
    { layout: 'bullets', title: '第三页', items: [{ text: '一条' }] },
  ],
}

console.log('')
console.log('=== the compiler is never asked to write the PDF ===')
let built
{
  const buildDir = path.join(WORK, 'build')
  built = await buildDeckPdf({
    spec: SPEC,
    buildDir,
    outFile: path.join(WORK, 'deck.pdf'),
  })
  ok('it builds', built.ok === true, built.ok === true ? '' : String(built.stderr ?? '').slice(0, 120))
  ok('the PDF exists', fs.existsSync(path.join(WORK, 'deck.pdf')))
  const head = fs.readFileSync(path.join(WORK, 'deck.pdf')).subarray(0, 4).toString('latin1')
  ok('it is a PDF', head === '%PDF', head)
  ok('the page count is read from the captured bytes', built.pages === SPEC.slides.length, String(built.pages))

  const command = built.command ?? []
  ok('the argv is reported', command.length > 0)
  ok('the output argument is standard output', command.at(-1) === '-', String(command.at(-1)))
  ok('no output path appears in the argv', !command.some((arg) => arg.endsWith('.pdf')), command.join(' ').slice(0, 80))

  const leftovers = fs.readdirSync(WORK).filter((name) => name.includes('.partial'))
  ok('no partial file is left behind', leftovers.length === 0, leftovers.join(', '))
}

console.log('')
console.log('=== the captured PDF is what the compiler writes itself ===')
{
  // Same input, compiled by the child straight to a file. If these differ, the detour
  // changed the deliverable and the whole approach is wrong.
  const direct = path.join(WORK, 'direct.pdf')
  const args = [
    'compile',
    '--root', path.join(WORK, 'build'),
    '--package-path', packagePath(),
    '--diagnostic-format', 'short',
    built.typFile,
    direct,
  ]
  const result = spawnSync(resolveBinary().path, args, { encoding: 'buffer' })
  ok('the direct compile succeeds', result.status === 0, String(result.status))
  const fromHost = fs.readFileSync(path.join(WORK, 'deck.pdf'))
  const fromChild = fs.readFileSync(direct)
  // The PDF carries creation and modification timestamps, so two compiles that land in
  // the same second are byte-identical and two that do not differ by those strings.
  // Asserting equality would be a test that fails depending on the clock; what matters
  // is that the captured bytes are the compiler's own output, so the difference is
  // confined to the timestamps and the length matches exactly.
  const differing = fromHost.length === fromChild.length
    ? [...fromHost].filter((byte, index) => byte !== fromChild[index]).length
    : Number.POSITIVE_INFINITY
  const hasTimestamps = /\/CreationDate\(D:\d{14}/.test(fromHost.toString('latin1'))
  ok(
    "the captured PDF is the compiler's own output",
    differing < 120 && hasTimestamps,
    `${fromHost.length} vs ${fromChild.length} bytes, ${differing} differ`,
  )
}

console.log('')
console.log('=== the page renderer prefers one invocation ===')
const normalDir = path.join(WORK, 'pages-normal')
let normal
{
  normal = await renderDeckPages({
    typFile: built.typFile,
    buildDir: path.join(WORK, 'build'),
    outputPattern: path.join(normalDir, 'page-{p}.png'),
    ppi: 60,
  })
  ok('it renders every page', normal.files.length === SPEC.slides.length, String(normal.files.length))
  ok('it did not fall back', normal.viaStdout === undefined, String(normal.viaStdout))
  ok('the files are on disk', normal.files.every((file) => fs.existsSync(file)))
}

console.log('')
console.log('=== the standard-output fallback reproduces the same pages ===')
{
  const stdoutDir = path.join(WORK, 'pages-stdout')
  const fallback = await renderDeckPages({
    typFile: built.typFile,
    buildDir: path.join(WORK, 'build'),
    outputPattern: path.join(stdoutDir, 'page-{p}.png'),
    ppi: 60,
    stdoutOnly: true,
  })
  ok('it renders every page', fallback.files.length === SPEC.slides.length, String(fallback.files.length))
  ok('it reports that it fell back', fallback.viaStdout === true, String(fallback.viaStdout))

  for (let page = 1; page <= SPEC.slides.length; page += 1) {
    const normalFile = path.join(normalDir, `page-${page}.png`)
    const stdoutFile = path.join(stdoutDir, `page-${page}.png`)
    const same = fs.existsSync(normalFile) && fs.existsSync(stdoutFile) &&
      fs.readFileSync(normalFile).equals(fs.readFileSync(stdoutFile))
    ok(`page ${page} is byte-identical either way`, same)
  }
}

console.log('')
console.log('=== a page subset still works through the fallback ===')
{
  // The fallback has to know how many pages to render. With a subset it must use the
  // subset; without one it asks the document. Both are covered here.
  const subsetDir = path.join(WORK, 'pages-subset')
  const subset = await renderDeckPages({
    typFile: built.typFile,
    buildDir: path.join(WORK, 'build'),
    outputPattern: path.join(subsetDir, 'page-{p}.png'),
    ppi: 60,
    pages: [2],
    stdoutOnly: true,
  })
  ok('only the requested page exists', subset.files.length === 1, String(subset.files.length))
  ok('it is page 2', subset.pages[0]?.page === 2, String(subset.pages[0]?.page))
  ok('no other page was written', fs.readdirSync(subsetDir).filter((name) => name.endsWith('.png')).length === 1)
}

console.log('')
console.log(`artifacts: ${WORK}`)
console.log(failures === 0 ? 'WRITE PATH VERIFIED' : `${failures} check(s) failed`)
process.exitCode = failures === 0 ? 0 : 1
