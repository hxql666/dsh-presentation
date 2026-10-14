/**
 * Presentation mode: per-session collaboration state.
 *
 * Mirrors the shape DSH uses for plan mode — a logged selection; a prompt
 * section that is the only thing a mode transition changes; a human command to
 * enter and leave; and tools that stay registered whether or not the mode is
 * active so the request tool catalog never shifts.
 *
 * Unlike plan mode, which ships inside the harness, this plugin may not record
 * an event type of its own: a reader accepts an unknown stored event only when
 * its envelope carries `ignorable: true`, and live `Session.append()` cannot set
 * that marker, so a `presentation/mode` row would make the Session refuse to
 * reopen. The state is therefore derived from the `/deck` records the command
 * registry already writes — `command/run` carries the command name and its raw
 * input, and the paired `command/done` says whether the handler accepted it.
 * Resume and fork come for free: the records are in the log, so a forked
 * session inherits the mode it forked from.
 *
 * Deriving from the pair rather than from `command/run` alone is what keeps a
 * refused invocation and a re-selection of the current mode from looking like
 * transitions: the state a handler reads is the state before its own record
 * settled.
 *
 * The fold is incremental. `snapshotEvents(fromSeq)` reads only the tail past
 * the last folded event, so a read costs the events appended since the previous
 * read rather than the whole log. A session whose events carry no `seq` (a
 * harness-free test double, for example) falls back to folding from the start
 * on every read.
 *
 * @module @hxql/dsh-presentation/mode
 */

/** The logged command records the mode state is derived from. */
export const COMMAND_RUN_EVENT = 'command/run'
export const COMMAND_DONE_EVENT = 'command/done'

/** The human command that enters and leaves the mode. */
export const MODE_COMMAND = 'deck'

/** Where the compiled deck and its spec live, relative to the session cwd. */
export const DECK_DIR = 'deck'

/** The state before the session has selected anything. */
const INITIAL_STATE = Object.freeze({ active: false, handout: false, theme: undefined, running: null })

/** Folded-state cache: one scanned prefix per session. */
const folded = new WeakMap()

/**
 * Apply one accepted `/deck` invocation to the mode state.
 *
 * The argument vocabulary is the command handler's, and an argument the handler
 * refuses leaves the state untouched.
 *
 * @param {object} state State before the invocation.
 * @param {unknown} rawInput The invocation's raw input, as logged.
 * @returns {object} The state after it, or the same state when it does not apply.
 */
function applyInvocation(state, rawInput) {
  const message = String(rawInput ?? '').trim()
  if (message === 'off') return Object.freeze({ ...state, active: false })
  if (message === 'handout') return Object.freeze({ ...state, active: true, handout: true })
  if (message === 'handout off') return Object.freeze({ ...state, active: true, handout: false })
  const theme = /^theme:(.+)$/.exec(message)
  if (theme !== null) return Object.freeze({ ...state, active: true, theme: theme[1].trim() })
  if (message === '') return Object.freeze({ ...state, active: true })
  return state
}

/** Fold one logged event into the mode state. */
function foldEvent(state, event) {
  if (event?.type === COMMAND_RUN_EVENT) {
    if (event.data?.name !== MODE_COMMAND) return state
    return { ...state, running: { commandId: event.data.commandId, args: event.data.args } }
  }
  if (event?.type === COMMAND_DONE_EVENT) {
    const running = state.running
    if (running === null || event.data?.commandId !== running.commandId) return state
    const settled = { ...state, running: null }
    return event.data.kind === 'success' ? applyInvocation(settled, running.args) : Object.freeze(settled)
  }
  return state
}

/** The seq every read resumes from, or -1 while the events carry none. */
function resumeSeq(events) {
  const last = events.at(-1)
  return typeof last?.seq === 'number' ? last.seq : -1
}

/** Fold a session's whole log, for a cold read or an unseqenced event list. */
function foldAll(session) {
  let state = INITIAL_STATE
  for (const event of session.snapshotEvents()) state = foldEvent(state, event)
  return state
}

/** Read the folded state, including the in-flight command, for one session. */
function readFolded(session) {
  if (session === undefined || typeof session.snapshotEvents !== 'function') return INITIAL_STATE
  const cached = folded.get(session)

  if (cached === undefined) {
    const state = foldAll(session)
    folded.set(session, { state, seq: resumeSeq(session.snapshotEvents()) })
    return state
  }

  const events = session.snapshotEvents(cached.seq + 1)
  let state = cached.state
  let seq = cached.seq
  for (const event of events) {
    if (typeof event?.seq !== 'number') {
      // No usable seq: the slice cannot be trusted to be the tail alone, so
      // rebuild from the start instead of folding events twice.
      state = foldAll(session)
      seq = -1
      break
    }
    state = foldEvent(state, event)
    seq = event.seq
  }
  folded.set(session, { state, seq })
  return state
}

/**
 * Read the logged presentation-mode state of a session.
 *
 * @param {object} session A `Session` (`snapshotEvents`).
 * @returns {{ active: boolean, handout: boolean, theme: string|undefined }}
 */
export function readModeState(session) {
  const state = readFolded(session)
  return { active: state.active === true, handout: state.handout === true, theme: state.theme }
}

/** Whether presentation mode is currently active for a session. */
export function isActive(session) {
  return readFolded(session).active === true
}

/** Compose the deployment-owned guidance section for the model. */
export function guidanceSection(config) {
  return config.section
}

/**
 * The narration a user-switch injects, so the model learns about the transition
 * without the user having to restate it. Built lazily: this module does not
 * import the LLM package, so the caller supplies the message constructor.
 */
export function narrationText(active, handout) {
  if (!active) return 'The user switched this session out of presentation-document mode.'
  return handout
    ? 'The user switched this session to presentation-document mode in handout form (one frame per logical slide).'
    : 'The user switched this session to presentation-document mode.'
}
