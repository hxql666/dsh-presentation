/**
 * Small local replacements for the `@deepseek-ai/*` helpers this plugin needs.
 *
 * A plugin installed into a profile from a workspace path is loaded from that
 * path, and the host's own module graph — `@deepseek-ai/dsh-tools`,
 * `@deepseek-ai/schemastery`, `@deepseek-ai/dsh-llm` — is not resolvable from
 * there. Packages that ship with the distribution (for example `dshmarket`)
 * resolve because they are installed inside it; a `link:` dependency cannot.
 *
 * Everything the plugin needs from those packages is therefore reproduced here,
 * and the registries themselves are obtained from `ctx`, which is always
 * available. This module deliberately imports nothing outside Node builtins.
 *
 * `defineTool` reproduces the host helper's contract *including schema
 * compilation*, and that part is not cosmetic. A tool's `parameters` reach the
 * model request verbatim — the registry projects them, it does not compile
 * them — so a definition still in the author-facing DSL arrives at the provider
 * as an object with no `type` and the provider rejects the whole request
 * (`Invalid schema for function ...: schema must be a JSON Schema of type
 * "object", got "type: null"`), which fails every turn in the session. The
 * author DSL is `{ spec: { type: 'object', required: true, ... } }`; the raw
 * schema the provider must see is `{ type: 'object', properties: { spec: ... },
 * required: ['spec'] }`. Both `parameters` and `output.schema` are author DSL
 * here, exactly as in `@deepseek-ai/dsh-tools`, and both are asserted against
 * the enforced raw subset before the definition is returned.
 *
 * @module @hxql666/dsh-presentation/lib/host
 */

/** Annotation keywords the DSL copies through to the raw schema. */
const ANNOTATION_KEYS = ['description', 'title', 'default', 'examples']
/** Keywords the enforced raw subset understands. */
const CONSTRAINT_KEYWORDS = ['type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const']
/** Node types the enforced raw subset accepts. */
const SCHEMA_TYPES = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']
/** Constraint keywords that cannot sit beside `oneOf`. */
const ONE_OF_SIBLINGS = ['properties', 'required', 'additionalProperties', 'items', 'enum', 'const']
/** Constraint keyword -> the node types that may own it. */
const KEYWORD_OWNERS = {
  properties: ['object'],
  required: ['object'],
  additionalProperties: ['object'],
  items: ['array'],
  enum: ['string', 'number', 'integer', 'boolean', 'null'],
  const: ['string', 'number', 'integer', 'boolean', 'null'],
}

/** A schema that falls outside the enforced subset. Mirrors the host error. */
export class JsonSchemaError extends Error {
  /**
   * @param {string[]} violations One message per offending path.
   */
  constructor(violations) {
    super(`unsupported JSON schema: ${violations.join('; ')}`)
    this.name = 'JsonSchemaError'
    this.violations = violations
  }
}

/** Invalid model-generated arguments for a typed tool. Mirrors the host error. */
export class ToolArgsError extends Error {
  /**
   * @param {string[]} violations One message per offending path.
   */
  constructor(violations) {
    super(`invalid arguments: ${violations.join('; ')}`)
    this.name = 'ToolArgsError'
    this.violations = violations
  }
}

/** A tool returned a value outside its declared output schema. Mirrors the host error. */
export class ToolOutputError extends Error {
  /**
   * @param {string} toolName The tool whose value failed.
   * @param {string[]} violations One message per offending path.
   */
  constructor(toolName, violations) {
    super(`tool "${toolName}" returned an invalid value: ${violations.join('; ')}`)
    this.name = 'ToolOutputError'
    this.violations = violations
  }
}

/** Throw one author-schema violation through the shared schema error type. */
function authorError(message) {
  throw new JsonSchemaError([message])
}

/** Whether a value is a plain record, as opposed to an array or a class instance. */
function isSchemaRecord(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === null || Object.getPrototypeOf(prototype) === null
}

/** Whether a value survives a JSON round trip unchanged. */
function isLosslessJsonValue(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value) && !Object.is(value, -0)
  if (typeof value !== 'object') return false
  if (seen.has(value)) return false
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      return Reflect.ownKeys(value).length === value.length + 1 && value.every((entry) => isLosslessJsonValue(entry, seen))
    }
    if (!isSchemaRecord(value)) return false
    return Object.values(value).every((entry) => isLosslessJsonValue(entry, seen))
  } finally {
    seen.delete(value)
  }
}

