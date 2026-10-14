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

// Harness-free assembly test: call apply() with a mock Cordis context and drive
// the registered tools, so plugin-level mistakes surface before installation.
import fs from 'node:fs'

const root = scratch('dsh_work', '_probe_assemble')
fs.rmSync(root, { recursive: true, force: true })
fs.mkdirSync(root, { recursive: true })

const registered = { tools: new Map(), sections: [], commands: [], services: new Map(), events: [] }
let sectionOrderCalls = 0

// The mode state is folded from the command records the host's command registry
// writes: `command/run` before the handler, `command/done` after it settles.
// This double logs that pair, so the derivation under test is the real one.
const fakeSession = {
  header: { cwd: root },
  events: [],
  snapshotEvents(from = 0) { return this.events.filter((event) => event.seq >= from) },
  append(type, data) {
    this.events.push({ type, seq: this.events.length, time: Date.now(), data })
  },
}
let commandSeq = 0
const runCommand = (command, rawInput) => {
  const commandId = `cmd-${++commandSeq}`
  fakeSession.append('command/run', { commandId, name: command.name, args: rawInput, source: { kind: 'user' } })
  const result = command.handler({ agent, rawInput })
  fakeSession.append('command/done', { commandId, kind: result.kind, ...(result.text === undefined ? {} : { text: result.text }) })
  return result
}

// A projection double lets the harness exercise the open-turn path; the real
// one is `ctx.sessionProjections.stateOf(session, 'turnBoundary')`.
let openTurnStartSeq = null

const ctx = {
  logger: { warn: (...a) => console.log('[warn]', ...a), info: () => {}, error: (...a) => console.log('[error]', ...a) },
  systemPrompt: {
    getSectionOrder: () => { sectionOrderCalls += 1; return 500 },
    section: (definition) => { registered.sections.push(definition) },
  },
  tools: {
    register: (definition) => { registered.tools.set(definition.name, definition) },
  },
  inject: (deps, callback) => {
    // The plugin asks for `commands` here; supply a registry that records.
    if (deps.includes('commands')) {
      callback({ commands: { register: (definition) => { registered.commands.push(definition) } } })
    }
  },
  on: (event, handler) => { registered.events.push({ event, handler }) },
  set: (name, value) => { registered.services.set(name, value) },
  get: (name) => (name === 'sessionProjections' ? { stateOf: () => ({ openTurnStartSeq }) } : undefined),
  effect: () => {},
}

const config = {
  section: 'You are in presentation-document mode.',
  theme: 'metropolis',
  aspectRatio: '16-9',
  fontStack: 'sans',
  workdir: '',
  typstBinaryPath: '',
  timeoutMs: 180000,
  maxOutputBytes: 64 * 1024 * 1024,
  maxPages: 200,
  checkPpi: 110,
}

const mod = await import('../index.js')
const { resolveConfig } = await import('../lib/host.js')
console.log('exports:', Object.keys(mod).join(', '))
console.log('inject:', JSON.stringify(mod.inject))
console.log('configFields:', (mod.configFields ?? []).map((f) => f.key).join(', '))

mod.apply(ctx, resolveConfig(config))

console.log('\n--- registration ---')
console.log('sections:', registered.sections.map((s) => `${s.name}@${s.order}`).join(', '))
console.log('commands:', registered.commands.map((c) => c.name).join(', '))
console.log('tools:', [...registered.tools.keys()].join(', '))
console.log('events:', registered.events.map((e) => e.event).join(', '))
console.log('services:', [...registered.services.keys()].join(', '))

// Guidance section must be empty while the mode is inactive.
console.log('\n--- guidance gating ---')
const injected = []
const agent = { session: fakeSession, inject: (message) => { injected.push(message) } }
console.log('inactive ->', JSON.stringify(registered.sections[0].text({ agent })))

// Drive /deck the way the host's command registry does: log the pair around
// the handler, so the mode state under test is the one folded from the log.
console.log('\n--- /deck command ---')
const command = registered.commands[0]
const sectionText = () => JSON.stringify(registered.sections[0].text({ agent }))
const lastNotice = () => injected.at(-1)?.content?.[0]?.text ?? null

console.log('bare  ->', JSON.stringify(runCommand(command, '')))
console.log('logged event types:', fakeSession.events.map((e) => e.type).join(', '))
console.log('active ->', sectionText())
console.log('notice ->', JSON.stringify(lastNotice()))

console.log('/deck theme:stargazer ->', JSON.stringify(runCommand(command, 'theme:stargazer')))
console.log('  handout stays off, theme from the log:', JSON.stringify(await (async () => {
  const state = await registered.tools.get('deck_status').execute({}, { agent })
  return { active: state.active, theme: state.theme, handout: state.handout }
})()))

console.log('/deck handout ->', JSON.stringify(runCommand(command, 'handout')))
console.log('  notice ->', JSON.stringify(lastNotice()))

// A turn in flight cannot take a narration into a request that was already
// assembled, so the switch queues until the next accepted pre-step.
console.log('\n--- open turn ---')
openTurnStartSeq = 7
const injectedBefore = injected.length
console.log('/deck off ->', JSON.stringify(runCommand(command, 'off')))
console.log('  notice held back for the boundary:', injected.length === injectedBefore)
openTurnStartSeq = null
const preStep = registered.events.find((e) => e.event === 'agent/pre-step').handler
const decision = await preStep({ agent, signal: { aborted: false } }, async () => ({ kind: 'accept', messages: [] }))
console.log('  pre-step notices:', decision.messages.map((m) => m.content[0].text))
console.log('active after off ->', sectionText())

