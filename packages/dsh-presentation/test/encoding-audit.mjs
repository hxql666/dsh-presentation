// Part of the @hxql/dsh-presentation test suite. Run it from anywhere:
//
//   node <this file>
//
// Build output goes to DSH_PRESENTATION_SCRATCH (default: the package's
// .test-output directory), so a run never writes outside the checkout.
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRATCH = process.env.DSH_PRESENTATION_SCRATCH ?? path.join(PACKAGE_ROOT, '.test-output')

/** A scratch path for one test's build output. */
function scratch(...segments) {
  return path.join(SCRATCH, ...segments)
}

// Encoding audit: find mojibake and BOMs before anything is published.
//
// Mojibake appears when UTF-8 bytes are read as a single-byte code page: the
// text "演示" becomes "婕旂ず". The tell-tale sign is CJK text mixing in
// characters from the U+6D00–U+9FFF "looks Chinese but is nonsense" range next
// to Latin letters, so this looks for the specific sequences that corruption
// produces rather than guessing from appearance.
import fs from 'node:fs'

// Directory names, not package names: the packages publish under an npm scope,
// but on disk they stay `packages/<name>`.
const roots = [PACKAGE_ROOT, path.resolve(PACKAGE_ROOT, '..', 'dsh-presentation-preset')]

// Character pairs that only appear through UTF-8-read-as-GBK corruption.
const TELLS = ['婕', '鏂', '妯', '紡', '鐢', '鎴', '闇', '鍥', '鏄', '绠', '鍒', '鏋', '鎵', '骞', '鐨', '銆', '锛', '鈥', '鈫', '鍜', '鍚', '鏇', '缂', '晱']
const BAD = new Set(TELLS)

const EXTS = new Set(['.js', '.mjs', '.cjs', '.json', '.md', '.yml', '.yaml', '.typ', '.txt', '.toml'])

let files = 0
let bomCount = 0
let mojibakeCount = 0

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.test-output') continue
    // Skip this file: its own mojibake samples are fixtures, not corruption.
    if (entry.name === 'encoding-audit.mjs') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) { walk(full); continue }
    if (!EXTS.has(path.extname(entry.name).toLowerCase())) continue
    files += 1

    const buf = fs.readFileSync(full)
    const rel = full.replace(scratch('dsh_work'), '')
    const hasBom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf
    if (hasBom) { bomCount += 1; console.log(`  BOM   ${rel}`) }

    const text = buf.toString('utf8')
    const bad = [...text].filter((ch) => BAD.has(ch))
    if (bad.length > 0) {
      mojibakeCount += 1
      const sample = text.split(/\r?\n/).find((line) => [...line].some((ch) => BAD.has(ch))) ?? ''
      console.log(`  MOJI  ${rel}  (${bad.length} bad chars)`)
      console.log(`        ${sample.trim().slice(0, 120)}`)
    }
  }
}

for (const root of roots) walk(root)

console.log('')
console.log(`scanned ${files} text files: ${mojibakeCount} with mojibake, ${bomCount} with a BOM`)
if (mojibakeCount > 0 || bomCount > 0) {
  console.log('Fix these before publishing: a corrupted description or README is visible to everyone.')
  process.exitCode = 1
} else {
  console.log('All text files are clean UTF-8 without BOM.')
}