/** Copy own annotation fields for validation by the raw-schema boundary. */
function copyAnnotations(source, target) {
  for (const key of ANNOTATION_KEYS) {
    if (Object.hasOwn(source, key)) target[key] = source[key]
  }
}

/** Reject author-only keys outside one node's declared vocabulary. */
function assertAuthorKeys(source, path, allowed) {
  for (const key of Object.keys(source)) {
    if (!allowed.includes(key)) authorError(`${path}.${key} is not supported by the value schema DSL`)
  }
}

/** Whether a scalar matches one declared schema type. */
function scalarMatches(type, value) {
  switch (type) {
    case 'string': return typeof value === 'string'
    case 'number': return typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)
    case 'integer': return typeof value === 'number' && Number.isInteger(value) && !Object.is(value, -0)
    case 'boolean': return typeof value === 'boolean'
    case 'null': return value === null
    default: return false
  }
}

// --- the author DSL -> enforced raw JSON Schema ----------------------------

/**
 * Compile one author value node to its raw schema node.
 *
 * @param {object} input    Author node.
 * @param {string} path     Diagnostic path.
 * @param {boolean} allowRequired Whether this node may carry `required: true`.
 * @param {Set<object>} seen Nodes on the current path, for cycle detection.
 * @returns {object} A raw schema node.
 */
function compileValue(input, path, allowRequired, seen) {
  if (!isSchemaRecord(input)) authorError(`${path} must be a value schema object`)
  if (seen.has(input)) authorError(`${path} is circular`)
  seen.add(input)
  try {
    const authorKeys = [...ANNOTATION_KEYS, ...(allowRequired ? ['required'] : [])]
    const node = {}

    if (Object.hasOwn(input, 'oneOf')) {
      assertAuthorKeys(input, path, [...authorKeys, 'oneOf', 'type'])
      if (Object.hasOwn(input, 'type')) authorError(`${path} cannot declare both type and oneOf`)
      if (!Array.isArray(input.oneOf) || input.oneOf.length < 2) {
        authorError(`${path}.oneOf must be an array of at least two value schemas`)
      }
      const branches = []
      node.oneOf = branches
      copyAnnotations(input, node)
      branches.push(...input.oneOf.map((branch, index) => compileValue(branch, `${path}.oneOf[${index}]`, false, seen)))
      return node
    }

    switch (Object.hasOwn(input, 'type') ? input.type : undefined) {
      case 'json':
        assertAuthorKeys(input, path, [...authorKeys, 'type'])
        copyAnnotations(input, node)
        return node
      case 'object': {
        assertAuthorKeys(input, path, [...authorKeys, 'type', 'properties', 'additionalProperties'])
        if (typeof input.additionalProperties !== 'boolean') {
          authorError(`${path}.additionalProperties must be explicitly true or false`)
        }
        node.type = 'object'
        copyAnnotations(input, node)
        node.additionalProperties = input.additionalProperties
        if (Object.hasOwn(input, 'properties')) {
          const compiled = compilePropertyMap(input.properties, `${path}.properties`, seen)
          node.properties = compiled.properties
          if (compiled.required !== undefined) node.required = compiled.required
        }
        return node
      }
      case 'array':
        assertAuthorKeys(input, path, [...authorKeys, 'type', 'items'])
        node.type = 'array'
        copyAnnotations(input, node)
        if (Object.hasOwn(input, 'items')) {
          node.items = compileValue(input.items, `${path}.items`, false, seen)
        }
        return node
      case 'string':
      case 'number':
      case 'integer':
      case 'boolean':
      case 'null':
        assertAuthorKeys(input, path, [...authorKeys, 'type', 'enum', 'const'])
        node.type = input.type
        copyAnnotations(input, node)
        if (Object.hasOwn(input, 'enum')) {
          if (!Array.isArray(input.enum) || input.enum.length === 0) {
            authorError(`${path}.enum must be a non-empty array of scalar values`)
          }
          node.enum = [...input.enum]
        }
        if (Object.hasOwn(input, 'const')) node.const = input.const
        return node
      default:
        return authorError(`${path}.type must be string/number/integer/boolean/null/array/object/json, or use oneOf`)
    }
  } finally {
    seen.delete(input)
  }
}

/**
 * Compile one author property map, collecting per-property requiredness.
 *
 * @param {object} input Property name -> author node.
 * @param {string} path  Diagnostic path.
 * @param {Set<object>} seen Nodes on the current path, for cycle detection.
 * @returns {{ properties: object, required?: string[] }} The compiled map.
 */
