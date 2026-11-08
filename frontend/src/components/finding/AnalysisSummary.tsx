import type { EngineId, EngineSummary } from '../../types'
import { MODULES, VIEW_STATUS, type FindingView, type ViewStatus } from '../../lib/present'
import StatusLabel from './StatusLabel'
import RuleTag from './RuleTag'
import type { RuleRef } from '../../lib/ruleRefs'

type Open = (opts: { finding?: string; module?: EngineId | null; status?: ViewStatus | null }) => void

/**
 * Keeps five things apart: what was covered, possible issues, items needing more information,
 * conditions confirmed on available evidence, and what was not checked. Individual confirmed
 * conditions never add up to a statement of overall compliance.
 */
export default function AnalysisSummary({ views, summaries, rooms, coveredRooms, open, ruleRefs }: {
  views: FindingView[]; summaries: EngineSummary[]; rooms: number; coveredRooms: number; open: Open; ruleRefs?: Map<string, RuleRef>
}) {
  const n = (s: ViewStatus, m?: string) => views.filter((v) => v.status === s && (!m || v.module === m)).length
  const issues = views.filter((v) => v.status === 'issue')
  const tiles: { key: string; label: string; value: string | number; note: string; tone?: string; onClick?: () => void }[] = [
    { key: 'coverage', label: 'Analysis coverage', value: `${coveredRooms} / ${rooms}`, note: `rooms covered by at least one of ${summaries.length} checks` },
    { key: 'issue', label: VIEW_STATUS.issue.label + 's', value: n('issue'), note: 'need an engineer to review', tone: VIEW_STATUS.issue.hex, onClick: () => open({ status: 'issue', module: null }) },
    { key: 'inconclusive', label: VIEW_STATUS.inconclusive.label, value: n('inconclusive'), note: 'the drawing does not show enough to decide', tone: VIEW_STATUS.inconclusive.hex, onClick: () => open({ status: 'inconclusive', module: null }) },
    { key: 'verified', label: VIEW_STATUS.verified.label, value: n('verified'), note: 'individual conditions only, not overall compliance', tone: VIEW_STATUS.verified.hex, onClick: () => open({ status: 'verified', module: null }) },
    { key: 'not', label: VIEW_STATUS.not_assessed.label, value: rooms - coveredRooms, note: 'rooms outside the scope of the three checks (stores, tanks, sanitary…)' },
  ]
  return <div className="space-y-4">
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded border border-navy-700 bg-navy-700 md:grid-cols-5">
      {tiles.map((t) => {
        const body = <>
          <div className="text-[12px] text-dim">{t.label}</div>
          <div className="mt-0.5 font-mono text-[22px] leading-tight" style={{ color: t.tone ?? 'var(--color-ink)' }}>{t.value}</div>
          <div className="text-[12px] leading-snug text-faint">{t.note}</div>
        </>
        return t.onClick
          ? <button key={t.key} onClick={t.onClick} className="bg-navy-900 px-3 py-2.5 text-left hover:bg-navy-850">{body}</button>
          : <div key={t.key} className="bg-navy-900 px-3 py-2.5">{body}</div>
      })}
    </div>

    <table className="w-full text-[13px]">
      <thead><tr className="text-left text-[12px] text-faint">
        <th className="pb-1 font-normal">Check</th><th className="w-24 pb-1 text-right font-normal">Items checked</th>
        {(['issue', 'inconclusive', 'verified'] as const).map((s) => <th key={s} className="w-40 pb-1 text-right font-normal"><StatusLabel s={s} short className="justify-end" /></th>)}
      </tr></thead>
      <tbody>{MODULES.map((m) => {
        const sum = summaries.find((s) => s.engine === m.id)
        return <tr key={m.id} className="border-t border-navy-800">
          <td className="py-1.5"><button onClick={() => open({ module: m.id })} className="text-ink hover:text-accent">{m.label}</button></td>
          <td className="py-1.5 text-right font-mono text-dim">{sum?.elements_analyzed ?? '-'}</td>
          {(['issue', 'inconclusive', 'verified'] as const).map((s) => <td key={s} className="py-1.5 text-right">
            <button disabled={!n(s, m.id)} onClick={() => open({ module: m.id, status: s })} className="font-mono hover:underline disabled:no-underline"
              style={{ color: n(s, m.id) ? VIEW_STATUS[s].hex : 'var(--color-faint)' }}>{n(s, m.id)}</button></td>)}
        </tr>
      })}</tbody>
    </table>

    <div>
      <div className="mb-1.5 text-[13px] font-medium text-ink">Needs engineering attention <span className="font-mono text-faint">({issues.length})</span></div>
      {issues.length ? <div className="divide-y divide-navy-800 rounded border border-navy-700">
        {issues.map((v) => <button key={v.id} onClick={() => open({ finding: v.id })} className="grid w-full grid-cols-[minmax(0,260px)_auto_1fr_auto] items-center gap-3 px-3 py-1.5 text-left hover:bg-navy-850">
          <span className="truncate text-ink">{v.desc.headline}</span>
          <RuleTag r={ruleRefs?.get(v.id)} />
          <span className="min-w-0 truncate text-[13px] text-dim">{v.element}<span className="text-faint"> · {v.deckName}</span></span>
          <span className="text-[12px] text-accent">Review ›</span>
        </button>)}
      </div> : <p className="text-[13px] text-dim">No possible issues were found in the drawing. This is not a statement of overall compliance.</p>}
    </div>
  </div>
}
