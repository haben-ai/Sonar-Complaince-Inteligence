import { useEffect, useState } from 'react'
import EvidenceWorkspace from '../components/review/EvidenceWorkspace'
import FindingsExplorer from '../components/review/FindingsExplorer'
import Inspector from '../components/review/Inspector'
import type { Review } from '../state/useReview'
import type { Workspace } from '../state/useWorkspace'

function useNarrow(px: number) {
  const [n, setN] = useState(() => window.innerWidth < px)
  useEffect(() => {
    const f = () => setN(window.innerWidth < px)
    window.addEventListener('resize', f)
    return () => window.removeEventListener('resize', f)
  }, [px])
  return n
}

/** Primary workspace: findings | evidence | inspector. On narrow screens the side panels float over the drawing. */
export default function ReviewPage({ rv, ws }: { rv: Review; ws: Workspace }) {
  const narrow = useNarrow(1180)
  const [left, setLeft] = useState(true)
  const [right, setRight] = useState(true)
  useEffect(() => { if (narrow) { setLeft(false); setRight(false) } else { setLeft(true); setRight(true) } }, [narrow])
  // on narrow screens, open the inspector when something gets selected
  useEffect(() => { if (narrow && rv.mode) { setRight(true); setLeft(false) } }, [narrow, rv.mode, rv.findingId, rv.spaceId])

  const float = narrow ? 'absolute top-0 bottom-0 z-20 shadow-2xl shadow-black/50' : 'relative'
  return (
    <div className="relative flex min-h-0 flex-1">
      {left ? <aside className={`${float} left-0 flex w-[clamp(270px,22vw,330px)] shrink-0 flex-col border-r border-navy-700 bg-navy-900`}>
        <FindingsExplorer rv={rv} onCollapse={() => setLeft(false)} />
      </aside> : <Rail side="left" label="Findings" count={rv.filtered.length} onOpen={() => setLeft(true)} />}

      <main className="min-w-0 flex-1"><EvidenceWorkspace rv={rv} ws={ws} /></main>

      {right ? <aside className={`${float} right-0 flex w-[clamp(330px,28vw,440px)] shrink-0 flex-col border-l border-navy-700 bg-navy-900`}>
        <Inspector rv={rv} ws={ws} onCollapse={() => setRight(false)} />
      </aside> : <Rail side="right" label="Inspector" onOpen={() => setRight(true)} />}
    </div>
  )
}

function Rail({ side, label, count, onOpen }: { side: 'left' | 'right'; label: string; count?: number; onOpen: () => void }) {
  return <button onClick={onOpen} title={`Show ${label.toLowerCase()}`}
    className={`flex w-7 shrink-0 flex-col items-center gap-2 bg-navy-900 py-2 text-dim hover:bg-navy-850 hover:text-ink ${side === 'left' ? 'border-r' : 'border-l'} border-navy-700`}>
    <span className="text-[11px]">{side === 'left' ? '›' : '‹'}</span>
    <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] [writing-mode:vertical-rl]">{label}</span>
    {count !== undefined && <span className="font-mono text-[10px] text-faint">{count}</span>}
  </button>
}