function compilePropertyMap(input, path, seen) {
  if (!isSchemaRecord(input)) authorError(`${path} must be an object of value schemas`)
  if (seen.has(input)) authorError(`${path} is circular`)
  seen.add(input)
  try {
    const properties = {}
    const required = []
    for (const [key, node] of Object.entries(input)) {
      if (!isSchemaRecord(node)) authorError(`${path}.${key} must be a value schema object`)
      if (Object.hasOwn(node, 'required')) {
        if (node.required !== true) authorError(`${path}.${key}.required must be true when present`)
        required.push(key)
      }
      properties[key] = compileValue(node, `${path}.${key}`, true, seen)
    }
    return required.length === 0 ? { properties } : { properties, required }
  } finally {
    seen.delete(input)
  }
}

/**
 * Compile the implicit open parameter object into raw JSON Schema.
 *
 * @param {object} spec Per-property author nodes.
 * @returns {object} An object-rooted raw schema.
 */
export function parameterSchemaSpecToJsonSchema(spec) {
  const compiled = compilePropertyMap(spec ?? {}, 'parameters', new Set())
  const schema = {
    type: 'object',
    properties: compiled.properties,
    ...(compiled.required === undefined ? {} : { required: compiled.required }),
  }
  assertSupportedJsonSchema(schema)
  return schema
}

/**
 * Compile one author value schema — a tool output, for example — into raw JSON
 * Schema.
 *
 * @param {object} spec Author node.
 * @returns {object} The asserted raw schema projection.
 */
export function valueSchemaSpecToJsonSchema(spec) {
  const schema = compileValue(spec, 'schema', false, new Set())
  assertSupportedJsonSchema(schema)
  return schema
}

// --- the enforced raw subset ----------------------------------------------

/**
 * Collect every violation in one raw schema tree.
 *
 * @param {unknown} root Candidate schema.
 * @param {string} rootPath Path label for diagnostics.
 * @param {string[]} violations Collector.
 * @param {Set<object>} seen Nodes on the current path, for cycle detection.
 */
function checkSchemaNode(root, rootPath, violations, seen) {
  if (!isSchemaRecord(root)) {
    violations.push(`${rootPath} must be a schema object`)
    return
  }
  if (seen.has(root)) {
    violations.push(`${rootPath} is circular`)
    return
  }
  seen.add(root)
  try {
    checkSchemaBody(root, rootPath, violations, seen)
  } finally {
    seen.delete(root)
  }
}

