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

// Pre-flight schema gate.
//
// A malformed tool schema does not degrade a single tool: the provider rejects
// every request in the session, so all turns fail until the plugin is disabled.
// This gate therefore applies the plugin for real and asserts the compiled
// shapes.
//
// It relies on `lib/host.js`, which reproduces the host's compile-and-validate
// pipeline (`parameterSchemaSpecToJsonSchema`, `valueSchemaSpecToJsonSchema`,
// `validateJsonSchemaValue`, lossless-JSON check). That means a definition which
// would fail at activation fails here instead — the earlier failure escaped
// because the first version of the assembly test stubbed `defineTool` with a
// no-op validator, so nothing checked the schemas at all.
import { defineTool, resolveConfig } from '../lib/host.js'
import { LAYOUTS } from '../lib/render.js'

const tools = []
const noop = () => {}
const ctx = {
  logger: { warn: noop, info: noop, error: noop },
  systemPrompt: { getSectionOrder: () => 500, section: noop },
  tools: { register: (definition) => tools.push(definition) },
  inject: (deps, cb) => { if (deps.includes('commands')) cb({ commands: { register: noop } }) },
  on: noop,
  get: () => undefined,
  effect: noop,
}

const config = resolveConfig({
  section: 'pre-flight schema gate',
  theme: 'metropolis',
  aspectRatio: '16-9',
  fontStack: 'sans',
  workdir: '',
  typstBinaryPath: '',
  timeoutMs: 180000,
  maxOutputBytes: 67108864,
  maxPages: 200,
  checkPpi: 110,
})

const mod = await import('../index.js')

// Applying the plugin compiles and validates every tool schema. A violation
// throws here rather than reaching the provider.
let failed = false
try {
  mod.apply(ctx, config)
} catch (error) {
  failed = true
  console.log('FAIL  plugin activation threw:')
  console.log(`      ${error.name}: ${error.message}`)
  if (Array.isArray(error.violations)) for (const v of error.violations) console.log(`        ${v}`)
  for (const line of String(error.stack ?? '').split('\n').slice(1, 5)) console.log(`      ${line.trim()}`)
}

console.log('')
for (const tool of tools) {
  const params = tool.parameters
  const rootOk = params?.type === 'object' && params.properties !== undefined
  const requiredOk = params.required === undefined || (Array.isArray(params.required) && params.required.every((k) => Object.hasOwn(params.properties, k)))
  const outputOk = tool.output?.schema?.type !== undefined
  const ok = rootOk && requiredOk && outputOk
  if (!ok) failed = true

  const declared = Object.keys(params.properties).length
  const needed = Array.isArray(params.required) ? params.required.length : 0
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${tool.name.padEnd(14)} params: object[${declared}]${needed > 0 ? ` required=${needed}` : ''}  output: ${tool.output.schema.type}`)
}

// The tool catalog must stay stable across mode transitions: the deck tools are
// registered whether or not the mode is active, which is what keeps the request
// prefix cache valid.
const names = tools.map((t) => t.name).sort()
const expected = ['deck_build', 'deck_check', 'deck_export', 'deck_scaffold', 'deck_status']
const catalogOk = JSON.stringify(names) === JSON.stringify(expected)
if (!catalogOk) failed = true
console.log('')
console.log(`  ${catalogOk ? 'OK  ' : 'FAIL'} tool catalog: ${names.join(', ')}`)
console.log(`  OK   page layouts exposed by deck_status: ${LAYOUTS.length}`)

console.log('')
if (failed) {
  console.log('SCHEMA GATE FAILED — do not install: a bad schema fails every request in the session.')
  process.exit(1)
}
console.log('Schema gate passed: every tool compiles to a valid object-rooted schema.')
