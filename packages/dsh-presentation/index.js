/**
 * Presentation-document mode for DeepSeek Harness.
 *
 * A collaboration mode in the same shape as plan mode: while active, a
 * deployment-owned guidance section joins every model request, the human
 * `/deck` command enters and leaves, and the deck tools become usable. The mode
 * itself changes no tool catalog — the tools stay registered either way, so
 * entering and leaving never invalidates the request prefix.
 *
 * Underneath, decks are Typst documents built with Touying. The model never
 * writes Typst: it supplies structured page data, this plugin owns the layout,
 * and a compiled PDF can be rendered back to PNG so the model can look at its
 * own output before delivering it.
 *
 * This module deliberately imports no `@deepseek-ai/*` package. A plugin
 * installed into a profile from a workspace path is loaded from that path, and
 * the host's own module graph is not resolvable from there; see `lib/host.js`.
 *
 * @module @hxql/dsh-presentation
 */
import { CONFIG_FIELDS, createUserMessage, resolveConfig } from './lib/host.js'
import {
  MODE_COMMAND,
  narrationText,
  readModeState,
} from './lib/mode.js'
import { registerTools } from './lib/tools.js'

/** Loader row name. */
export const name = '@hxql/dsh-presentation'

/**
 * Services this plugin needs. `systemPrompt` carries the mode's guidance
 * section and `tools` the deck tools; `commands` is used through `ctx.inject`
 * so a deployment without a command registry still loads.
 */
export const inject = ['tools', 'systemPrompt']

/**
 * Configuration description. See `lib/host.js` for why this is a plain
 * description rather than a Schemastery `Config` schema.
 */
export const configFields = CONFIG_FIELDS

/**
 * Register the mode, its guidance section, the human command, and the tools.
 *
 * @param {object} ctx Cordis context.
 * @param {object} rawConfig The row's config, validated here.
 */