/** Check one node's keywords and recurse into its children. */
function checkSchemaBody(node, path, violations, seen) {
  for (const key of Object.keys(node)) {
    if (CONSTRAINT_KEYWORDS.includes(key)) continue
    if (ANNOTATION_KEYS.includes(key)) {
      if (!isLosslessJsonValue(node[key])) violations.push(`${path}.${key} annotation must be lossless JSON data`)
      continue
    }
    violations.push(
      `${path}.${key} is not a supported keyword (subset: type/oneOf/properties/required/additionalProperties/items/enum/const + annotations)`,
    )
  }
  if (Object.hasOwn(node, 'description') && typeof node.description !== 'string') {
    violations.push(`${path}.description must be a string`)
  }
  if (Object.hasOwn(node, 'title') && typeof node.title !== 'string') {
    violations.push(`${path}.title must be a string`)
  }

  const hasType = Object.hasOwn(node, 'type')
  const hasOneOf = Object.hasOwn(node, 'oneOf')
  if (hasType && hasOneOf) {
    violations.push(`${path} cannot declare both type and oneOf`)
    return
  }
  if (!hasType && !hasOneOf) {
    for (const key of ONE_OF_SIBLINGS) {
      if (Object.hasOwn(node, key)) violations.push(`${path}.${key} requires type or oneOf`)
    }
    return
  }
  if (hasOneOf) {
    for (const key of ONE_OF_SIBLINGS) {
      if (Object.hasOwn(node, key)) violations.push(`${path}.${key} is not supported beside oneOf`)
    }
    if (!Array.isArray(node.oneOf) || node.oneOf.length < 2) {
      violations.push(`${path}.oneOf must be an array of at least two schemas`)
      return
    }
    node.oneOf.forEach((branch, index) => checkSchemaNode(branch, `${path}.oneOf[${index}]`, violations, seen))
    return
  }

  const type = node.type
  if (typeof type !== 'string' || !SCHEMA_TYPES.includes(type)) {
    violations.push(Array.isArray(type)
      ? `${path}.type must be a single type string (type arrays are not supported)`
      : `${path}.type must be one of ${SCHEMA_TYPES.join('/')}`)
    return
  }
  for (const [key, owners] of Object.entries(KEYWORD_OWNERS)) {
    if (Object.hasOwn(node, key) && !owners.includes(type)) {
      violations.push(`${path}.${key} is not supported on type "${type}"`)
    }
  }

  switch (type) {
    case 'object': {
      const properties = Object.hasOwn(node, 'properties') ? node.properties : {}
      if (Object.hasOwn(node, 'properties') && !isSchemaRecord(properties)) {
        violations.push(`${path}.properties must be an object of schemas`)
      } else {
        for (const [key, child] of Object.entries(properties)) {
          checkSchemaNode(child, `${path}.properties.${key}`, violations, seen)
        }
      }
      if (Object.hasOwn(node, 'required')) {
        if (!Array.isArray(node.required) || node.required.some((entry) => typeof entry !== 'string')) {
          violations.push(`${path}.required must be an array of strings`)
        } else {
          for (const key of node.required) {
            if (!Object.hasOwn(properties, key)) violations.push(`${path}.required names "${key}" which is not in properties`)
          }
        }
      }
      if (Object.hasOwn(node, 'additionalProperties') && typeof node.additionalProperties !== 'boolean') {
        violations.push(`${path}.additionalProperties must be a boolean`)
      }
      return
    }
    case 'array':
      if (Object.hasOwn(node, 'items')) checkSchemaNode(node.items, `${path}.items`, violations, seen)
      return
    default: {
      if (Object.hasOwn(node, 'enum')) {
        const valid = Array.isArray(node.enum) && node.enum.length > 0 && node.enum.every((entry) => scalarMatches(type, entry))
        if (!valid) {
          violations.push(`${path}.enum must be a non-empty array of ${type} values`)
          return
        }
      }
      if (Object.hasOwn(node, 'const') && !scalarMatches(type, node.const)) {
        violations.push(`${path}.const must be a ${type} value`)
        return
      }
      if (Object.hasOwn(node, 'const') && Object.hasOwn(node, 'enum') && !node.enum.includes(node.const)) {
        violations.push(`${path}.const must be one of ${path}.enum when both are declared`)
      }
    }
  }
}

/**
 * Assert that an arbitrary raw schema uses only the enforced subset.
 * Annotation-only schemas are accepted as the standard unconstrained-JSON form.
 *
 * @param {unknown} schema Untrusted raw JSON Schema.
 */
export function assertSupportedJsonSchema(schema) {
  const violations = []
  checkSchemaNode(schema, 'schema', violations, new Set())
  if (violations.length > 0) throw new JsonSchemaError(violations)
}

// --- argument validation --------------------------------------------------

/** Root-aware diagnostic path for the parameter validator's empty sentinel. */
function diagnosticPath(path) {
  return path === '' ? 'arguments' : path
}

/** Append one object property without a leading dot at an implicit root. */
function propertyPath(path, key) {
  return path === '' ? key : `${path}.${key}`
}

/**
 * Validate one candidate value against an asserted raw schema.
 *
 * @param {object} node Raw schema node.
 * @param {unknown} value Candidate value.
 * @param {string} path Diagnostic path.
 * @param {string[]} out Collector.
 */
