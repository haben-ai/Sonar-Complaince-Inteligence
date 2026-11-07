/** Data layer for the workspace: designs, analysis results, regulatory evaluation and the 3D scene.
 * Same endpoints and calls as before; this only moves them out of the page component. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../services/api'
import type { AnalysisSummary, DesignSummary, EngineeringModel, Finding, GraphData, RegulatoryEvaluation, Scenario, SystemStatus } from '../types'
import type { Scene3D } from '../viewer3d/types'

export function useWorkspace(wantScene: boolean) {
  const [status, setStatus] = useState<SystemStatus | null>(null)
  const [designs, setDesigns] = useState<DesignSummary[]>([])
  const [designId, setDesignIdRaw] = useState<string | null>(null)
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [scenario, setScenario] = useState<string | null>(null)
  const [summary, setSummary] = useState<AnalysisSummary | null>(null)
  const [model, setModel] = useState<EngineeringModel | null>(null)
  const [graph, setGraph] = useState<GraphData | null>(null)
  const [findings, setFindings] = useState<Finding[]>([])
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [loadingAnalysis, setLoadingAnalysis] = useState(false)
  const [reg, setReg] = useState<RegulatoryEvaluation | null>(null)
  const [regError, setRegError] = useState<string | null>(null)
  const [demo, setDemo] = useState(false)
  const [regTick, setRegTick] = useState(0)
  const [scene, setScene] = useState<Scene3D | null>(null)
  const [sceneError, setSceneError] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const current = designs.find((d) => d.design_id === designId) ?? null
  const ready = current?.status === 'ready'

  const refreshDesigns = useCallback(async () => {
    const ds = await api.designs()
    setDesigns(ds)
    return ds
  }, [])

  const setDesignId = useCallback((id: string | null) => {
    setScenario(null); setModel(null); setSummary(null); setFindings([]); setGraph(null); setReg(null); setScene(null)
    setDesignIdRaw(id)
  }, [])

  useEffect(() => {
    api.status().then(setStatus).catch(() => {})
    api.scenarios().then(setScenarios).catch(() => {})
    refreshDesigns().then((ds) => {
      const pick = ds.find((d) => d.design_id === 'dana_v') ?? ds[0]
      if (pick) setDesignIdRaw(pick.design_id)
    }).catch((e) => setErr(`Backend not reachable: ${e}`))
  }, [refreshDesigns])

  // poll while extracting
  useEffect(() => {
    if (!current || current.status === 'ready' || current.status === 'error') return
    const t = setInterval(() => { refreshDesigns().catch(() => {}) }, 900)
    return () => clearInterval(t)
  }, [current, refreshDesigns])

  // analysis results
  useEffect(() => {
    if (!designId || !ready) return
    let live = true
    setAnalysisError(null); setLoadingAnalysis(true)
    Promise.all([api.summary(designId, scenario), api.elements(designId, scenario), api.findings(designId, scenario), api.graph(designId, scenario)])
      .then(([s, m, f, g]) => { if (live) { setSummary(s); setModel(m); setFindings(f); setGraph(g) } })
      .catch((e) => { if (live) setAnalysisError(String(e)) })
      .finally(() => { if (live) setLoadingAnalysis(false) })
    return () => { live = false }
  }, [designId, scenario, ready])

  // regulatory evaluation
  useEffect(() => {
    if (!designId || !ready) return
    let live = true
    setRegError(null)
    api.regEvaluate(designId, scenario, demo).then((r) => { if (live) setReg(r) })
      .catch((e) => { if (live) { setReg(null); setRegError(String(e)) } })
    return () => { live = false }
  }, [designId, scenario, demo, ready, regTick])

  // 3D scene, fetched only once a 3D view is opened
  const sceneKey = useRef('')
  useEffect(() => {
    if (!wantScene || !designId || !ready) return
    const key = `${designId}|${scenario}|${demo}|${regTick}`
    if (sceneKey.current === key) return
    sceneKey.current = key
    setScene(null); setSceneError(null)
    fetch(`/api/design/scene3d?design_id=${designId}${scenario ? `&scenario=${scenario}` : ''}${demo ? '&demo=true' : ''}`)
      .then((r) => { if (!r.ok) throw new Error(`${r.status} ${r.statusText}`); return r.json() })
      .then(setScene).catch((e) => { sceneKey.current = ''; setSceneError(String(e)) })
  }, [wantScene, designId, scenario, demo, ready, regTick])

  const run = async (label: string, fn: () => Promise<string | void>) => {
    setBusy(label); setErr(null)
    try { const id = await fn(); await refreshDesigns(); if (id) setDesignId(id) }
    catch (e) { setErr(String(e)) } finally { setBusy(null) }
  }
  const upload = (file: File) => run('Uploading…', async () => (await api.upload(file)).design_id)
  const importUrl = (url: string) => run('Importing…', async () => {
    const r = await fetch('/api/upload/url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url.trim() }) })
    const d = await r.json()
    if (!r.ok) throw new Error(d.detail ?? r.statusText)
    return d.design_id as string
  })
  const fetchDana = () => run('Fetching…', async () => (await api.fetchDanaV()).design_id)

  return {
    status, designs, designId, setDesignId, current, ready, scenarios, scenario, setScenario,
    summary, model, graph, findings, analysisError, loadingAnalysis,
    reg, regError, demo, setDemo, bumpReg: () => setRegTick((x) => x + 1),
    scene, sceneError, err, setErr, busy, upload, importUrl, fetchDana,
  }
}
export type Workspace = ReturnType<typeof useWorkspace>
