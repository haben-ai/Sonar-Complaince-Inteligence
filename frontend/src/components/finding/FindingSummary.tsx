import { VIEW_STATUS, type FindingView } from '../../lib/present'
import { MODULE_TERMS } from '../../lib/terms'
import StatusLabel from './StatusLabel'
import RuleTag from './RuleTag'
import type { RuleRef } from '../../lib/ruleRefs'

/**
 * Compact inspector header: status and check, title, then room and deck with the actions.
 * The status explanation is a tooltip on the status; the finding ID stays visible for traceability.
 */
export default function FindingSummary({ v, actions, rule, onRule }: { v: FindingView; actions?: React.ReactNode; rule?: RuleRef; onRule?: () => void }) {
  const m = VIEW_STATUS[v.status]
  return <div>
    <div className="flex items-center gap-2 text-[12px]">
      <span className="rounded px-1.5 py-0.5 font-medium" style={{ background: m.hex + '1f' }} title={m.help}><StatusLabel s={v.status} /></span>
      <span className="truncate text-faint">{MODULE_TERMS[v.module]?.label}</span>
      <span className="ml-auto shrink-0 font-mono text-faint" title="Finding ID">{v.id}</span>
    </div>
    <h2 className="mt-1.5 text-[16px] font-semibold leading-snug text-white">{v.desc.headline}</h2>
    {rule && <div className="mt-1 flex items-center gap-1.5 text-[12px] text-faint"><span>{rule.kind === 'clause' ? 'Rule' : 'Based on'}</span><RuleTag r={rule} onOpen={onRule} /></div>}
    <div className="mt-1 flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{v.element}<span className="text-faint"> · {v.deckName}</span></span>
      {actions && <div className="flex shrink-0 gap-1">{actions}</div>}
    </div>
  </div>
}