function checkValue(node, value, path, out) {
  const at = diagnosticPath(path)
  if (Object.hasOwn(node, 'oneOf')) {
    const matches = node.oneOf.filter((branch) => {
      const branchViolations = []
      checkValue(branch, value, path, branchViolations)
      return branchViolations.length === 0
    }).length
    if (matches !== 1) out.push(`"${at}" must match exactly one oneOf branch (matched ${matches})`)
    return
  }

  const type = Object.hasOwn(node, 'type') ? node.type : undefined
  if (type === undefined) {
    if (!isLosslessJsonValue(value)) out.push(`"${at}" must be a lossless JSON value`)
    return
  }

  if (type === 'object') {
    if (!isSchemaRecord(value)) {
      out.push(`"${at}" must be an object`)
      return
    }
    const properties = node.properties ?? {}
    const before = out.length
    for (const key of node.required ?? []) {
      if (!Object.hasOwn(value, key) || value[key] === undefined) {
        out.push(`missing required property "${propertyPath(path, key)}"`)
      }
    }
    for (const [key, child] of Object.entries(properties)) {
      if (Object.hasOwn(value, key) && value[key] !== undefined) checkValue(child, value[key], propertyPath(path, key), out)
    }
    if (node.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(properties, key)) {
          out.push(`"${propertyPath(path, key)}" is not a declared property (additionalProperties: false)`)
        }
      }
    }
    if (out.length === before && !isLosslessJsonValue(value)) out.push(`"${at}" must be a lossless JSON object`)
    return
  }

  if (type === 'array') {
    if (!Array.isArray(value)) {
      out.push(`"${at}" must be an array`)
      return
    }
    const before = out.length
    if (Object.hasOwn(node, 'items')) {
      value.forEach((entry, index) => checkValue(node.items, entry, `${path}[${index}]`, out))
    }
    if (out.length === before && !isLosslessJsonValue(value)) out.push(`"${at}" must be a dense lossless JSON array`)
    return
  }

  const matches = scalarMatches(type, value)
  if (!matches) {
    out.push(type === 'integer'
      ? `"${at}" must be an integer`
      : type === 'number'
        ? (typeof value !== 'number' ? `"${at}" must be a number` : `"${at}" must be a finite JSON number`)
        : `"${at}" must be a ${type}`)
    return
  }
  if (Object.hasOwn(node, 'enum') && !node.enum.includes(value)) {
    out.push(`"${at}" must be one of ${JSON.stringify(node.enum)}`)
  }
  if (Object.hasOwn(node, 'const') && value !== node.const) {
    out.push(`"${at}" must be ${JSON.stringify(node.const)}`)
  }
}

/**
 * Validate a candidate value against an asserted raw schema.
 *
 * @param {object} schema Schema accepted by {@link assertSupportedJsonSchema}.
 * @param {unknown} value Candidate JSON value.
 * @param {string} [path] Root label used in diagnostics.
 * @returns {string[]} Path-qualified violations; empty means valid.
 */
export function validateJsonSchemaValue(schema, value, path = 'value') {
  const violations = []
  checkValue(schema, value, path, violations)
  return violations
}

/**
 * Validate model-generated arguments against an author parameter schema.
 *
 * @param {object} spec Author property map.
 * @param {unknown} args Candidate arguments.
 * @returns {string[]} Path-qualified violations; empty means valid.
 */
export function validateArgs(spec, args) {
  return validateJsonSchemaValue(parameterSchemaSpecToJsonSchema(spec), args, '')
}

/**
 * Stand-in for `defineTool`. The host helper validates the definition, compiles
 * both schemas to the enforced raw subset, brands the result, and rejects
 * invalid arguments before `execute` runs; all four are reproduced here, so a
 * definition written for one is a definition written for the other.
 *
 * @param {object} definition Author definition carrying the DSL schemas.
 * @returns {object} A registry-ready definition.
 */
export function defineTool(definition) {
  if (definition === null || typeof definition !== 'object') throw new TypeError('defineTool needs a definition object')
  if (typeof definition.name !== 'string' || definition.name === '') throw new TypeError('defineTool needs a non-empty name')
  if (typeof definition.description !== 'string' || definition.description === '') {
    throw new TypeError(`tool ${definition.name} needs a description`)
  }
  if (typeof definition.execute !== 'function') throw new TypeError(`tool ${definition.name} needs an execute function`)
  if (definition.parameters !== undefined && (typeof definition.parameters !== 'object' || definition.parameters === null)) {
    throw new TypeError(`tool ${definition.name} needs an object for parameters`)
  }
  if (definition.output === undefined || typeof definition.output !== 'object' || typeof definition.output.render !== 'function') {
    throw new TypeError(`tool ${definition.name} must declare output { schema, render }`)
  }

  const parameters = parameterSchemaSpecToJsonSchema(definition.parameters ?? {})
  const outputSchema = valueSchemaSpecToJsonSchema(definition.output.schema)
  const validate = (args) => validateJsonSchemaValue(parameters, args, '')

  const tool = {
    ...definition,
    parameters,
    output: { ...definition.output, schema: outputSchema },
    async execute(args, exec) {
      const violations = validate(args)
      if (violations.length > 0) throw new ToolArgsError(violations)
      const value = await definition.execute(args, exec)
      // The host validates the returned value — lossless JSON first, then the
      // declared schema — so the same refusal happens here instead of after
      // installation, where it can only surface as a failed tool call.
      if (!isLosslessJsonValue(value)) throw new ToolOutputError(definition.name, ['value is not lossless JSON'])
      const outputViolations = validateJsonSchemaValue(outputSchema, value, 'value')
      if (outputViolations.length > 0) throw new ToolOutputError(definition.name, outputViolations)
      return value
    },
  }

  // Presentation is display-only and may replay logged arguments from an older
  // schema, so it validates softly and falls back to the generic card.
  if (typeof definition.presentCall === 'function') {
    const presentCall = definition.presentCall
    tool.presentCall = (args) => (validate(args).length > 0 ? undefined : presentCall(args))
  }
  if (typeof definition.isConcurrencySafe === 'function') {
    const isConcurrencySafe = definition.isConcurrencySafe
    tool.isConcurrencySafe = (args) => (validate(args).length > 0 ? false : isConcurrencySafe(args))
  }
  return tool
}

