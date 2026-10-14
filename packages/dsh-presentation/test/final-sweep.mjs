// Part of the @hxql666/dsh-presentation test suite. Run it from anywhere:
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

// Final capability sweep across the whole plugin, in one process.
import fs from "node:fs"
import { resolveBinary, REQUIRED_TYPST, VENDORED_TOUYING } from "../lib/engine.js"
import { buildDeckPdf, renderDeckPages, writePdfpc } from "../lib/build.js"
import { LAYOUTS } from "../lib/render.js"

const root = scratch('dsh_work', '_final_sweep')
fs.rmSync(root, { recursive: true, force: true })

// 1. Engine: a verified, version-matched compiler.
const binary = resolveBinary({})
console.log(`engine: typst ${binary.version} from ${binary.source}, sha256 verified = ${binary.verified}`)
console.log(`        vendored Touying ${VENDORED_TOUYING}; required Typst ${REQUIRED_TYPST}`)

// 2. Every layout renders, including a one-element collection of each kind.
const spec = {
  title: "能力覆盖检查",
  subtitle: "全部 14 种页型",
  author: "@hxql666/dsh-presentation",
  slides: [
    { layout: "cover" },
    { layout: "section", title: "分节页" },
    { layout: "agenda", title: "目录", items: ["单元素目录项"] },
    { layout: "bullets", title: "要点", items: [{ text: "单元素要点", detail: "带细节" }] },
    { layout: "steps", title: "步骤", items: [{ text: "单元素步骤" }] },
    { layout: "cards", title: "卡片", cards: [{ eyebrow: "L1", title: "单卡片", lines: ["一行"] }] },
    { layout: "kpis", title: "指标", items: [{ value: "1", label: "单指标" }] },
    { layout: "timeline", title: "时间线", items: [{ label: "单节点" }] },
    { layout: "compare", title: "对比", left: ["左"], right: ["右"] },
    { layout: "quote", title: "金句", quote: "单条引言", author: "作者" },
    { layout: "table", title: "表格", headers: ["列"], rows: [["唯一单元格"]] },
    { layout: "code", title: "代码", source: "let x = 1", language: "typ" },
    { layout: "image-text", title: "图文", body: ["左文"] },
    { layout: "columns", title: "多栏", columns: [["A"], ["B"]], ratios: ["1fr", "1fr"] },
    { layout: "bullets", title: "讲者备注", items: ["带备注"], note: "只进 pdfpc 的备注" },
  ],
}

const built = await buildDeckPdf({ spec, buildDir: path.join(root, "build"), outFile: path.join(root, "deck.pdf") })
console.log(`\nbuild: ok=${built.ok} pages=${built.pages} bytes=${built.bytes} layouts=${LAYOUTS.length}`)
if (!built.ok) { console.log(built.stderr); process.exit(1) }

// 3. Visual self-review: raster pages the model can read back.
const png = await renderDeckPages({ typFile: built.typFile, buildDir: path.join(root, "build"), outputPattern: path.join(root, "preview", "page-{p}.png"), ppi: 72 })
console.log(`self-review: ${png.files.length} PNG page(s), first = ${path.basename(png.files[0] ?? "none")}`)

// 4. Speaker notes sidecar.
const pdfpc = await writePdfpc({ typFile: built.typFile, buildDir: path.join(root, "build"), outFile: path.join(root, "deck.pdfpc") })
const pdfpcText = pdfpc.ok ? fs.readFileSync(path.join(root, "deck.pdfpc"), "utf8") : ""
console.log(`pdfpc: ok=${pdfpc.ok} bytes=${pdfpc.bytes} carries the note = ${pdfpcText.includes("只进 pdfpc 的备注")}`)

// 5. Images and generated spec land in the deck folder.
console.log(`artifacts: ${fs.readdirSync(path.join(root, "build")).sort().join(", ")}`)

const ok = built.ok && png.files.length >= 15 && pdfpc.ok && pdfpcText.includes("只进 pdfpc 的备注")
console.log(`\n${ok ? "SWEEP PASSED" : "SWEEP FAILED"}`)
process.exitCode = ok ? 0 : 1
