/**
 * Scene presets: a named starting point per kind of talk.
 *
 * A scene bundles the choices that a presenter would otherwise have to make
 * blind — theme, frame ratio, font stack, a page sequence, and the wording of
 * the guidance the model receives. The value is consistency: "an academic
 * report" produces the same structure and visual register every time, instead
 * of whatever the model happened to pick, and a user gets a correct result from
 * one word.
 *
 * A scene is a *starting point*, not a straitjacket: every field it sets can be
 * overridden per deck, and the page sequence names layouts rather than fixed
 * pages, so the model still decides what each page says.
 *
 * @module @hxql/dsh-presentation/scenes
 */

/**
 * @typedef {object} Scene
 * @property {string} id
 * @property {string} label        Human-facing name.
 * @property {string} who          Who presents it, in one line.
 * @property {string} theme        Default Touying theme.
 * @property {string} aspectRatio
 * @property {string} fontStack
 * @property {string} locale       Language facts for line breaking and punctuation.
 * @property {string[]} sequence   Layout ids in the order a deck usually wants.
 * @property {string} register     How the slides should read.
 */

/** @type {Scene[]} */
export const SCENES = [
  {
    id: 'tech-talk',
    label: 'Technical talk',
    who: 'Engineers presenting a system, a change, or a postmortem to peers.',
    theme: 'metropolis',
    aspectRatio: '16-9',
    fontStack: 'sans',
    locale: 'zh',
    sequence: ['cover', 'agenda', 'section', 'bullets', 'cards', 'code', 'compare', 'kpis', 'timeline', 'takeaway'],
    register:
      'Dense and concrete. Lead with the problem and the measurement, not the history. One claim per page, with the evidence on the same page as the claim.',
  },
  {
    id: 'academic',
    label: 'Academic report',
    who: 'A researcher presenting method and results at a seminar or defense.',
    theme: 'university',
    aspectRatio: '4-3',
    fontStack: 'serif',
    locale: 'zh',
    sequence: ['cover', 'agenda', 'section', 'bullets', 'image-text', 'table', 'kpis', 'compare', 'quote'],
    register:
      'Precise and hedged. State the question, the method, then the result with its uncertainty. Attribute every borrowed idea on the page that uses it; keep equations and figures large enough to read from the back of the room.',
  },
  {
    id: 'teaching',
    label: 'Teaching / lecture',
    who: 'Instructors explaining a topic to learners who are new to it.',
    theme: 'simple',
    aspectRatio: '16-9',
    fontStack: 'sans',
    locale: 'zh',
    sequence: ['cover', 'agenda', 'section', 'bullets', 'steps', 'image-text', 'code', 'compare', 'takeaway'],
    register:
      'One idea per page and plenty of whitespace. Introduce a term before using it, prefer a worked example over a definition, and end each section with the one thing to remember.',
  },
  {
    id: 'product',
    label: 'Product / business',
    who: 'A team pitching a product, a plan, or a result to decision makers.',
    theme: 'dewdrop',
    aspectRatio: '16-9',
    fontStack: 'sans',
    locale: 'zh',
    sequence: ['cover', 'bullets', 'kpis', 'cards', 'compare', 'timeline', 'quote', 'takeaway'],
    register:
      'Outcome first. Say what the audience gets and what it costs before describing how it works. Numbers on their own page, small and comparable, never buried in a sentence.',
  },
  {
    id: 'review',
    label: 'Review / status',
    who: 'A team reporting progress, blockers, and next steps.',
    theme: 'aqua',
    aspectRatio: '16-9',
    fontStack: 'sans',
    locale: 'zh',
    sequence: ['cover', 'bullets', 'kpis', 'timeline', 'compare', 'table', 'takeaway'],
    register:
      'Factual and scannable. Separate what is done, what is blocked, and what is next, in that order. Every blocker names its owner and the decision it needs.',
  },
  {
    id: 'pitch',
    label: 'Stage / keynote',
    who: 'A speaker on a stage with a large screen and a dark room.',
    theme: 'stargazer',
    aspectRatio: '16-9',
    fontStack: 'sans',
    locale: 'zh',
    sequence: ['cover', 'quote', 'bullets', 'image-text', 'kpis', 'quote', 'takeaway'],
    register:
      'Few words, large type, high contrast. One sentence per page; put the detail in the speaker notes instead of on the screen, because the audience is listening rather than reading.',
  },
]

/** Look up a scene by id, case-insensitively. */
export function findScene(id) {
  if (typeof id !== 'string') return undefined
  const wanted = id.trim().toLowerCase()
  return SCENES.find((scene) => scene.id === wanted)
}

/**
 * Fold a scene into a deck spec, without overriding what the spec already says.
 *
 * @param {object} spec  Raw deck spec.
 * @param {string|undefined} sceneId
 * @returns {object} The spec with scene defaults applied.
 */
export function applyScene(spec, sceneId) {
  const scene = findScene(sceneId)
  if (scene === undefined) return spec
  return {
    ...spec,
    theme: spec.theme ?? scene.theme,
    aspectRatio: spec.aspectRatio ?? scene.aspectRatio,
    fontStack: spec.fontStack ?? scene.fontStack,
    locale: spec.locale ?? scene.locale,
  }
}
