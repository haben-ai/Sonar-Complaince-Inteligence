import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import DataReport from '../components/DataReport'
import DrawingViewer, { type FocusRequest } from '../components/DrawingViewer'
import EvidencePanel, { SpaceCard } from '../components/EvidencePanel'
import FindingsPanel from '../components/FindingsPanel'
import GraphView from '../components/GraphView'
import SafetyOverview from '../components/SafetyOverview'
import { OriginBadge } from '../components/ui'
import RegulatoryPanel, { ClauseModal, ComplianceDetail } from '../components/RegulatoryPanel'
import ZoneTree from '../viewer3d/ZoneTree'
import type { Scene3D } from '../viewer3d/types'
import { api } from '../services/api'
import type { ClauseHit, ComplianceResult, RegulatoryEvaluation, Status,
  AnalysisSummary, BBox, DesignSummary, EngineeringModel, Finding, FindingDetail, GraphData, Scenario, SystemStatus } from '../types'

const ShipViewport = lazy(() => import('../viewer3d/ShipViewport'))   // three.js loaded only when the 3D tab opens

type Tab = 'drawing' | '3d' | 'graph' | 'compliance' | 'report'

export default function Dashboard() {
  const [status, setStatus] = useState<SystemStatus | null>(null)
  const [designs, setDesigns] = useState<DesignSummary[]>([])
  const [designId, setDesignId] = useState<string | null>(null)
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [scenario, setScenario] = useState<string | null>(null)
  const [summary, setSummary] = useState<AnalysisSummary | null>(null)
  const [model, setModel] = useState<EngineeringModel | null>(null)
  const [graph, setGraph] = useState<GraphData | null>(null)
  const [findings, setFindings] = useState<Finding[]>([])
  const [engine, setEngine] = useState<string | null>(null)
  const [selected, setSelected] = useState<Finding | null>(null)
  const [detail, setDetail] = useState<FindingDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [focus, setFocus] = useState<FocusRequest | null>(null)
  const [evBox, setEvBox] = useState<{ box: BBox; id: string } | null>(null)
  const [selSpace, setSelSpace] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('drawing')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [reg, setReg] = useState<RegulatoryEvaluation | null>(null)
  const [demo, setDemo] = useState(false)
  const [selResult, setSelResult] = useState<ComplianceResult | null>(null)
  const [related, setRelated] = useState<{ results: ComplianceResult[]; clauses: ClauseHit[] } | null>(null)
  const [clauseId, setClauseId] = useState<string | null>(null)
  const [regTick, setRegTick] = useState(0)
  const [page, setPage] = useState(0)
  const [scene, setScene] = useState<Scene3D | null>(null)
  const [hiddenDecks, setHiddenDecks] = useState<Set<string>>(new Set())
  const [onlyFlagged, setOnlyFlagged] = useState(false)
  const [focus3d, setFocus3d] = useState<string | null>(null)
  const [urlOpen, setUrlOpen] = useState(false)
  const [url, setUrl] = useState('')
  const current = designs.find((d) => d.design_id === designId) ?? null

  const refreshDesigns = useCallback(async () => {
    const ds = await api.designs()
    setDesigns(ds)
    return ds
  }, [])

  useEffect(() => {
    api.status().then(setStatus).catch((e) => setErr(String(e)))
    api.scenarios().then(setScenarios).catch(() => {})
    refreshDesigns().then((ds) => {
      const pick = ds.find((d) => d.design_id === 'dana_v') ?? ds[0]
      if (pick) setDesignId(pick.design_id)
    }).catch((e) => setErr(`Backend not reachable: ${e}`))
  }, [refreshDesigns])

  // poll while extracting
  useEffect(() => {
    if (!current || current.status === 'ready' || current.status === 'error') return
    const t = setInterval(refreshDesigns, 900)
    return () => clearInterval(t)
  }, [current, refreshDesigns])

  // load analysis when ready
  useEffect(() => {
    if (!designId || current?.status !== 'ready') return
    setErr(null)
    setSelected(null); setDetail(null); setEvBox(null); setSelSpace(null)
    Promise.all([api.summary(designId, scenario), api.elements(designId, scenario), api.findings(designId, scenario), api.graph(designId, scenario)])
      .then(([s, m, f, g]) => { setSummary(s); setModel(m); setFindings(f); setGraph(g) })
      .catch((e) => setErr(String(e)))
  }, [designId, scenario, current?.status])

  useEffect(() => {
    if (!designId || current?.status !== 'ready') return
    setSelResult(null)
    api.regEvaluate(designId, scenario, demo).then(setReg).catch((e) => { setReg(null); setErr(`Regulatory layer: ${e}`) })
  }, [designId, scenario, demo, current?.status, regTick])

  useEffect(() => {
    if (tab !== '3d' || !designId || current?.status !== 'ready') return
    fetch(`/api/design/scene3d?design_id=${designId}${scenario ? `&scenario=${scenario}` : ''}${demo ? '&demo=true' : ''}`)
      .then((r) => r.json()).then(setScene).catch((e) => setErr(String(e)))
  }, [tab, designId, scenario, demo, current?.status, regTick])

  // findings / results chosen elsewhere -> camera focus in 3D
  useEffect(() => { if (tab === '3d' && selected?.affected_ids[0]) setFocus3d(selected.affected_ids[0]) }, [selected, tab])

  const select3d = (id: string) => {
    setSelSpace(id); setFocus3d(id)
    const sp = scene?.spaces.find((s) => s.id === id)
    if (!sp || !sp.refs.length) { setSelected(null); setSelResult(null); setDetail(null); return }
    const rank = { red: 3, amber: 2, green: 1, none: 0 } as const
    const ref = [...sp.refs].sort((a, b) => rank[b.band] - rank[a.band] || (a.kind === 'finding' ? -1 : 1))[0]
    if (ref.kind === 'finding') {
      const f = findings.find((x) => x.id === ref.id)
      if (f) selectFinding(f, true)
    } else {
      const r = reg?.results.find((x) => x.result_id === ref.id)
      if (r) selectResult(r, true)
    }
  }

  const STATUS_FOR: Record<string, Status> = { POTENTIAL_NON_COMPLIANCE: 'POTENTIAL_CONNECTIVITY_ISSUE', COMPLIANT_ON_AVAILABLE_EVIDENCE: 'CONNECTIVITY_VERIFIED' }
  const selectResult = (r: ComplianceResult, stay = false) => {
    setSelResult(r); setDetail(null); setEvBox(null); setSelSpace(null); setRelated(null)
    const boxes0 = (model?.spaces ?? []).filter((s) => (r.element_ids.slice(0, 12).includes(s.id) || r.highlight_path.includes(s.id)) && s.bbox).map((s) => s.bbox!)
    const first = model?.spaces.find((s) => s.id === r.element_ids[0])?.bbox
    const boxes = boxes0.filter((b) => (b.page ?? 0) === (first?.page ?? boxes0[0]?.page ?? 0))
    const loc = boxes.length ? boxes.reduce((a, b) => ({ page: a.page, x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) })) : null
    setSelected(r.element_ids.length ? {
      id: r.result_id, engine: 'escape_route_connectivity', status: STATUS_FOR[r.status] ?? 'INCONCLUSIVE', title: r.title,
      affected_ids: r.element_ids.slice(0, 1), affected_names: r.element_names, deck_id: r.deck_id, location: loc, observation: '',
      risk_explanation: '', supporting_facts: [], missing_information: [], recommended_action: '', requirement_refs: [],
      highlight_path: r.highlight_path, highlight_ids: r.element_ids.slice(0, 40), data_origin: r.data_origin, explanation_source: '', llm_explanation: null,
    } : null)
    if (loc && !stay && tab !== '3d') { setTab('drawing'); setFocus({ bbox: loc, pad: 0.3, key: Date.now() }) }
  }

  const selectFinding = async (f: Finding, from3d = false) => {
    setSelected(f); setEvBox(null); if (!from3d) setSelSpace(null); setSelResult(null); setRelated(null)
    if (designId) api.regRelated(designId, f.id, scenario).then(setRelated).catch(() => setRelated(null))
    // frame the affected space plus the route / related spaces drawn for this finding
    const ids = [...f.affected_ids, ...f.highlight_path, ...f.highlight_ids]
    const boxes = (model?.spaces ?? []).filter((s) => ids.includes(s.id) && s.bbox).map((s) => s.bbox!)
    if (f.location) boxes.unshift(f.location)
    const pg0 = boxes[0]?.page ?? 0
    boxes.splice(0, boxes.length, ...boxes.filter((b) => (b.page ?? 0) === pg0))   // one sheet at a time
    if (boxes.length) {
      // all decks are on one sheet, so a cross-deck route is still one rectangle
      const bb = boxes.reduce((a, b) => ({ page: a.page, x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }))
      setFocus({ bbox: bb, pad: 0.25, key: Date.now() })
    }
    if (!designId) return
    setLoadingDetail(true)
    try { setDetail(await api.finding(f.id, designId, scenario)) } catch (e) { setErr(String(e)) } finally { setLoadingDetail(false) }
  }

  const upload = async (file: File) => {
    setBusy(true); setErr(null)
    try { const d = await api.upload(file); await refreshDesigns(); setScenario(null); setDesignId(d.design_id); setModel(null); setSummary(null) }
    catch (e) { setErr(String(e)) } finally { setBusy(false) }
  }
  const importUrl = async () => {
    if (!url.trim()) return
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/upload/url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url.trim() }) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.detail ?? r.statusText)
      await refreshDesigns(); setScenario(null); setPage(0); setDesignId(d.design_id); setModel(null); setSummary(null); setUrlOpen(false); setUrl('')
    } catch (e) { setErr(String(e)) } finally { setBusy(false) }
  }
  const fetchDana = async () => {
    setBusy(true); setErr(null)
    try { const d = await api.fetchDanaV(); await refreshDesigns(); setDesignId(d.design_id) } catch (e) { setErr(String(e)) } finally { setBusy(false) }
  }

  const ready = current?.status === 'ready' && model && summary
  const selectedSpaceObj = selSpace && model ? model.spaces.find((s) => s.id === selSpace) : null

  return (
    <div className="flex h-full flex-col">
      {/* header */}
      <header className="flex items-center gap-4 border-b border-navy-700 bg-navy-900 px-4 py-2">
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 32 32" className="h-7 w-7"><path d="M4 20h24l-4 6H8z" fill="#1e40af" /><path d="M9 20V12h9v8M18 14h5v6" fill="none" stroke="#7dd3fc" strokeWidth="1.6" /><path d="M13 12V6" stroke="#7dd3fc" strokeWidth="1.6" /></svg>
          <div>
            <div className="text-[13px] font-semibold tracking-wide text-white">MARITIME SAFETY INTELLIGENCE</div>
            <div className="text-[10px] text-slate-400">GA drawing screening · escape routes · hazardous spaces · fire proximity</div>
          </div>
        </div>
        <select value={designId ?? ''} onChange={(e) => { setScenario(null); setPage(0); setDesignId(e.target.value); setModel(null); setSummary(null) }}
          className="ml-4 max-w-72 rounded bg-navy-800 px-2 py-1 text-[12px] text-slate-100 ring-1 ring-navy-600 outline-none">
          {designs.map((d) => <option key={d.design_id} value={d.design_id}>{d.name}{d.status !== 'ready' ? ` (${d.status})` : ''}</option>)}
        </select>
        {current?.source_type === 'pdf' && current.design_id === 'dana_v' && (
          <select value={scenario ?? ''} onChange={(e) => setScenario(e.target.value || null)}
            className={`max-w-80 rounded px-2 py-1 text-[12px] ring-1 outline-none ${scenario ? 'bg-pink-900/40 text-pink-200 ring-pink-500/50' : 'bg-navy-800 text-slate-300 ring-navy-600'}`}>
            <option value="">Design as extracted (no modification)</option>
            {scenarios.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span className={`rounded px-2 py-0.5 text-[10px] ring-1 ${status?.llm_enabled ? 'text-cyan-300 ring-cyan-500/40' : 'text-slate-400 ring-navy-600'}`} title={status?.mode}>
            {status?.llm_enabled ? `Gemini: ${status.model}` : 'LLM off · deterministic mode'}
          </span>
          {!status?.default_pdf_present && <button onClick={fetchDana} disabled={busy} className="rounded bg-navy-700 px-2 py-1 text-[11px] text-slate-200 hover:bg-navy-600">Fetch DANA V GA</button>}
          {urlOpen ? <form onSubmit={(e) => { e.preventDefault(); importUrl() }} className="flex gap-1">
            <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… PDF / image / Box share link"
              className="w-80 rounded bg-navy-800 px-2 py-1 text-[12px] ring-1 ring-navy-600 outline-none focus:ring-sky-500" />
            <button disabled={busy} className="rounded bg-sky-700 px-2 text-[11px]">{busy ? 'Importing…' : 'Import'}</button>
            <button type="button" onClick={() => setUrlOpen(false)} className="px-1 text-slate-400">×</button>
          </form> : <button onClick={() => setUrlOpen(true)} className="rounded bg-navy-700 px-2 py-1 text-[11px] text-slate-200 hover:bg-navy-600">Import from URL</button>}
          <button onClick={() => fileRef.current?.click()} disabled={busy} className="rounded bg-sky-600 px-3 py-1 text-[12px] font-medium text-white hover:bg-sky-500 disabled:opacity-50">{busy ? 'Uploading…' : 'Upload design'}</button>
          <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }} />
        </div>
      </header>

      {err && <div className="bg-issue/15 px-4 py-1 text-[12px] text-red-200">{err}</div>}
      {scenario && summary?.scenario_info && <div className="border-b border-pink-500/30 bg-pink-900/25 px-4 py-1.5 text-[12px] text-pink-100"><b>SYNTHETIC SCENARIO</b> — {summary.scenario_info.description} Findings touching modified elements are labelled SYNTHETIC.</div>}

      <div className="flex min-h-0 flex-1">
        {/* left column */}
        <aside className="flex w-[380px] shrink-0 flex-col gap-3 border-r border-navy-700 bg-navy-900 p-3">
          <div className="rounded-lg bg-navy-850 p-2.5 ring-1 ring-navy-700">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-semibold text-white">{current?.name ?? '—'}</div>
                <div className="text-[10px] text-slate-400">{current?.filename} · {current?.page_count ?? '–'} page(s) · {current?.source_type?.toUpperCase()}{current?.metadata?.pdf_mode === 'outlined_text_ocr' ? ' · outlined text → OCR' : ''}</div>
              </div>
              {current?.data_origin && <OriginBadge origin={current.data_origin} />}
            </div>
            <div className="mt-1.5 flex items-center gap-2 text-[11px]">
              <span className={`h-2 w-2 rounded-full ${current?.status === 'ready' ? 'bg-ok' : current?.status === 'error' ? 'bg-issue' : 'animate-pulse bg-incon'}`} />
              <span className="text-slate-300">{current?.status === 'ready' ? 'Extraction & analysis complete' : current?.status === 'error' ? current.error : 'Extracting…'}</span>
            </div>
            {current && current.status !== 'ready' && <pre className="mt-1 max-h-28 overflow-y-auto whitespace-pre-wrap font-mono text-[10px] text-slate-400">{current.progress.slice(-8).join('\n')}</pre>}
            {current?.status === 'ready' && current.counts && <div className="mt-1 font-mono text-[10px] text-slate-500">{current.counts.decks} decks · {current.counts.spaces} spaces · {current.counts.doors} doors · {current.counts.escape_points} escape pts · {current.counts.evidence} evidence records</div>}
          </div>
          {summary && <SafetyOverview summaries={summary.summaries} active={engine} onSelect={setEngine} />}
          {ready && <FindingsPanel findings={findings} engine={engine} selected={selected?.id ?? null} onSelect={selectFinding} />}
        </aside>

        {/* centre */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-1 border-b border-navy-700 bg-navy-900 px-3 py-1">
            {(['drawing', '3d', 'graph', 'compliance', 'report'] as Tab[]).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`rounded px-3 py-1 text-[12px] ${tab === t ? 'bg-navy-700 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
                {t === 'drawing' ? 'Ship design viewer' : t === '3d' ? '3D deck model' : t === 'graph' ? 'Escape-route graph' : t === 'compliance' ? 'Regulatory compliance' : 'Engineering data report'}
              </button>
            ))}
            {selected && <span className="ml-auto truncate text-[11px] text-slate-400">Showing <b className="text-slate-200">{selected.id}</b> · {selected.affected_names[0]}</span>}
          </div>
          <div className="relative min-h-0 flex-1">
            {!ready && <div className="flex h-full items-center justify-center text-sm text-slate-400">{current?.status === 'error' ? current.error : designs.length ? 'Preparing design…' : 'Upload a design (PDF, image or JSON) to begin.'}</div>}
            {ready && tab === 'drawing' && designId && <DrawingViewer page={page} onPage={setPage} designId={designId} sourceType={current!.source_type} model={model!} finding={selected}
              focus={focus} evidenceBox={evBox?.box ?? null} selectedSpace={selSpace} onSelectSpace={setSelSpace} />}
            {ready && tab === 'graph' && graph && <GraphView graph={graph} model={model!} finding={selected} onSelectNode={(id) => { setSelSpace(id); setTab('drawing'); const s = model!.spaces.find((x) => x.id === id); if (s?.bbox) setFocus({ bbox: s.bbox, pad: 2, key: Date.now() }) }} />}
            {ready && tab === 'report' && <DataReport model={model!} summary={summary!} />}
            {ready && tab === '3d' && (!scene ? <div className="p-6 text-sm text-slate-400">Building 3D scene…</div>
              : !scene.available ? <div className="max-w-xl p-6 text-sm text-slate-300"><div className="mb-1 font-semibold text-white">3D deck model not available for this design</div>{scene.reason}</div>
              : <div className="flex h-full">
                  <aside className="w-64 shrink-0 border-r border-navy-700 bg-navy-900">
                    <ZoneTree scene={scene} hidden={hiddenDecks} setHidden={setHiddenDecks} selectedId={selSpace ?? selected?.affected_ids[0] ?? null}
                      onSelect={select3d} onlyFlagged={onlyFlagged} setOnlyFlagged={setOnlyFlagged} />
                  </aside>
                  <div className="min-w-0 flex-1"><Suspense fallback={<div className="p-6 text-sm text-slate-400">Loading 3D engine…</div>}>
                    <ShipViewport scene={scene} selectedId={selSpace ?? selected?.affected_ids[0] ?? null} focusId={focus3d}
                      hiddenDecks={hiddenDecks} onlyFlagged={onlyFlagged} onSelect={select3d} /></Suspense></div>
                </div>)}
            {ready && tab === 'compliance' && (reg ? <RegulatoryPanel ev={reg} demo={demo} onDemo={setDemo} onSelect={selectResult} selected={selResult?.result_id ?? null}
              designId={designId!} onChanged={() => setRegTick((x) => x + 1)} /> : <div className="p-6 text-sm text-slate-400">Loading regulatory evaluation… (requires scripts/fetch_regulations.py)</div>)}
            {selectedSpaceObj && tab === 'drawing' && <div className="absolute right-3 top-3 w-80 rounded-lg bg-navy-900/95 p-2 shadow-xl ring-1 ring-navy-600">
              <div className="mb-1 flex items-center"><span className="text-[10px] uppercase tracking-wider text-slate-400">Element inspector</span><button className="ml-auto text-slate-400 hover:text-white" onClick={() => setSelSpace(null)}>×</button></div>
              <SpaceCard s={selectedSpaceObj} />
              <div className="mt-1 text-[10px] text-slate-400">Doors: {model!.doors.filter((d) => d.space_ids.includes(selectedSpaceObj.id)).map((d) => `${d.id}${d.leaf_width_mm ? ` (leaf ≈${d.leaf_width_mm} mm, derived from symbol)` : ''}`).join(', ') || 'none detected'}</div>
            </div>}
          </div>
          {summary && <div className="border-t border-navy-700 bg-navy-900 px-3 py-1 text-[10px] text-slate-500">{summary.disclaimer}</div>}
        </main>

        {/* right: evidence */}
        <aside className="w-[420px] shrink-0 border-l border-navy-700 bg-navy-900">
          {selResult ? <ComplianceDetail r={selResult} spec={reg?.specs.find((s) => s.spec_id === selResult.spec_id)} onClause={setClauseId}
            onValidate={async () => {
              const who = prompt('Validate this rule encoding as a qualified engineer.\nThis records your name; the result becomes a final status.\n\nName / role:')
              if (who && who.trim()) { await api.regValidate(selResult.spec_id, who.trim()); setRegTick((x) => x + 1) }
            }} /> : <EvidencePanel related={related} onClause={setClauseId} detail={detail} loading={loadingDetail} llmEnabled={!!status?.llm_enabled} activeEvidence={evBox?.id ?? null}
            onEvidence={(b) => { const e = detail?.evidence.find((x) => x.bbox === b); setEvBox({ box: b, id: e?.id ?? '' }); setTab('drawing'); setFocus({ bbox: b, pad: 3, key: Date.now() }) }}
            onExplain={async () => { if (selected && designId) { setLoadingDetail(true); try { setDetail(await api.finding(selected.id, designId, scenario, true)) } finally { setLoadingDetail(false) } } }} />}
          {clauseId && <ClauseModal id={clauseId} onClose={() => setClauseId(null)} />}
        </aside>
      </div>
    </div>
  )
}
