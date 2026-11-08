import { useMemo } from 'react'
import type { EngineeringModel } from '../../types'
import type { FindingView } from '../../lib/present'
import { SECTION } from '../../lib/terms'
import type { Review } from '../../state/useReview'
import type { Workspace } from '../../state/useWorkspace'
import EvidenceSummary from './EvidenceSummary'
import FindingSummary from './FindingSummary'
import InspectorShell, { CubeIcon, IconButton, LocateIcon, MoreLine, Para, SheetIcon } from './InspectorShell'
import TechnicalDetails from './TechnicalDetails'

/**
 * Finding inspector. Summary tab: what we found, what to check next, the information still needed,
 * and "why it matters" one click away. Evidence and Details tabs hold the rest, unchanged.
 */
export default function EngineeringInspector({ v, rv, ws, model }: { v: FindingView; rv: Review; ws: Workspace; model: EngineeringModel }) {
  const d = rv.detail?.finding.id === v.id ? rv.detail : null
  const f = d?.finding ?? v.raw
  const spaces = useMemo(() => new Map(model.spaces.map((s) => [s.id, s])), [model.spaces])
  const primary = v.elementId ? spaces.get(v.elementId) : undefined
  const is3d = rv.viewMode === '3d'

  const rule = rv.ruleRefs.get(v.id)
  const header = <FindingSummary v={v} rule={rule} onRule={rule?.result ? () => rv.selectResult(rule.result!) : undefined} actions={<>
    <IconButton title="Show on drawing" onClick={rv.locate}><LocateIcon /></IconButton>
    <IconButton title={is3d ? 'Show on the original drawing' : 'Show in the 3D model'} onClick={() => rv.setViewMode(is3d ? '2d' : '3d')}>
      {is3d ? <SheetIcon /> : <CubeIcon />}</IconButton>
  </>} />

  const summary = <div className="px-4 py-3">
    <p className="text-[14px] leading-relaxed text-ink">{v.desc.found}</p>
    <Para label="Check next">{v.desc.check}</Para>
    {f.missing_information.length > 0 && <div className="mt-3">
      <div className="mb-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-faint">{SECTION.infoNeeded}</div>
      <div className="flex flex-wrap gap-1">{f.missing_information.map((m, i) =>
        <span key={i} className="rounded border border-incon/40 bg-incon/10 px-1.5 py-0.5 text-[12.5px] leading-snug text-ink">{m}</span>)}</div>
    </div>}
    <MoreLine label={SECTION.whyItMatters}>{v.desc.matters}</MoreLine>
  </div>

  const evidence = <div className="px-4 py-3">
    <EvidenceSummary facts={f.supporting_facts} evidence={d?.evidence ?? null} active={rv.evidence?.id ?? null} onEvidence={rv.showEvidence} limit={6} />
    {!d && rv.loadingDetail && <p className="mt-1 text-[12px] text-faint">Loading drawing locations…</p>}
  </div>

  const details = <TechnicalDetails v={v} d={d} rv={rv} ws={ws} model={model} primary={primary} spaces={spaces} embedded />

  return <InspectorShell key={v.id} header={header} tabs={[
    { id: 'summary', label: 'Summary', body: summary },
    { id: 'evidence', label: 'Evidence', count: f.supporting_facts.length, body: evidence },
    { id: 'details', label: 'Details', body: details },
  ]} />
}