/**
 * Build a user-role message. Mirrors `createUserMessage` from
 * `@deepseek-ai/dsh-llm`: attach the role and a stable id.
 *
 * @param {{ content: object[], source: object }} input
 * @returns {object} a frozen user message.
 */
export function createUserMessage(input) {
  return Object.freeze({
    ...input,
    role: 'user',
    id: `presentation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
  })
}

/**
 * A tiny description of the configuration this plugin accepts.
 *
 * The host derives a plugin's settings page from a Schemastery `Config` export.
 * This plugin is installed by path and cannot import Schemastery, so instead of
 * a schema object it exports this plain description and validates the row's
 * config itself; the settings page then shows the row's raw config.
 */
export const CONFIG_FIELDS = [
  { key: 'section', type: 'string', required: true, description: 'Guidance text injected while presentation-document mode is active.' },
  { key: 'theme', type: 'string', default: 'metropolis', description: 'Default Touying theme.' },
  { key: 'aspectRatio', type: 'string', default: '16-9', description: 'Default frame aspect ratio.' },
  { key: 'fontStack', type: 'string', default: 'sans', description: 'Default font stack key.' },
  { key: 'locale', type: 'string', default: 'zh', description: 'Default locale key; selects the Typst language facts used for line breaking and punctuation.' },
  { key: 'workdir', type: 'string', default: '', description: 'Deck directory, relative to the session workspace. Empty means "deck".' },
  { key: 'typstBinaryPath', type: 'string', default: '', description: 'Explicit Typst executable. Empty uses the bundled, hash-verified binary.' },
  { key: 'timeoutMs', type: 'number', default: 180000, description: 'Per-compilation deadline.' },
  { key: 'maxOutputBytes', type: 'number', default: 67108864, description: 'Largest PDF this plugin will accept.' },
  { key: 'maxPages', type: 'number', default: 200, description: 'Largest page count this plugin will render or accept.' },
  { key: 'checkPpi', type: 'number', default: 110, description: 'Raster resolution for the visual self-review step.' },
]

/**
 * Apply defaults and reject unknown or mistyped configuration keys.
 *
 * @param {object} raw The row's config.
 * @returns {object} the resolved config.
 */
export function resolveConfig(raw) {
  const input = raw === null || raw === undefined || typeof raw !== 'object' ? {} : raw
  const known = new Set(CONFIG_FIELDS.map((field) => field.key))
  const unknown = Object.keys(input).filter((key) => !known.has(key))
  if (unknown.length > 0) {
    throw new Error(`@hxql666/dsh-presentation config has unknown key(s) ${unknown.join(', ')} — known keys: ${[...known].join(', ')}`)
  }

  const resolved = {}
  for (const field of CONFIG_FIELDS) {
    const value = input[field.key]
    if (value === undefined) {
      if (field.required === true) {
        throw new Error(`@hxql666/dsh-presentation config needs a non-empty \`${field.key}\` (${field.description})`)
      }
      resolved[field.key] = field.default
      continue
    }
    if (field.type === 'string') {
      if (typeof value !== 'string') throw new Error(`@hxql666/dsh-presentation config \`${field.key}\` must be a string`)
      if (field.required === true && value.trim() === '') {
        throw new Error(`@hxql666/dsh-presentation config needs a non-empty \`${field.key}\` (${field.description})`)
      }
      resolved[field.key] = value
      continue
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new Error(`@hxql666/dsh-presentation config \`${field.key}\` must be a positive number`)
    }
    resolved[field.key] = value
  }
  return resolved
}
