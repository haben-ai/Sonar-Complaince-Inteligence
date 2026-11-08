import type { RuleRef } from '../../lib/ruleRefs'

/**
 * Short tag naming the rule behind a result: a regulation clause (accent outline) when an encoded check tested
 * this room, or a screening rule (muted, labelled "Screening") when no clause was tested. Hover explains which.
 */
export default function RuleTag({ r, onOpen }: { r?: RuleRef; onOpen?: () => void }) {
  if (!r) return null
  const cls = r.kind === 'clause'
    ? 'border-accent/50 text-accent'
    : 'border-navy-600 text-faint'
  const body = <>{r.kind === 'screening' && <span className="mr-1 font-sans">Screening</span>}{r.code}{r.more > 0 && <span className="ml-1 text-faint">+{r.more}</span>}</>
  const base = `inline-flex shrink-0 items-center whitespace-nowrap rounded border px-1.5 py-px font-mono text-[12px] leading-[17px] ${cls}`
  return onOpen
    ? <button type="button" title={`${r.title} Click to open the check.`} onClick={(e) => { e.stopPropagation(); onOpen() }} className={`${base} hover:bg-accent/10`}>{body}</button>
    : <span title={r.title} className={base}>{body}</span>
}
