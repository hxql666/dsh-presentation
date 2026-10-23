// Every {{variable}} in the bundle patch must be one the host actually registers.
//
// A prompt section is assembled by substituting `{{name}}` groups, and the host throws
// on a name it does not know:
//
//   unknown prompt variable "{{cwd}}" in section "deployment:persona-suffix";
//   registered variables: provider, model
//
// That throw happens while the system prompt is assembled, so it fails the whole turn
// rather than the plugin row — the preset mounts, the session starts, and then every
// turn errors. Nothing about the patch looks wrong to a schema check, because the
// config value is a perfectly valid string; only the template contents are wrong.
//
// The host's registry cannot be read at build time (it lives inside the application),
// so the expected set is written here. That is deliberate: when the host's set changes,
// this test fails and someone has to decide whether the patch follows.
//
// Source of the list: `@deepseek-ai/dsh-agent-loop` calls `variable("provider")` and
// `variable("model")` and nothing else, in DSH 0.2.1-rc.2.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PATCH = path.join(PACKAGE_ROOT, 'cordis.patch.yml')

/** Prompt variables the host registers. */
const REGISTERED = ['provider', 'model']

let failures = 0
function check(label, condition, detail = '') {
  if (!condition) failures += 1
  console.log(`  ${condition ? 'OK  ' : 'FAIL'} ${label}${detail === '' ? '' : `  (${detail})`}`)
}

const patch = fs.readFileSync(PATCH, 'utf8')

// Comments are documentation, not patch data: a comment that quotes the failing
// message would otherwise read as a reference of its own. Only whole-line comments
// are removed, which is safe here because no block scalar in this patch has a content
// line beginning with `#`.
const data = patch
  .split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n')

console.log('=== references found in the patch ===')
const references = [...data.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)].map((match) => match[1])
if (references.length === 0) {
  console.log('  (none — the patch uses no prompt variables)')
} else {
  for (const name of references) console.log(`  {{${name}}}`)
}

console.log('')
console.log('=== every reference names a registered variable ===')
{
  const unknown = references.filter((name) => !REGISTERED.includes(name))
  check(
    'no reference uses an unregistered variable',
    unknown.length === 0,
    unknown.length === 0 ? `${references.length} reference(s)` : `unknown: ${unknown.join(', ')}`,
  )
  if (unknown.length > 0) {
    console.log(`      registered variables: ${REGISTERED.join(', ')}`)
    console.log('      an unknown one throws while the system prompt is assembled, failing every turn')
  }
}

console.log('')
console.log('=== no malformed references ===')
{
  // The host also rejects a `{{` that never closes, so counting the openers and
  // closers catches a typo the loop above would silently skip.
  const openers = (patch.match(/\{\{/g) ?? []).length
  const closers = (patch.match(/\}\}/g) ?? []).length
  check('every {{ is closed', openers === closers, `${openers} open, ${closers} close`)
}

console.log('')
console.log('=== the persona prefix is the only place a variable is used ===')
{
  // Not a rule the host enforces, but knowing where they are makes the list above
  // reviewable: a stray variable in a long guidance section is easy to miss. Reported
  // against the original line numbers, so the comment above about where the host's
  // list comes from stays findable.
  const numbered = patch.split('\n').map((line, index) => ({ line, index, comment: /^\s*#/.test(line) }))
  const at = numbered
    .filter((entry) => !entry.comment && /\{\{/.test(entry.line))
    .map((entry) => `${entry.index + 1}: ${entry.line.trim().slice(0, 100)}`)
  for (const line of at) console.log(`      ${line}`)
  check('variables appear only in the persona prefix', at.every((line) => /\bprefix:/.test(line)), at.join(' | '))
}

console.log('')
console.log(failures === 0 ? 'PROMPT VARIABLES VERIFIED' : `${failures} check(s) failed`)
process.exitCode = failures === 0 ? 0 : 1
