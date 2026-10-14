// Part of the @hxql666/dsh-presentation test suite. Run it from anywhere:
//
//   node <this file>
//
// Build output goes to DSH_PRESENTATION_SCRATCH (default: the package's
// .test-output directory), so a run never writes outside the checkout.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRATCH = process.env.DSH_PRESENTATION_SCRATCH ?? path.join(PACKAGE_ROOT, '.test-output')

/** A scratch path for one test's build output. */
function scratch(...segments) {
  return path.join(SCRATCH, ...segments)
}

import { buildDeckPdf } from "../lib/build.js"

// A deck whose pages animate: extra items are revealed with #pause, so the
// presentation form has more physical pages than the logical slide count.
const spec = {
  title: "Handout check",
  slides: [
    { layout: "cover" },
    {
      layout: "bullets",
      title: "Animated page",
      items: ["first", "second", "third"],
    },
    {
      layout: "steps",
      title: "More animation",
      items: [{ text: "one" }, { text: "two" }],
    },
  ],
}

const presentation = await buildDeckPdf({
  spec,
  buildDir: scratch('dsh_work', '_probe_handout', 'present'),
  outFile: scratch('dsh_work', '_probe_handout', 'present.pdf'),
})
const handout = await buildDeckPdf({
  spec,
  buildDir: scratch('dsh_work', '_probe_handout', 'handout'),
  outFile: scratch('dsh_work', '_probe_handout', 'handout.pdf'),
  handout: true,
})

console.log("presentation ok:", presentation.ok, "pages:", presentation.pages, "bytes:", presentation.bytes)
console.log("handout      ok:", handout.ok, "pages:", handout.pages, "bytes:", handout.bytes)
if (!presentation.ok) console.log("presentation stderr:", (presentation.stderr||"").split("\n").slice(0,3).join("\n"))
if (!handout.ok) console.log("handout stderr:", (handout.stderr||"").split("\n").slice(0,3).join("\n"))

// Both forms compile. These layouts emit no subslides, so an equal page count
// is correct and is NOT the property to check — the earlier version of this
// test asserted fewer pages and therefore proved nothing. What matters is that
// the handout flag reaches the template, which is what the generated source
// shows: before the fix it was never emitted, and the two PDFs differed for no
// reason at all.
const handoutSource = fs.readFileSync(path.join(scratch('dsh_work', '_probe_handout', 'handout'), 'body.typ'), 'utf8')
const presentationSource = fs.readFileSync(path.join(scratch('dsh_work', '_probe_handout', 'present'), 'body.typ'), 'utf8')

const handoutEmitsFlag = /^\s*handout: true,\s*$/m.test(handoutSource)
const presentationOmitsFlag = !/^\s*handout: true,\s*$/m.test(presentationSource)

console.log('')
console.log(`handout source emits "handout: true": ${handoutEmitsFlag}`)
console.log(`presentation source omits it:            ${presentationOmitsFlag}`)
console.log(`page counts: presentation=${presentation.pages} handout=${handout.pages} (equal is expected: no subslides)`)

const ok = presentation.ok && handout.ok && handoutEmitsFlag && presentationOmitsFlag
console.log('')
console.log(ok ? 'VERIFIED: the handout flag reaches the template' : 'FAIL: the handout flag is not wired through')
process.exitCode = ok ? 0 : 1
