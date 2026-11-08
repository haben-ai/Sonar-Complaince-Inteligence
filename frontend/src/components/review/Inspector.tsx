import type { EngineeringModel } from '../../types'
import { VIEW_STATUS } from '../../lib/present'
import type { Review } from '../../state/useReview'
import type { Workspace } from '../../state/useWorkspace'
import { api } from '../../services/api'
import { ComplianceDetail, ResultBadge } from '../RegulatoryPanel'
import { SpaceCard } from '../SpaceCard'
import EngineeringInspector from '../finding/EngineeringInspector'
import StatusLabel from '../finding/StatusLabel'
import RuleTag from '../finding/RuleTag'
import InspectorShell, { CubeIcon, IconButton, LocateIcon, SheetIcon } from '../finding/InspectorShell'

/** Right panel: why the selected finding exists, with every fact traced to its source. */
export default function Inspector({ rv, ws, onCollapse }: { rv: Review; ws: Workspace; onCollapse: () => void }) {
  const head = <div className="flex h-8 shrink-0 items-center border-b border-navy-700 px-3">
    <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-dim">Details</span>
    <button onClick={onCollapse} title="Collapse panel" className="ml-auto rounded px-1 text-faint hover:bg-navy-800 hover:text-ink">›</button>
  </div>
  let body
  if (rv.mode === 'result' && rv.result) body = <ResultInspector rv={rv} ws={ws} />
  else if (rv.mode === 'space' && rv.spaceId && ws.model) body = <SpaceInspector rv={rv} model={ws.model} id={rv.spaceId} />
  else if (rv.mode === 'finding' && rv.selected && ws.model) body = <EngineeringInspector rv={rv} ws={ws} v={rv.selected} model={ws.model} />
  else body = <div className="min-h-0 flex-1 overflow-y-auto p-4 text-[13px] leading-relaxed text-dim">
    <div className="mb-1 text-[14px] font-medium text-ink">Nothing selected</div>
    Select a result in the list, or click a room on the drawing, to see what was found, why it matters and what to check next.
    <div className="mt-3 space-y-1.5 text-[13px]">
      {(['issue', 'inconclusive', 'verified'] as const).map((s) => <div key={s}><StatusLabel s={s} className="font-medium" /><div className="pl-[13px] text-faint">{VIEW_STATUS[s].help}</div></div>)}
    </div>
  </div>
  return <div className="flex h-full min-h-0 flex-col">{head}<div className="flex min-h-0 flex-1 flex-col">{body}</div></div>
}

