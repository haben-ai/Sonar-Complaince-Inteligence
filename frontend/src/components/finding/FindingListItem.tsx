import type { FindingView } from '../../lib/present'
import type { RuleRef } from '../../lib/ruleRefs'
import RuleTag from './RuleTag'
import StatusLabel from './StatusLabel'

/** One row in the check-results list: title with its rule, room and deck, status, one-sentence description. */
export default function FindingListItem({ v, on, onClick, rule }: { v: FindingView; on: boolean; onClick: () => void; rule?: RuleRef }) {
  return <button data-fid={v.id} onClick={onClick} title={`${v.id} · ${v.desc.rule}`}
    className={`block w-full border-b border-l-2 border-b-navy-800 px-3 py-2 text-left ${on ? 'border-l-accent bg-navy-800' : 'border-l-transparent hover:bg-navy-850'}`}>
    <div className="line-clamp-2 leading-snug">
      <span className={`mr-1.5 align-middle text-[14px] font-medium ${on ? 'text-white' : 'text-ink'}`}>{v.desc.headline}</span>
      <span className="inline-block align-middle"><RuleTag r={rule} /></span>
    </div>
    <div className="mt-0.5 flex items-center gap-2 text-[12px]">
      <span className="min-w-0 truncate text-dim">{v.element}<span className="text-faint"> · {v.deckName}</span></span>
      <StatusLabel s={v.status} short className="ml-auto text-[12px]" />
    </div>
    <div className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-faint">{v.summary}</div>
  </button>
}
