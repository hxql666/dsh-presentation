declare module '*/types/dsh.js' {
  /**
   * The parts of the DeepSeek Harness host contract this plugin relies on.
   *
   * DSH ships no type declarations — the installed application contains zero
   * `.d.ts` files — so nothing here can be imported. These interfaces are written
   * by hand from the host's runtime shape: a plugin actually calls
   * `defineTool`/`ctx.tools.register` for tools that were copied into
   * `lib/host.js`, and reads `ctx.get`, `ctx.inject`, `ctx.on`, and `ctx.command`.
   *
   * They exist so that a mistake in *our* code is caught even though the host
   * cannot describe itself: a typo on a context member, or a call whose arguments
   * no longer match, fails `npm run typecheck` instead of failing at activation.
   *
   * A wrong assumption about the host cannot be caught here. That is what the
   * test suite is for, and why `lib/host.js` mirrors the host's own schema
   * compiler rather than approximating it.
   */

  /** One entry in the plugin's `configFields` description. */
  export interface ConfigField {
    key: string
    type: 'string' | 'number' | 'boolean'
    required?: boolean
    default?: string | number | boolean
    description: string
  }

  /** A tool definition in the author-facing DSL, before the host compiles it. */
  export interface ToolDefinition {
    name: string
    description: string
    parameters?: Record<string, unknown>
    output?: Record<string, unknown>
    execute(args: Record<string, unknown>, exec: ToolExecution): unknown | Promise<unknown>
  }

  /** What a tool receives alongside its arguments. */
  export interface ToolExecution {
    /** The session this call belongs to, when the host supplies one. */
    session?: unknown
    /** Abort signal for a cancelled call. */
    signal?: AbortSignal
    [key: string]: unknown
  }

  /** A prompt section the plugin contributes while the mode is active. */
  export interface PromptSection {
    /** Section identifier, e.g. `presentation:policy`. */
    name: string
    /** Position in the assembled prompt; see `getSectionOrder`. */
    order: number
    /**
     * Produces the section body for a request. Returning an empty string omits
     * the section, which is how a mode adds guidance only while it is active.
     */
    text: (context: { agent?: unknown } | undefined) => string
  }

  /** A command as the command registry records it. */
  export interface CommandDefinition {
    /** Stable id, so a re-registration replaces rather than duplicates. */
    definitionId: string
    name: string
    description?: string
    input?: { hint?: string; attachments?: boolean }
    handler: (invocation: { agent?: unknown; rawInput?: string }) => unknown
  }

  /**
   * The context Cordis hands to `apply`.
   *
   * Deliberately narrow: only what this plugin actually touches is declared, so
   * the declarations stay checkable against the code. The shapes below were read
   * from the plugin's own call sites and cross-checked against the bundled
   * harness, not copied from a published type — DSH ships none.
   */
  export interface DshContext {
    /** A required service, present because it is listed in `inject`. */
    tools: {
      register(definition: ToolDefinition): void
    }
    systemPrompt: {
      section(section: PromptSection): void
      /**
       * The order value for one of the harness's reserved sections, so this
       * plugin's guidance lands beside the harness's own rather than at an
       * arbitrary position.
       *
       * @param section A reserved section name, currently `PLAN_POLICY`.
       */
      getSectionOrder(section: string): number
    }
    /** A service that may or may not be present; `inject` guarantees some. */
    get(service: string): any
    /** Load services, running `callback` once they are available. */
    inject(services: string[], callback: (scope: DshContext) => void): void
    /**
     * The command registry. Reached through `ctx.inject(['commands'], …)`, so it
     * is optional here: a deployment without a command service still loads.
     */
    commands?: {
      register(definition: CommandDefinition): void
    }
    /** Subscribe to a host event. */
    on(event: string, handler: (...args: any[]) => unknown): void
    /** Run `callback` when the plugin unloads. */
    effect(callback: () => void): void
    /**
     * Scoped logger. Arguments after the message are format substitutions for a
     * printf-style logger, not a mistake.
     */
    logger?: {
      info(message: string, ...rest: unknown[]): void
      warn(message: string, ...rest: unknown[]): void
      error(message: string, ...rest: unknown[]): void
    }
  }

}
