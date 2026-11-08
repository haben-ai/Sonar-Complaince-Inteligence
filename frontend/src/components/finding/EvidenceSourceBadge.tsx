import { PROV_CLASS_META, provClass } from '../../lib/present'
import { SOURCE_TERMS } from '../../lib/terms'

/** Where one piece of evidence came from, in plain words (e.g. "Calculated from drawing"). */
export default function EvidenceSourceBadge({ p }: { p: string }) {
  const c = PROV_CLASS_META[provClass(p)]
  return <span title={c.help} className="inline-flex shrink-0 items-center whitespace-nowrap rounded-sm border px-1 text-[12px] leading-[15px]"
    style={{ color: c.hex, borderColor: c.hex + '55' }}>{SOURCE_TERMS[p] ?? p}</span>
}