// A refused argument must not move the state.
console.log('/deck bogus ->', JSON.stringify(runCommand(command, 'bogus')))
console.log('active after bogus ->', sectionText())

runCommand(command, '')
console.log('re-entered ->', sectionText())

// Tools must reject outside the mode, accept inside.
console.log('\n--- tool gating ---')
const deckStatus = registered.tools.get('deck_status')
const status = await deckStatus.execute({}, { agent })
console.log('deck_status ok:', status.active, '| layouts:', status.layouts.length, '| engine:', JSON.stringify(status.engine))

const spec = {
  title: '装配验证',
  subtitle: 'mock context',
  author: 'DSH',
  slides: [
    { layout: 'cover' },
    { layout: 'bullets', title: '要点', items: [{ text: '结构化数据', detail: '版式由原语库保证' }, '第二项'] },
    { layout: 'kpis', title: '指标', items: [{ value: '0.15.1', label: 'Typst', note: '锁定' }] },
  ],
}

const deckBuild = registered.tools.get('deck_build')
const result = await deckBuild.execute({ spec }, { agent })
console.log('deck_build ok:', result.ok, '| pdf:', result.pdf, '| pages:', result.pages, '| bytes:', result.bytes)
if (!result.ok) console.log('diagnostics:', JSON.stringify(result.diagnostics, null, 2), '\nstderr:', result.stderr)

const check = registered.tools.get('deck_check')
const checked = await check.execute({ pages: [1] }, { agent })
console.log('deck_check ok:', checked.ok, '| images:', checked.images?.length, checked.images?.[0] ?? '')

const notes = registered.tools.get('deck_export')
const exported = await notes.execute({ what: 'notes' }, { agent })
console.log('deck_export notes ok:', exported.ok, '| file:', exported.file, '| bytes:', exported.bytes)

const scaffold = registered.tools.get('deck_scaffold')
const scaffolded = await scaffold.execute({ spec }, { agent })
console.log('deck_scaffold ok:', scaffolded.ok, '| spec:', scaffolded.specFile, '| typ:', scaffolded.typFile)

// The provider rejects the whole request when a tool's `parameters` is not an
// object-rooted raw JSON Schema — the failure that made every turn fail once
// the plugin was installed. Assert the compiled roots here too.
console.log('\n--- wire schemas ---')
let schemaBad = 0
for (const [name, definition] of registered.tools) {
  const root = definition.parameters ?? {}
  const ok = root.type === 'object' && typeof root.properties === 'object'
  if (!ok) schemaBad += 1
  console.log(`${ok ? 'ok  ' : 'BAD '} ${name}: type=${root.type} required=${JSON.stringify(root.required ?? [])}`)
}
if (schemaBad > 0) {
  console.log(`ERROR: ${schemaBad} tool(s) would be rejected by the provider`)
  process.exitCode = 1
}

// Leave the mode, then confirm a call outside it is refused with text the model
// can act on: it must name the command to ask for and what the mode provides,
// not merely decline. Mode state comes from logged command events, so a tool
// cannot select the mode itself and the rejection text is the only signal.
console.log('\n--- leave mode, then refusal quality ---')
console.log('off ->', JSON.stringify(runCommand(command, 'off')))
console.log('section after off ->', sectionText())
try {
  await deckBuild.execute({ spec }, { agent })
  console.log('ERROR: deck_build should have refused outside the mode')
  process.exitCode = 1
} catch (error) {
  const message = String(error.message)
  const namesCommand = message.includes('/deck')
  const namesCapability = message.includes('layout') && message.includes('PDF')
  const namesLocation = message.includes('deck')
  console.log('refused as expected')
  console.log(`  names the command to ask for: ${namesCommand}`)
  console.log(`  states what the mode provides: ${namesCapability}`)
  console.log(`  states where decks are written: ${namesLocation}`)
  if (!namesCommand || !namesCapability || !namesLocation) {
    console.log('ERROR: the refusal is not actionable; a model cannot recover from it')
    console.log(`  message was: ${message.slice(0, 200)}`)
    process.exitCode = 1
  }
}

// The log is the only record: a session rebuilt from the same events must read
// back the same mode, and must not contain an event type of the plugin's own.
console.log('\n--- log-only state ---')
const { readModeState, isActive, MODE_COMMAND } = await import('../lib/mode.js')
const rebooted = { ...fakeSession, events: fakeSession.events.map((event) => ({ ...event })) }
const events = rebooted.snapshotEvents()
const foreign = events.filter((event) => !['command/run', 'command/done'].includes(event.type))
console.log(`logged rows: ${events.length} (${foreign.length} plugin-authored)`)
console.log(`unknown event types would refuse a reopen: ${foreign.length > 0}`)
console.log(`folded state: ${JSON.stringify(readModeState(rebooted))} active=${isActive(rebooted)} command=${MODE_COMMAND}`)
if (foreign.length > 0) process.exitCode = 1
