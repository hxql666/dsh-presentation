// Compile the bare minimum that the plugin's template does, and print the real
// error text.
//
// The reconstructions kept passing while the plugin kept failing, which means the
// difference is a specific line in the real template rather than a general shape.
// This starts from exactly the plugin's show rule and removes lines until it
// compiles, printing the full compiler output at each step.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TYPST = path.join(PACKAGE_ROOT, 'node_modules', '@flukxr', 'typst-cli-win32-x64', 'vendor', 'typst.exe')
const VENDOR = path.join(PACKAGE_ROOT, 'vendor')
const WORK = path.join(PACKAGE_ROOT, '.test-output', 'min')
fs.rmSync(WORK, { recursive: true, force: true })
fs.mkdirSync(WORK, { recursive: true })

// The plugin's templates, copied so relative imports resolve.
for (const name of ['deck.typ', 'layout.typ']) {
  fs.copyFileSync(path.join(PACKAGE_ROOT, 'templates', name), path.join(WORK, name))
}

function run(label, body) {
  const file = path.join(WORK, `${label}.typ`)
  fs.writeFileSync(file, body, 'utf8')
  const result = spawnSync(TYPST, ['compile', '--root', WORK, '--package-path', VENDOR, '--diagnostic-format', 'short', file, path.join(WORK, `${label}.pdf`)], { encoding: 'utf8' })
  const lines = (result.stderr ?? '').split('\n').map((l) => l.trim()).filter((l) => l !== '')
  console.log(`  ${result.status === 0 ? 'OK  ' : 'FAIL'} ${label}`)
  if (result.status !== 0) {
    for (const line of lines.slice(0, 4)) console.log(`        ${line}`)
  }
  return result.status === 0
}

// The import block the template uses.
const IMPORTS = [
  '#import "@preview/touying:0.8.0": *',
  '#import "layout.typ": *',
  '#import themes.default: *',
  '#import themes.simple: *',
  '#import themes.metropolis: *',
  '#import themes.dewdrop: *',
  '#import themes.university: *',
  '#import themes.aqua: *',
  '#import themes.stargazer: *',
].join('\n')

console.log('=== the show rule, narrowed ===')
run('a-theme-only', `${IMPORTS}

#show: simple-theme.with(
  aspect-ratio: "16-9",
)
== S
x
`)

run('b-plus-info', `${IMPORTS}

#show: simple-theme.with(
  aspect-ratio: "16-9",
  (info: (title: "T")),
)
== S
x
`)

run('c-plus-align', `${IMPORTS}

#let align = top

#show: simple-theme.with(
  aspect-ratio: "16-9",
  align: align,
  (info: (title: "T")),
)
== S
x
`)

run('d-plus-config', `${IMPORTS}

#let align = top

#show: simple-theme.with(
  aspect-ratio: "16-9",
  align: align,
  (info: (title: "T")),
  (handout: false, enable-pdfpc: true, breakable: true),
)
== S
x
`)

run('e-via-function', `${IMPORTS}

#let render(theme: "simple", aspect-ratio: "16-9", align: top, info: (:), handout: false, body) = {
  let theme-fn = (simple: simple-theme, metropolis: metropolis-theme, stargazer: stargazer-theme).at(theme)
  show: theme-fn.with(
    aspect-ratio: aspect-ratio,
    align: align,
    (info: info),
    (handout: handout, enable-pdfpc: true, breakable: true),
  )
  body
}

#show: it => render(theme: "simple", info: (title: "T"), it)

== S
x
`)

run('f-via-function-no-align', `${IMPORTS}

#let render(theme: "simple", aspect-ratio: "16-9", align: top, info: (:), handout: false, body) = {
  let theme-fn = (simple: simple-theme, metropolis: metropolis-theme, stargazer: stargazer-theme).at(theme)
  show: theme-fn.with(
    aspect-ratio: aspect-ratio,
    (info: info),
    (handout: handout, enable-pdfpc: true, breakable: true),
  )
  body
}

#show: it => render(theme: "simple", info: (title: "T"), it)

== S
x
`)
