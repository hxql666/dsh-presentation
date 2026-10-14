// Find a heading form that works when emitted from inside a function.
//
// `slide(title: …)` fails on five themes, and the first two attempts at a heading
// replacement both failed with "field depth in heading is not known at this
// location" — a heading built or emitted inside a plain function has no document
// context to resolve its depth against. This tests the candidate forms directly,
// each inside a function, so the answer comes from the compiler.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const PACKAGE_ROOT = 'E:\\dsh_work\\dsh-presentation-repo\\packages\\dsh-presentation'
const TYPST = path.join(PACKAGE_ROOT, 'node_modules', '@flukxr', 'typst-cli-win32-x64', 'vendor', 'typst.exe')
const VENDOR = path.join(PACKAGE_ROOT, 'vendor')
const WORK = path.join(PACKAGE_ROOT, '.test-output', 'heading-forms')
fs.rmSync(WORK, { recursive: true, force: true })
fs.mkdirSync(WORK, { recursive: true })

function compile(name, source) {
  const file = path.join(WORK, `${name}.typ`)
  fs.writeFileSync(file, source, 'utf8')
  const result = spawnSync(TYPST, ['compile', '--root', WORK, '--package-path', VENDOR, '--diagnostic-format', 'short', file, path.join(WORK, `${name}.pdf`)], { encoding: 'utf8' })
  const error = (result.stderr ?? '').split('\n').map((l) => l.trim()).find((l) => l.includes('error'))
  return { ok: result.status === 0, error: error ?? '' }
}

/** Each candidate helper, called from the document body. */
const FORMS = {
  'heading(level: 2)[#title]': 'heading(level: 2)[#title]',
  'context heading(level: 2)[#title]': 'context heading(level: 2)[#title]',
  'context [#heading(level: 2)[#title]]': 'context [#heading(level: 2)[#title]]',
  '[= #title]': '[= #title]',
  'context [#heading(level: 2, title)]': 'context [#heading(level: 2, title)]',
  'none (no title at all)': '',
}

for (const theme of ['metropolis', 'simple']) {
  console.log(`=== ${theme} ===`)
  for (const [label, emit] of Object.entries(FORMS)) {
    const helper = emit === ''
      ? `#let titled(title, body) = { slide(composer: auto)[#body] }`
      : `#let titled(title, body) = {\n  if title != none { ${emit} }\n  slide(composer: auto)[#body]\n}`
    const source = `#import "@preview/touying:0.8.0": *
#import themes.${theme}: ${theme}-theme

${helper}

#show: ${theme}-theme.with(aspect-ratio: "16-9", (info: (title: "T")))

= 章节

#titled("页面标题")[
  正文
]
`
    const result = compile(`${theme}-${label.replace(/\W+/g, '_')}`, source)
    console.log(`  ${result.ok ? 'OK  ' : 'FAIL'} ${label.padEnd(38)}${result.ok ? '' : `  ${result.error.slice(0, 92)}`}`)
  }
  console.log('')
}
