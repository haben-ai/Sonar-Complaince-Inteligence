/**
 * Engineer-friendly wording for findings.
 *
 * Built only from each finding's own data (rule identity = backend title, affected rooms, route,
 * supporting facts). No room-specific text. Where a rule is not recognised, or a value cannot be
 * read from the data, the original backend wording is used unchanged. The original observation,
 * risk text, action and every fact remain available in the technical details.
 */
import type { EngineeringModel, Finding } from '../types'
import { stripDeck } from './names'
import type { FindingView } from './present'

export interface Described {
  headline: string      // short finding title
  found: string         // what we found (one or two sentences; first sentence is the list summary)
  matters: string       // why it matters
  check: string         // what to check next
  rule: string          // backend rule title (technical details)
}

type Ctx = { f: Finding; v: FindingView; room: string; name: (id: string) => string; others: string[]; strip: (n: string) => string }

const list = (xs: string[], max = 3) => {
  const u = [...new Set(xs)].filter(Boolean)
  if (!u.length) return ''
  const shown = u.slice(0, max)
  const more = u.length - shown.length
  const body = shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}` : shown[0]
  return more > 0 ? `${body} (+${more} more)` : body
}
const num = (re: RegExp, s: string) => { const m = s.match(re); return m ? Number(m[1]) : null }
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`
const fact = (f: Finding, re: RegExp) => f.supporting_facts.map((s) => s.statement.match(re)).filter(Boolean) as RegExpMatchArray[]

/** Where the traced route ends: the escape point or the space holding it. */
function exitOf(c: Ctx): string | null {
  const p = c.f.highlight_path
  if (!p.length) return null
  const last = p[p.length - 1]
  const prev = p.length > 1 ? p[p.length - 2] : null
  const n = c.name(last)
  return n && !/^E_/.test(n) ? n : prev ? c.name(prev) : null
}

type Rule = (c: Ctx) => Omit<Described, 'rule'>

