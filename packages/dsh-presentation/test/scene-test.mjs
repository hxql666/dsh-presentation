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

import { SCENES, findScene, applyScene } from "../lib/scenes.js"
console.log("scenes:", SCENES.map(s => s.id).join(", "))
// scene fills the gaps
const a = applyScene({ title: "T", slides: [] }, "academic")
console.log("academic ->", JSON.stringify({ theme: a.theme, ratio: a.aspectRatio, fonts: a.fontStack }))
// explicit spec values win
const b = applyScene({ title: "T", slides: [], theme: "aqua", fontStack: "cjk-sans" }, "academic")
console.log("override  ->", JSON.stringify({ theme: b.theme, ratio: b.aspectRatio, fonts: b.fontStack }))
// unknown scene is a no-op
const c = applyScene({ title: "T", slides: [] }, "nope")
console.log("unknown   ->", JSON.stringify({ theme: c.theme, ratio: c.aspectRatio, fonts: c.fontStack }))
console.log("findScene case-insensitive:", findScene("TECH-TALK")?.id)
