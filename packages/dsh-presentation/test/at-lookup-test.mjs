// The two candidates left, tested in isolation.
//
// Everything else was eliminated: the imports, the show-rule shape, the
// configuration dictionaries, and calling the theme through a wrapper. What
// remains is how the theme function is *obtained* — `.at(key)` on a dictionary —
// and the font show rule that runs after the theme's own rule.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TYPST = path.join(PACKAGE_ROOT, 'node_modules', '@flukxr', 'typst-cli-win32-x64', 'vendor', 'typst.exe')
const VENDOR = path.join(PACKAGE_ROOT, 'vendor')
const WORK = path.join(PACKAGE_ROOT, '.test-output', 'at')
fs.rmSync(WORK, { recursive: true, force: true })
fs.mkdirSync(WORK, { recursive: true })
for (const name of ['layout.typ']) {
  fs.copyFileSync(path.join(PACKAGE_ROOT, 'templates', name), path.join(WORK, name))
}

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

function run(label, body) {
  const file = path.join(WORK, `${label}.typ`)
  fs.writeFileSync(file, body, 'utf8')
  const result = spawnSync(TYPST, ['compile', '--root', WORK, '--package-path', VENDOR, '--diagnostic-format', 'short', file, path.join(WORK, `${label}.pdf`)], { encoding: 'utf8' })
  const lines = (result.stderr ?? '').split('\n').map((l) => l.trim()).filter((l) => l.includes('error'))
  console.log(`  ${result.status === 0 ? 'OK  ' : 'FAIL'} ${label}${result.status === 0 ? '' : `\n        ${lines.slice(0, 2).join('\n        ')}`}`)
}

const DICT = `#let dsh-themes = (
  metropolis: metropolis-theme,
  simple: simple-theme,
  university: university-theme,
  dewdrop: dewdrop-theme,
  stargazer: stargazer-theme,
  aqua: aqua-theme,
  default: default-theme,
)`

console.log('=== obtaining the theme function ===')

run('1 direct name', `${IMPORTS}

#show: simple-theme.with(aspect-ratio: "16-9", (info: (title: "T")))
== S
x
`)

run('2 dict field access', `${IMPORTS}
${DICT}

#show: dsh-themes.simple.with(aspect-ratio: "16-9", (info: (title: "T")))
== S
x
`)

run('3 dict .at()', `${IMPORTS}
${DICT}

#show: dsh-themes.at("simple").with(aspect-ratio: "16-9", (info: (title: "T")))
== S
x
`)

run('4 dict .at() inside a function', `${IMPORTS}
${DICT}

#let render(theme: "simple", aspect-ratio: "16-9", align: top, info: (:), handout: false, breakable: true, body) = {
  let theme-fn = dsh-themes.at(theme)
  show: theme-fn.with(
    aspect-ratio: aspect-ratio,
    align: align,
    (info: info),
    (handout: handout, enable-pdfpc: true, breakable: breakable),
  )
  body
}

#show: it => render(theme: "simple", info: (title: "T"), it)

== S
x
`)

console.log('')
console.log('=== the font show rule, which also uses a dictionary lookup ===')

run('5 text with dict .at()', `${IMPORTS}

#let dsh-font-stacks = (sans: ("New Computer Modern", "Noto Sans SC", "Microsoft YaHei"))
#let dsh-locales = (zh: (lang: "zh", region: "cn"))

#show: simple-theme.with(aspect-ratio: "16-9", (info: (title: "T")))

#show: it => {
  let language = dsh-locales.at("zh")
  set text(font: dsh-font-stacks.at("sans"), lang: language.lang, region: language.region)
  set par(justify: true, leading: 0.68em, first-line-indent: 0em)
  it
}

== S
x
`)

run('6 both combined', `${IMPORTS}
${DICT}

#let dsh-font-stacks = (sans: ("New Computer Modern", "Noto Sans SC", "Microsoft YaHei"))
#let dsh-locales = (zh: (lang: "zh", region: "cn"))

#let render(theme: "simple", aspect-ratio: "16-9", align: top, info: (:), handout: false, breakable: true, body) = {
  let theme-fn = dsh-themes.at(theme)
  show: theme-fn.with(
    aspect-ratio: aspect-ratio,
    align: align,
    (info: info),
    (handout: handout, enable-pdfpc: true, breakable: breakable),
  )

  show: it => {
    let language = dsh-locales.at("zh")
    set text(font: dsh-font-stacks.at("sans"), lang: language.lang, region: language.region)
    set par(justify: true, leading: 0.68em, first-line-indent: 0em)
    it
  }
  body
}

#show: it => render(theme: "simple", info: (title: "T"), it)

== S
x
`)