const RULES: Record<string, Rule> = {
  // ---------------- escape routes
  'Connected to an identified escape point': (c) => {
    const routes = num(/(\d+) node-independent route/, c.f.supporting_facts.map((s) => s.statement).join(' '))
    const exit = exitOf(c)
    return {
      headline: 'Route to an exit found',
      found: `${c.room} connects to ${exit ?? 'a marked exit'}${routes ? ` by ${plural(routes, 'separate route')}` : ''}.`,
      matters: 'This confirms the room is connected to a marked exit in the drawing. Route width, length and fire protection are not checked from a general arrangement.',
      check: 'Confirm the route against the approved escape-route plan.',
    }
  },
  'Potentially disconnected occupied space': (c) => {
    const doors = num(/has (\d+) detected door/, c.f.observation)
    return {
      headline: 'No route to an exit found',
      found: `${c.room} has ${doors != null ? plural(doors, 'door') : 'doors'}, but none of the rooms it opens into leads to a marked exit.`,
      matters: 'People in this room may have no recognised escape route. The drawing may also leave out a door or an exit.',
      check: 'Check the escape arrangement for this room and the rooms it opens into. Mark any door or exit the drawing leaves out.',
    }
  },
  'No door identified - connectivity cannot be established': (c) => ({
    headline: 'No door found',
    found: `No door symbol was found on the walls of ${c.room}, so its connection to the escape routes cannot be traced.`,
    matters: 'Sliding, watertight and hatch closures are often drawn without a door symbol and cannot be read automatically.',
    check: 'Confirm how this room is entered and mark the opening on the drawing.',
  }),
  'Route reaches a stair whose onward connection was not identified': (c) => ({
    headline: 'Stair connection unclear',
    found: `${c.room} connects to a stair, but where that stair leads on the next deck could not be traced.`,
    matters: 'The escape route cannot be followed beyond the stair, so it is not known whether it reaches an exit.',
    check: 'Confirm where the stair leads and mark the connection between decks.',
  }),
  'Corridor has a single escape direction (dead-end branch)': (c) => {
    const via = fact(c.f, /All routes pass through (.+)\.$/)[0]?.[1]
    return {
      headline: 'Dead-end corridor',
      found: `${c.room} has only one way out${via ? `: every route passes through ${c.strip(via)}` : ''}.`,
      matters: 'If that one exit is blocked, people in the corridor cannot get out another way. Safety requirements restrict dead-end corridors; the limit that applies is shown in the applicable requirements.',
      check: 'Check whether a second exit exists (for example a door drawn without a swing symbol) and measure the dead-end length.',
    }
  },
  'Corridor has two or more independent escape directions': (c) => {
    const routes = num(/(\d+) node-independent routes/, c.f.observation)
    return {
      headline: 'Corridor has two ways out',
      found: `${routes ? plural(routes, 'separate route') : 'Separate routes'} lead from ${c.room} to marked exits.`,
      matters: 'A corridor with separate exits does not depend on a single escape path. Widths and lengths are not checked from a general arrangement.',
      check: 'Confirm against the approved escape-route plan.',
    }
  },
  'Corridor without an identified escape connection': (c) => ({
    headline: 'Corridor has no route to an exit',
    found: `No route from ${c.room} to a marked exit could be traced in the drawing.`,
    matters: 'People using this corridor may have no recognised escape route, or the drawing leaves out the connection.',
    check: 'Check where this corridor leads and mark any missing stair or exit connection.',
  }),
  'No escape points identified in the design': (c) => ({
    headline: 'No exits marked in the design',
    found: `The design has no marked exits or open-deck access, so no escape route from ${c.room} can be traced.`,
    matters: 'Escape routes cannot be assessed without knowing where the exits are.',
    check: 'Provide the escape-route plan or mark the exits, then run the check again.',
  }),

  // ---------------- hazardous-space escape
  'Hazardous machinery space: only one independent escape route identified': (c) => {
    const exit = exitOf(c)
    const via = c.f.highlight_path.length > 1 ? c.name(c.f.highlight_path[1]) : null
    return {
      headline: 'Only one escape route from machinery space',
      found: `${c.room} has one route out${via ? `, through ${via}` : ''}${exit ? ` to ${exit}` : ''}. No second, separate route was found.`,
      matters: 'Machinery spaces with combustion engines normally need two separate means of escape. Whether this space is category A is not confirmed from the drawing.',
      check: 'Check for a second means of escape, such as an escape trunk, and where it leads.',
    }
  },
  'Hazardous space connected to an identified escape point': (c) => {
    const routes = num(/(\d+) independent route/, c.f.observation)
    const exit = exitOf(c)
    return {
      headline: 'Route to an exit found',
      found: `${c.room} connects to ${exit ?? 'a marked exit'}${routes ? ` by ${plural(routes, 'separate route')}` : ''}.`,
      matters: 'People working in this hazardous space have a traced route to an exit. Route quality and fire protection are not checked here.',
      check: 'Confirm the route against the approved escape-route plan.',
    }
  },
  'Hazardous space without identified escape connection': (c) => {
    const doors = num(/has (\d+) detected door/, c.f.observation)
    return {
      headline: 'No route to an exit from hazardous space',
      found: `${c.room} has ${doors != null ? plural(doors, 'door') : 'doors'}, but none leads to a marked exit.`,
      matters: 'People in a hazardous space need a reliable escape. The drawing may leave out a door or an exit.',
      check: 'Check how this space is evacuated and mark any missing door or exit.',
    }
  },
  'Hazardous-space escape accessibility requires review': (c) => {
    const stair = /stair/i.test(c.f.observation)
    return {
      headline: stair ? 'Stair connection unclear' : 'Access to hazardous space unclear',
      found: stair
        ? `${c.room} connects to a stair, but where that stair leads on the next deck could not be traced.`
        : `No door or escape marking was found for ${c.room}, so its escape access cannot be traced.`,
      matters: 'Escape access from this hazardous space cannot be established from the drawing.',
      check: stair ? 'Confirm where the stair leads and mark the connection between decks.' : 'Confirm how this space is entered and left, and mark the opening.',
    }
  },
  'Escape-point information missing': (c) => ({
    headline: 'No exits marked in the design',
    found: `The design has no marked exits, so escape access from ${c.room} cannot be assessed.`,
    matters: 'Escape access cannot be assessed without knowing where the exits are.',
    check: 'Provide the escape-route plan or mark the exits.',
  }),

  // ---------------- fire separation
  'Documented fire integrity below the SOLAS table class': (c) => {
    const rows = fact(c.f, /^Boundary to (.+?): documented '([^']+)', (Table [\d.]+) \((bulkhead|deck)\).*? requires '([^']+)'/)
    const first = rows[0]
    const what = (m: RegExpMatchArray) => (m[4] === 'deck' ? 'deck' : 'boundary')
    const found = !first ? c.f.observation
      : rows.length === 1
        ? `The fire-protection plan rates the ${what(first)} between ${c.room} and ${c.strip(first[1])} as ${first[2]}. The selected safety requirement for these two spaces is ${first[5]}.`
        : `${rows.length} boundaries of ${c.room} are rated lower than the selected safety requirement, for example the ${what(first)} with ${c.strip(first[1])} (${first[2]}, ${first[5]} required).`
    return {
      headline: 'Fire boundary rated below requirement',
      found,
      matters: 'A boundary with a lower fire rating can let fire or heat reach the neighbouring space sooner. The required rating depends on how both spaces are classified.',
      check: 'Check the listed boundaries against the approved fire-protection plan. Upgrade them, or confirm the space classification used.',
    }
  },
  'Documented fire integrity meets the SOLAS table class': (c) => {
    const n = fact(c.f, /^Boundary to .+?: documented '[^']+' meets/).length
    return {
      headline: 'Fire boundaries meet requirement',
      found: `All ${n ? plural(n, 'documented boundary', 'documented boundaries') : 'documented boundaries'} of ${c.room} are rated at or above the selected safety requirement.`,
      matters: 'The documented ratings meet the requirement for these spaces. Fire doors, penetrations and insulation details are not checked.',
      check: 'Confirm against the approved structural fire-protection plan.',
    }
  },
  'Fire-separation verification required': (c) => ({
    headline: 'Fire rating not documented',
    found: `${c.room} is a fire-risk space next to ${c.others.length ? `${plural(c.others.length, 'space')}, including ${list(c.others)}` : 'other spaces'}. The drawing does not state the fire rating of these boundaries.`,
    matters: 'Being next to a fire-risk space is not a problem in itself. The separating boundary must have the right fire rating, which this drawing does not show.',
    check: 'Check the fire-protection plan for the rating of each listed boundary.',
  }),
  'Fire-risk space: boundary information missing': (c) => ({
    headline: 'Boundaries of fire-risk space not found',
    found: `The neighbouring spaces of ${c.room} could not be identified from the drawing, so its boundaries cannot be checked.`,
    matters: 'Without knowing the neighbouring spaces, the fire separation around this space cannot be assessed.',
    check: 'Provide the compartment boundary drawings and the fire-protection plan for this space.',
  }),
}

