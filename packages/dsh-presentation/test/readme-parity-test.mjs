// The two READMEs must stay the same document in two languages.
//
// A translation drifts the moment one side gains a section the other lacks. The
// prose cannot be compared mechanically, but the skeleton can: heading depth and
// order, table row counts, fenced blocks, link targets, image paths, and every
// measurement the document quotes. Those are what a reader notices missing, and
// they are what this asserts.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// The repository root: this file lives in <root>/packages/dsh-presentation/test/.
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const read = (name) => {
  const file = path.join(REPO, name)
  if (!fs.existsSync(file)) {
    console.log(`  MISS: ${name} does not exist at the repository root`)
    process.exit(1)
  }
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
}
const zh = read('README.md')
const en = read('README_EN.md')

let failures = 0
function check(label, condition, detail = '') {
  if (!condition) failures += 1
  console.log(`  ${condition ? 'OK  ' : 'FAIL'} ${label}${detail === '' ? '' : `  (${detail})`}`)
}

/** The skeleton of a markdown document, in order. */
function skeleton(text) {
  const lines = text.split('\n')
  const headings = []
  const fences = []
  let inFence = false
  let fenceLines = 0

  for (const line of lines) {
    if (/^```/.test(line)) {
      if (inFence) {
        fences.push(fenceLines)
        fenceLines = 0
      }
      inFence = !inFence
      continue
    }
    if (inFence) {
      fenceLines += 1
      continue
    }
    const heading = /^(#{1,4}) /.exec(line)
    if (heading !== null) headings.push(heading[1].length)
  }
  return { headings, fences }
}

console.log('=== heading skeleton: same depth sequence in the same order ===')
const zhSkeleton = skeleton(zh)
const enSkeleton = skeleton(en)
check(
  'the same number of headings',
  zhSkeleton.headings.length === enSkeleton.headings.length,
  `zh ${zhSkeleton.headings.length} vs en ${enSkeleton.headings.length}`,
)
{
  const mismatch = zhSkeleton.headings.findIndex((level, index) => level !== enSkeleton.headings[index])
  check('every heading sits at the same depth', mismatch === -1,
    mismatch === -1 ? '' : `first difference at heading ${mismatch + 1}`)
  if (mismatch !== -1) {
    const zhLines = zh.split('\n').filter((line) => /^#{1,4} /.test(line))
    const enLines = en.split('\n').filter((line) => /^#{1,4} /.test(line))
    console.log(`      zh: ${zhLines[mismatch]}`)
    console.log(`      en: ${enLines[mismatch]}`)
  }
}

console.log('')
console.log('=== code blocks ===')
check('the same number of fenced blocks', zhSkeleton.fences.length === enSkeleton.fences.length,
  `zh ${zhSkeleton.fences.length} vs en ${enSkeleton.fences.length}`)

// A block's content should be identical when it is a command or JSON, because code
// and config are not translated. Comments are translated — `#` and `//` lines, and
// the prose that follows a command — so the comparison keeps only the lines that are
// neither, and normalises the ones whose column alignment differs.
const blocks = (text) => [...text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((match) => match[1].trim())
const executable = (text) => text
  .split('\n')
  .map((line) => line.trimEnd())
  .filter((line) => {
    const trimmed = line.trim()
    if (trimmed === '') return false
    // A comment line, in either language's punctuation.
    if (/^[#/]{1,2}\s/.test(trimmed)) return false
    return true
  })
  // A `/deck …` line is a command whose trailing description is prose. Collapse runs
  // of spaces first, so column alignment is not read as a difference.
  .map((line) => (line.trimStart().startsWith('/deck') ? line.trim().split(/\s{1,}/)[0] : line.trim()))
  // A trailing comment on a code line is prose too.
  .map((line) => line.replace(/\s{2,}#\s.*$/, '').replace(/\s{2,}\/\/\s.*$/, ''))
  .join('\n')
const zhBlocks = blocks(zh)
const enBlocks = blocks(en)
let differing = 0
for (let index = 0; index < Math.min(zhBlocks.length, enBlocks.length); index += 1) {
  if (executable(zhBlocks[index]) !== executable(enBlocks[index])) differing += 1
}
check('every code block carries the same executable content', differing === 0, `${differing} differ`)

console.log('')
console.log('=== tables ===')
const tableRows = (text) => {
  const lines = text.split('\n')
  const counts = []
  let inFence = false
  for (let index = 0; index < lines.length; index += 1) {
    if (/^```/.test(lines[index])) inFence = !inFence
    if (inFence) continue
    if (/^\|/.test(lines[index])) {
      let rows = 0
      while (index < lines.length && /^\|/.test(lines[index])) {
        if (!/^\|[\s:|-]+\|$/.test(lines[index])) rows += 1
        index += 1
      }
      counts.push(rows)
    }
  }
  return counts
}
const zhTables = tableRows(zh)
const enTables = tableRows(en)
check('the same tables with the same row counts', JSON.stringify(zhTables) === JSON.stringify(enTables),
  `zh [${zhTables}] vs en [${enTables}]`)

console.log('')
console.log('=== links ===')
const links = (text) => {
  const found = new Set()
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1]
    // The language switch points at the other file in each document, by design.
    if (target === 'README_EN.md' || target === 'README.md') continue
    if (target.startsWith('#')) continue
    found.add(target)
  }
  return [...found].sort()
}
const zhLinks = links(zh)
const enLinks = links(en)
const missingInEn = zhLinks.filter((link) => !enLinks.includes(link))
const missingInZh = enLinks.filter((link) => !zhLinks.includes(link))
check('every link in the Chinese file exists in the English one', missingInEn.length === 0, missingInEn.join(', '))
check('every link in the English file exists in the Chinese one', missingInZh.length === 0, missingInZh.join(', '))

console.log('')
console.log('=== images ===')
const images = (text) => [...text.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1])
check('the same images, in the same order', JSON.stringify(images(zh)) === JSON.stringify(images(en)),
  `zh ${images(zh).length} vs en ${images(en).length}`)

console.log('')
console.log('=== the numbers the document quotes ===')
// Measurements must survive translation. Extracting them is crude but it catches a
// dropped table row or a changed threshold.
const numbers = (text) => [...text.matchAll(/\b\d+(?:\.\d+)?\s*(?:ms|bytes|%|pages?|suites?|layers?|points?)\b/g)]
  .map((match) => match[0].replace(/\s+/g, ' '))
const zhNumbers = numbers(zh).sort()
const enNumbers = numbers(en).sort()
const missing = zhNumbers.filter((value) => !enNumbers.includes(value))
check('every measurement appears in both', missing.length === 0, missing.slice(0, 6).join(', '))

console.log('')
console.log('=== the language switch ===')
check('the Chinese file links to the English one', zh.includes('README_EN.md'))
check('the English file links to the Chinese one', /\[中文\]\(README\.md\)/.test(en))

console.log('')
console.log('=== the Chinese file is the default ===')
{
  // Both files open with the same package name, the same badges and a language
  // switch, so the test looks at the body: the first paragraph after the switch.
  const body = (text) => text.split('\n').filter((line) => !/^[[!]|^#/.test(line.trim())).slice(0, 6).join('\n')
  check('README.md is the Chinese one', /[\u4e00-\u9fff]/.test(body(zh)), body(zh).slice(0, 50).replace(/\n/g, ' '))
  check('README_EN.md is the English one', !/[\u4e00-\u9fff]/.test(body(en)), body(en).slice(0, 50).replace(/\n/g, ' '))
}

console.log('')
console.log(failures === 0 ? 'BOTH READMES AGREE' : `${failures} check(s) failed`)
process.exitCode = failures === 0 ? 0 : 1