export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig)

  // Pending transitions, per session. A change requested during an open turn
  // waits for the next accepted in-turn pre-step, exactly as plan mode does, so
  // the guidance a request was assembled with matches that request.
  const pending = new WeakMap()

  const sessionOf = (agent) => agent?.session
  const loggedActive = (session) => readModeState(session).active

  const hasOpenTurn = (session) => {
    const projections = ctx.get('sessionProjections')
    if (projections === undefined) return false
    const state = projections.stateOf(session, 'turnBoundary')
    return state !== undefined && state.openTurnStartSeq !== null
  }

  const effectiveActive = (session) => {
    const wanted = pending.get(session)
    return wanted === undefined ? loggedActive(session) : wanted.active
  }

  // --- the guidance section: the only thing a transition changes ---------
  ctx.systemPrompt.section({
    name: 'presentation:policy',
    order: ctx.systemPrompt.getSectionOrder('PLAN_POLICY'),
    text: (context) => {
      const session = sessionOf(context?.agent)
      if (session === undefined) return ''
      return effectiveActive(session) ? config.section : ''
    },
  })

  // Narrate a committed user switch at the first accepted boundary. The
  // transition itself needs no append: `/deck` is already logged as the
  // command pair the mode state is folded from, so only the notice the model
  // has to see waits for the boundary.
  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next()
    const session = sessionOf(agent)
    if (session === undefined) return decision
    const wanted = pending.get(session)
    if (wanted === undefined || decision.kind === 'reject' || signal?.aborted === true) return decision
    pending.delete(session)
    if (wanted.narrate !== true) return decision
    const notice = narrationText(wanted.active, wanted.handout === true)
    return {
      ...decision,
      messages: [
        ...decision.messages,
        createUserMessage({
          content: [{ type: 'text', text: notice }],
          source: { kind: 'presentation-mode', form: 'notice', summary: notice },
        }),
      ],
    }
  })

  /**
   * Read the mode state for an agent, including a pending transition.
   *
   * @param {object} agent
   * @returns {{ active: boolean, handout: boolean, theme?: string, pending?: object }}
   */
  const getMode = (agent) => {
    const session = sessionOf(agent)
    if (session === undefined) return { active: false, handout: false }
    const state = readModeState(session)
    const wanted = pending.get(session)
    if (wanted === undefined) return { active: state.active, handout: state.handout, theme: state.theme }
    return {
      active: state.active,
      handout: state.handout,
      theme: state.theme,
      pending: { active: wanted.active, handout: wanted.handout, theme: wanted.theme },
    }
  }

  /**
   * Select the mode state.
   *
   * The command that calls this is already in the log — `command/run` lands
   * before its handler runs — but the fold only applies an invocation once its
   * `command/done` settles, so `readModeState` still reports what the user is
   * switching from. Nothing is appended here either way: the record the state
   * folds from is the command pair itself.
   *
   * A switch with no turn open injects the narration into the agent's inbox,
   * where it enters the next admitted step. During an open turn it stays pending
   * until the next accepted in-turn pre-step, because a notice cannot be added
   * to a request that was already assembled.
   *
   * @param {object} agent
   * @param {{ active: boolean, handout?: boolean, theme?: string }} next
   * @returns {'committed'|'queued'|'noop'}
   */
  const setMode = (agent, next) => {
    const session = sessionOf(agent)
    if (session === undefined) return 'noop'

    const logged = readModeState(session)
    const current = pending.get(session)
    const inForce = current ?? logged
    const target = {
      active: next.active === true,
      handout: next.handout ?? inForce.handout,
      theme: next.theme ?? inForce.theme,
    }

    if (inForce.active === target.active && inForce.handout === target.handout && inForce.theme === target.theme) {
      return 'noop'
    }

    if (hasOpenTurn(session)) {
      pending.set(session, { ...target, narrate: true })
      return 'queued'
    }

    pending.delete(session)
    const notice = narrationText(target.active, target.handout === true)
    try {
      agent.inject(createUserMessage({
        content: [{ type: 'text', text: notice }],
        source: { kind: 'presentation-mode', form: 'notice', summary: notice },
      }))
    } catch (error) {
      ctx.logger?.warn?.('@hxql/dsh-presentation: failed to record the mode switch: %o', error)
    }
    return 'committed'
  }

  // --- the human command -------------------------------------------------
  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      definitionId: '@hxql/dsh-presentation',
      name: MODE_COMMAND,
      description: 'Enter or leave presentation-document mode',
      input: { hint: '[off|handout|theme:<name>]', attachments: false },
      handler: ({ agent, rawInput }) => {
        const message = String(rawInput ?? '').trim()
        if (sessionOf(agent) === undefined) return { kind: 'error', text: 'No session to switch.' }
        const suffix = (outcome) => (outcome === 'committed' ? '' : ' Applies from the next step.')

        if (message === 'off') {
          return { kind: 'success', text: `Presentation-document mode off.${suffix(setMode(agent, { active: false }))}` }
        }

        if (message === 'handout' || message === 'handout off') {
          const handout = message === 'handout'
          const outcome = setMode(agent, { active: true, handout })
          const what = handout ? 'on (one frame per logical slide)' : 'off'
          return { kind: 'success', text: `Presentation-document mode on, handout ${what}.${suffix(outcome)}` }
        }

        const themeMatch = /^theme:(.+)$/.exec(message)
        if (themeMatch !== null) {
          const theme = themeMatch[1].trim()
          return { kind: 'success', text: `Presentation-document mode on, theme ${theme}.${suffix(setMode(agent, { active: true, theme }))}` }
        }

        if (message !== '') {
          return {
            kind: 'error',
            text: `Unknown /${MODE_COMMAND} argument ${JSON.stringify(message)}. Use /${MODE_COMMAND}, /${MODE_COMMAND} off, /${MODE_COMMAND} handout, or /${MODE_COMMAND} theme:<name>.`,
          }
        }

        const outcome = setMode(agent, { active: true })
        return {
          kind: 'success',
          text: outcome === 'committed'
            ? `Presentation-document mode on. Describe the deck you want; use /${MODE_COMMAND} off to leave.`
            : `Entering presentation-document mode (applies from the next step). Use /${MODE_COMMAND} off to leave.`,
        }
      },
    })
  })

  registerTools(ctx, config)
}
