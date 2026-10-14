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

import { buildDeckPdf } from "../lib/build.js"
import { applyScene } from "../lib/scenes.js"

// A scene must build a real deck with nothing but a title and pages.
const spec = applyScene(
  {
    title: "场景预设验证",
    subtitle: "学术报告",
    author: "@hxql666/dsh-presentation",
    slides: [
      { layout: "cover" },
      { layout: "agenda", title: "目录", items: ["问题", "方法", "结果"] },
      { layout: "section", title: "方法" },
      { layout: "bullets", title: "要点", items: [{ text: "一条要点", detail: "细节" }] },
      { layout: "kpis", title: "结果", items: [{ value: "0.94", label: "准确率", note: "五折交叉" }] },
    ],
  },
  "academic",
)
console.log("scene-resolved spec:", JSON.stringify({ theme: spec.theme, aspectRatio: spec.aspectRatio, fontStack: spec.fontStack }))

const r = await buildDeckPdf({
  spec,
  buildDir: scratch('dsh_work', '_probe_scene', 'build'),
  outFile: scratch('dsh_work', '_probe_scene', 'academic.pdf'),
})
console.log("build ok:", r.ok, "pages:", r.pages, "bytes:", r.bytes)
if (!r.ok) console.log(r.stderr)
const ok = r.ok === true && spec.theme === "university" && spec.aspectRatio === "4-3"
console.log(ok ? "SCENE PRESET VERIFIED" : "SCENE PRESET FAILED")
process.exitCode = ok ? 0 : 1
