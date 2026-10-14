// Call the plugin's real `render-deck` with the real argument shape.
//
// Every reconstruction of the show rule passed, and the template's show rule
// turned out to be identical to the reconstructions. What no reconstruction
// included is `render-slides` — the plugin's own page renderer — so this calls
// the real function, through the real template, with the real generated argument
// list, and narrows from there.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TYPST = path.join(PACKAGE_ROOT, 'node_modules', '@flukxr', 'typst-cli-win32-x64', 'vendor', 'typst.exe')
const VENDOR = path.join(PACKAGE_ROOT, 'vendor')
const WORK = path.join(PACKAGE_ROOT, '.test-output', 'real-deck')
fs.rmSync(WORK, { recursive: true, force: true })
fs.mkdirSync(WORK, { recursive: true })
for (const name of ['deck.typ', 'layout.typ']) {
  fs.copyFileSync(path.join(PACKAGE_ROOT, 'templates', name), path.join(WORK, name))
}

function run(label, body) {
  const file = path.join(WORK, `${label}.typ`)
  fs.writeFileSync(file, body, 'utf8')
  const result = spawnSync(TYPST, ['compile', '--root', WORK, '--package-path', VENDOR, '--diagnostic-format', 'short', file, path.join(WORK, `${label}.pdf`)], { encoding: 'utf8' })
  const errors = (result.stderr ?? '').split('\n').map((l) => l.trim()).filter((l) => l.includes('error'))
  console.log(`  ${result.status === 0 ? 'OK  ' : 'FAIL'} ${label}${result.status === 0 ? '' : `\n        ${errors.slice(0, 3).join('\n        ')}`}`)
  return result.status === 0
}

const header = `#import "deck.typ": render-deck

#let call(theme: "simple", slides: ((layout: "cover"),), body) = render-deck(
  theme: theme,
  font-stack: "sans",
  locale: "zh",
  aspect-ratio: "16-9",
  info: (title: "T"),
  slides: slides,
  handout: false,
  breakable: true,
  align: top,
  body,
)
`

console.log('=== the real render-deck, real slides ===')
for (const theme of ['metropolis', 'simple', 'university', 'dewdrop', 'stargazer', 'aqua', 'default']) {
  run(`deck-${theme}`, `${header}
#show: it => call(theme: "${theme}", slides: ((layout: "cover"),), it)

`)
}

console.log('')
console.log('=== is it the slides data, or the theme? ===')
run('simple with an empty slides array', `${header}
#show: it => call(theme: "simple", slides: (), it)

`)
run('simple with a bullets page', `${header}
#show: it => call(theme: "simple", slides: ((layout: "bullets", lead: "x", items: ((text: "a", detail: none),)),), it)

`)
run('simple with two covers', `${header}
#show: it => call(theme: "simple", slides: ((layout: "cover"), (layout: "cover")), it)

`)