// ------------------------------------------------------------------ space
function SpaceInspector({ rv, model, id }: { rv: Review; model: EngineeringModel; id: string }) {
  const s = model.spaces.find((x) => x.id === id)
  const related = rv.views.filter((v) => v.raw.affected_ids.includes(id))
  const doors = model.doors.filter((d) => d.space_ids.includes(id))
  const back = rv.findingId ?? null
  const is3d = rv.viewMode === '3d'
  if (!s) return <div className="p-4 text-dim">Element {id} is not a mapped space.</div>
  const deck = model.decks.find((d) => d.id === s.deck_id)?.name ?? s.deck_id
  const area = s.labelled_area_m2 ?? s.computed_area_m2
  const facts = [s.kind.replace(/_/g, ' '), area != null ? `${Math.round(area)} m²` : null, `${doors.length} door${doors.length === 1 ? '' : 's'}`,
    s.hazard ? s.hazard.category.replace(/_/g, ' ') : null].filter(Boolean).join(' · ')

  const header = <div>
    <div className="flex items-center gap-2 text-[12px] text-faint">
      <span className="rounded bg-navy-800 px-1.5 py-0.5 text-dim">Room</span>
      {back && <button onClick={() => rv.selectFinding(back)} className="text-accent hover:underline">‹ Back to {back}</button>}
      <span className="ml-auto font-mono">{s.id}</span>
    </div>
    <h2 className="mt-1.5 text-[16px] font-semibold leading-snug text-white">{s.name ?? '(unlabelled space)'}</h2>
    <div className="mt-1 flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{deck}</span>
      <IconButton title="Show on drawing" onClick={rv.locate}><LocateIcon /></IconButton>
      <IconButton title={is3d ? 'Show on the original drawing' : 'Show in the 3D model'} onClick={() => rv.setViewMode(is3d ? '2d' : '3d')}>{is3d ? <SheetIcon /> : <CubeIcon />}</IconButton>
    </div>
  </div>

  const summary = <div className="px-4 py-3">
    <p className="text-[13.5px] text-dim first-letter:uppercase">{facts}</p>
    <div className="mb-1 mt-3 text-[12px] font-semibold uppercase tracking-[0.06em] text-faint">Check results for this room</div>
    {related.length ? <div className="divide-y divide-navy-800 rounded border border-navy-800">{related.map((v) =>
      <button key={v.id} onClick={() => rv.selectFinding(v.id, { keepSpace: true })} className="block w-full px-2 py-1.5 text-left hover:bg-navy-850">
        <div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{v.desc.headline}</span><RuleTag r={rv.ruleRefs.get(v.id)} /><StatusLabel s={v.status} short className="text-[12px]" /></div>
      </button>)}</div>
      : <p className="text-[13.5px] text-faint">No check covers this room. It is outside the scope of the three checks (not checked).</p>}
  </div>

  const details = <div className="px-4 py-3">
    <SpaceCard s={s} />
    <div className="mb-1 mt-3 text-[12px] font-semibold uppercase tracking-[0.06em] text-faint">Doors found ({doors.length})</div>
    {doors.length ? <ul className="space-y-0.5 text-[13px]">{doors.map((d) => <li key={d.id}><span className="font-mono text-dim">{d.id}</span> <span className="text-faint">· {d.resolution}{d.leaf_width_mm ? ` · leaf ≈${d.leaf_width_mm} mm (derived from symbol, not clear opening)` : ''}</span></li>)}</ul>
      : <p className="text-[13px] text-faint">No door symbol detected.</p>}
  </div>

  return <InspectorShell key={s.id} header={header} tabs={[
    { id: 'summary', label: 'Summary', body: summary },
    { id: 'details', label: 'Details', body: details },
  ]} />
}

// ------------------------------------------------------------------ regulatory result
function ResultInspector({ rv, ws }: { rv: Review; ws: Workspace }) {
  const r = rv.result!
  const spec = ws.reg?.specs.find((s) => s.spec_id === r.spec_id)
  const props = {
    r, spec, onClause: rv.setClauseId,
    onValidate: async () => {
      const who = prompt('Validate this rule encoding as a qualified engineer.\nThis records your name; the result becomes a final status.\n\nName / role:')
      if (who && who.trim()) { await api.regValidate(r.spec_id, who.trim()); ws.bumpReg() }
    },
  }
  const header = <div>
    <div className="flex items-center gap-2 text-[12px] text-faint">
      <ResultBadge s={r.status} small /><span className="truncate">Safety requirement · {r.instrument}</span>
      {r.demo_as_if_applicable && <span className="rounded bg-pink-500/15 px-1 text-[11.5px] text-pink-300">DEMO</span>}
    </div>
    <h2 className="mt-1.5 text-[16px] font-semibold leading-snug text-white">{r.title}</h2>
    <div className="mt-1 flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{r.element_names[0] ?? 'Design-level check'}</span>
      <IconButton title="Show on drawing" onClick={rv.locate} disabled={!r.element_ids.length}><LocateIcon /></IconButton>
    </div>
  </div>
  return <InspectorShell key={r.result_id} header={header} tabs={[
    { id: 'summary', label: 'Summary', body: <ComplianceDetail {...props} part="summary" /> },
    { id: 'evidence', label: 'Clauses', count: r.citations.length, body: <ComplianceDetail {...props} part="evidence" /> },
    { id: 'details', label: 'Details', body: <ComplianceDetail {...props} part="details" /> },
  ]} />
}
