import { useEffect, useRef, useState } from 'react'
import { ClauseModal } from './components/RegulatoryPanel'
import TopBar, { type Page } from './components/shell/TopBar'
import ExplorerPage, { type ExplorerTab } from './pages/ExplorerPage'
import OverviewPage from './pages/OverviewPage'
import ReportPage from './pages/ReportPage'
import ReviewPage from './pages/ReviewPage'
import { useReview } from './state/useReview'
import { useWorkspace } from './state/useWorkspace'
import type { EngineId } from './types'
import type { ViewStatus } from './lib/present'
import { Empty } from './components/ui'

export default function App() {
  const [page, setPage] = useState<Page>('review')
  const [explorerTab, setExplorerTab] = useState<ExplorerTab>('spaces')
  const [viewMode3d, setViewMode3d] = useState(false)
  const ws = useWorkspace(viewMode3d || (page === 'explorer' && explorerTab === '3d'))
  const rv = useReview(ws)
  useEffect(() => setViewMode3d(page === 'review' && rv.viewMode === '3d'), [page, rv.viewMode])

  // after an upload, land on Engineering Review once analysis is ready; show progress on Overview meanwhile
  const awaiting = useRef<string | null>(null)
  const prevBusy = useRef<string | null>(null)
  useEffect(() => {
    if (prevBusy.current && !ws.busy && ws.designId && ws.current?.status !== 'ready') { awaiting.current = ws.designId; setPage('overview') }
    prevBusy.current = ws.busy
  }, [ws.busy, ws.designId, ws.current?.status])
  useEffect(() => {
    if (awaiting.current && awaiting.current === ws.designId && ws.ready && ws.model) { awaiting.current = null; setPage('review') }
  }, [ws.ready, ws.model, ws.designId])

  const openInReview = ({ finding, module, status }: { finding?: string; module?: EngineId | null; status?: ViewStatus | null }) => {
    if (module !== undefined) rv.setModule(module)
    if (status !== undefined) rv.setStatuses(new Set(status ? [status] : []))
    if (finding) {
      // make sure the opened finding is visible in the list
      const v = rv.views.find((x) => x.id === finding)
      if (v && !rv.filtered.some((x) => x.id === finding)) { rv.setModule(v.module); rv.setStatuses(new Set()); rv.setSearch('') }
      rv.setViewMode('2d'); rv.selectFinding(finding)
    }
    setPage('review')
  }

  const notReady = !ws.ready || !ws.model
  return (
    <div className="flex h-full flex-col">
      <TopBar page={page} setPage={setPage} ws={ws} />
      {ws.err && <div className="no-print flex items-center gap-2 border-b border-issue/40 bg-issue/10 px-3 py-1 text-[11.5px] text-red-200">
        <span className="min-w-0 flex-1 truncate">{ws.err}</span><button onClick={() => ws.setErr(null)} className="text-red-200/70 hover:text-white">×</button></div>}
      {ws.scenario && page !== 'overview' && <div className="no-print border-b border-pink-400/30 bg-pink-950/30 px-3 py-0.5 text-[11px] text-pink-200">
        Synthetic scenario active - findings touching modified elements are labelled synthetic.</div>}

      {page === 'overview' && <OverviewPage ws={ws} rv={rv} open={openInReview} />}
      {page === 'review' && (notReady ? <ReviewPlaceholder ws={ws} goOverview={() => setPage('overview')} /> : <ReviewPage rv={rv} ws={ws} />)}
      {page === 'explorer' && <ExplorerPage ws={ws} rv={rv} tab={explorerTab} setTab={setExplorerTab} toReview={() => setPage('review')} />}
      {page === 'report' && <ReportPage ws={ws} rv={rv} />}

      {rv.clauseId && <ClauseModal id={rv.clauseId} onClose={() => rv.setClauseId(null)} />}
    </div>
  )
}

function ReviewPlaceholder({ ws, goOverview }: { ws: ReturnType<typeof useWorkspace>; goOverview: () => void }) {
  const c = ws.current
  if (ws.analysisError) return <Empty title="Analysis could not be loaded">{ws.analysisError}</Empty>
  if (!c) return <Empty title={ws.err ? 'Backend not reachable' : 'No design loaded'}>{ws.err ? 'Start the backend and reload.' : 'Upload a General Arrangement drawing (PDF, image or JSON) to begin.'}</Empty>
  if (c.status === 'error') return <Empty title="Extraction failed">{c.error}</Empty>
  if (c.status !== 'ready') return <Empty title={`Extracting ${c.name}…`}>
    <span className="font-mono text-[11px]">{c.progress[c.progress.length - 1] ?? ''}</span><br />
    <button onClick={goOverview} className="mt-1 text-accent hover:underline">Show extraction log</button>
  </Empty>
  return <Empty title="Loading analysis…" />
}