export function describe(v: FindingView, model: EngineeringModel | null): Described {
  const f = v.raw
  const deckNames = model?.decks.map((d) => d.name) ?? []
  const spaces = new Map((model?.spaces ?? []).map((s) => [s.id, s]))
  const escapes = new Map((model?.escape_points ?? []).map((e) => [e.id, e]))
  const name = (id: string) => {
    const s = spaces.get(id)
    if (s) return s.name ?? s.kind.replace(/_/g, ' ')
    const e = escapes.get(id)
    if (e) return e.space_id && spaces.get(e.space_id)?.name ? spaces.get(e.space_id)!.name! : e.label ?? 'a marked exit'
    return id
  }
  const room = v.element || 'This space'
  const others = f.affected_names.slice(1).map((n) => stripDeck(n, deckNames))
  const rule = RULES[f.title]
  const base = rule ? rule({ f, v, room, name, others, strip: (n) => stripDeck(n, deckNames) }) : null
  return {
    headline: base?.headline ?? f.title,
    found: base?.found ?? f.observation,
    matters: base?.matters ?? f.risk_explanation,
    check: base?.check ?? f.recommended_action,
    rule: f.title,
  }
}

/** First sentence, for list rows. */
// a sentence ends at . ! ? followed by a capitalised word ("The", "No"); "AUX. GENERATOR" or "A-0" do not end one
export const firstSentence = (s: string) => (s.split(/(?<=[.!?])\s+(?=[A-Z][a-z])/)[0] ?? s).trim()
