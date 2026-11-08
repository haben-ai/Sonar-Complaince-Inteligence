import { VIEW_STATUS, type ViewStatus } from '../../lib/present'

/** Review status in plain words, with its colour dot. Hover gives the full meaning. */
export default function StatusLabel({ s, short, className = '' }: { s: ViewStatus; short?: boolean; className?: string }) {
  const m = VIEW_STATUS[s]
  return <span title={m.help} className={`inline-flex items-center gap-1.5 whitespace-nowrap ${className}`} style={{ color: m.hex }}>
    <span className="status-dot inline-block h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: m.hex }} />{short ? m.short : m.label}
  </span>
}
