/** Selection and view state shared by the review workspace, explorer and 3D view.
 * Overlay visibility only changes what is drawn; it never touches analysis results. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../services/api'
import type { BBox, ClauseHit, ComplianceResult, EngineId, FindingDetail } from '../types'
import { byPriority, toView, unionBox, viewStatus, type FindingView, type ViewStatus } from '../lib/present'
import type { Workspace } from './useWorkspace'

export interface Overlays {
  rooms: boolean; labels: boolean; doors: boolean; exits: boolean; routes: boolean; hazards: boolean; fire: boolean; selection: boolean
}
export const OVERLAY_LABEL: Record<keyof Overlays, string> = {
  rooms: 'Rooms', labels: 'Room labels', doors: 'Doors', exits: 'Escape points', routes: 'Escape routes',
  hazards: 'Hazardous spaces', fire: 'Fire-risk adjacency', selection: 'Selected finding',
}
const DEFAULT_OVERLAYS: Overlays = { rooms: true, labels: false, doors: true, exits: true, routes: false, hazards: false, fire: false, selection: true }

/** What the drawing / 3D view should emphasise. */
export interface Highlight { status: ViewStatus; primary: string | null; ids: string[]; path: string[]; box: BBox | null }
export interface FocusRequest { bbox: BBox; pad?: number; key: number }
export type InspectorMode = 'finding' | 'space' | 'result' | null
export type ViewMode = '2d' | '3d'
export type GroupBy = 'module' | 'deck' | 'none'

export function useReview(ws: Workspace) {
  const { model, findings, designId, scenario } = ws
  const views = useMemo(() => findings.map((f) => toView(f, model)).sort(byPriority), [findings, model])

  // filters
  const [module, setModuleRaw] = useState<EngineId | null>(null)
  const [statuses, setStatuses] = useState<Set<ViewStatus>>(new Set())
  const [search, setSearch] = useState('')
  const [groupBy, setGroupBy] = useState<GroupBy>('module')

  // selection
  const [findingId, setFindingId] = useState<string | null>(null)
  const [spaceId, setSpaceId] = useState<string | null>(null)
  const [result, setResult] = useState<ComplianceResult | null>(null)
  const [mode, setMode] = useState<InspectorMode>(null)
  const [detail, setDetail] = useState<FindingDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [related, setRelated] = useState<{ results: ComplianceResult[]; clauses: ClauseHit[] } | null>(null)
  const [clauseId, setClauseId] = useState<string | null>(null)

  // view
  const [viewMode, setViewMode] = useState<ViewMode>('2d')
  const [overlays, setOverlays] = useState<Overlays>(DEFAULT_OVERLAYS)
  const [focus, setFocus] = useState<FocusRequest | null>(null)
  const [evidence, setEvidence] = useState<{ box: BBox; id: string } | null>(null)
  const [page, setPage] = useState(0)
  const [hiddenDecks, setHiddenDecks] = useState<Set<string>>(new Set())
  const [onlyFlagged, setOnlyFlagged] = useState(false)
  const [focus3d, setFocus3d] = useState<string | null>(null)

  // a new design or scenario invalidates the selection
  useEffect(() => {
    setFindingId(null); setSpaceId(null); setResult(null); setMode(null); setDetail(null); setRelated(null)
    setEvidence(null); setFocus(null); setPage(0); setHiddenDecks(new Set()); setFocus3d(null)
  }, [designId, scenario])

  const selected = useMemo(() => views.find((v) => v.id === findingId) ?? null, [views, findingId])

  /** Switching module swaps in the module overlays that explain it (routes / hazards / fire); base layers stay as the user left them. */
  const setModule = useCallback((m: EngineId | null) => {
    setModuleRaw(m)
    if (m === 'escape_route_connectivity') setOverlays((o) => ({ ...o, routes: true, hazards: false, fire: false, exits: true }))
    if (m === 'hazardous_space_accessibility') setOverlays((o) => ({ ...o, routes: true, hazards: true, fire: false, exits: true }))
    if (m === 'fire_risk_proximity') setOverlays((o) => ({ ...o, routes: false, hazards: true, fire: true }))
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return views.filter((v) => (!module || v.module === module) && (!statuses.size || statuses.has(v.status)) && (!q || v.search.includes(q)))
  }, [views, module, statuses, search])

  const frame = useCallback((ids: string[], extra: BBox | null, pad: number) => {
    const boxes = (model?.spaces ?? []).filter((s) => ids.includes(s.id) && s.bbox).map((s) => s.bbox!)
    if (extra) boxes.unshift(extra)
    const bb = unionBox(boxes)
    if (bb) setFocus({ bbox: bb, pad, key: Date.now() })
    return bb
  }, [model])

  const selectFinding = useCallback(async (id: string, opts: { keepSpace?: boolean } = {}) => {
    const f = findings.find((x) => x.id === id)
    if (!f) return
    setFindingId(id); setResult(null); setMode('finding'); setEvidence(null); setRelated(null); setDetailError(null)
    if (!opts.keepSpace) setSpaceId(null)
    frame([...f.affected_ids.slice(0, 1), ...f.highlight_path, ...f.highlight_ids], f.location, 0.25)
    if (f.affected_ids[0]) setFocus3d(f.affected_ids[0])
    if (!designId) return
    api.regRelated(designId, f.id, scenario).then(setRelated).catch(() => setRelated(null))
    setDetail(null); setLoadingDetail(true)
    try { setDetail(await api.finding(f.id, designId, scenario)) }
    catch (e) { setDetailError(String(e)) }
    finally { setLoadingDetail(false) }
  }, [findings, designId, scenario, frame])

  const selectSpace = useCallback((id: string | null, opts: { focus?: boolean } = {}) => {
    setSpaceId(id)
    if (!id) { if (mode === 'space') setMode(findingId ? 'finding' : result ? 'result' : null); return }
    setMode('space')
    setFocus3d(id)
    if (opts.focus) frame([id], null, 1.5)
  }, [frame, mode, findingId, result])

  const selectResult = useCallback((r: ComplianceResult) => {
    setResult(r); setMode('result'); setFindingId(null); setDetail(null); setSpaceId(null); setEvidence(null); setRelated(null)
    frame([...r.element_ids.slice(0, 12), ...r.highlight_path], null, 0.3)
    if (r.element_ids[0]) setFocus3d(r.element_ids[0])
  }, [frame])

  /** 3D click: select the space, and open the most severe finding / check that targets it. */
  const select3d = useCallback((id: string) => {
    const sp = ws.scene?.spaces.find((s) => s.id === id)
    setFocus3d(id)
    if (!sp || !sp.refs.length) { selectSpace(id); return }
    const rank = { red: 3, amber: 2, green: 1, none: 0 } as const
    const ref = [...sp.refs].sort((a, b) => rank[b.band] - rank[a.band] || (a.kind === 'finding' ? -1 : 1))[0]
    if (ref.kind === 'finding') { setSpaceId(id); selectFinding(ref.id, { keepSpace: true }) }
    else { const r = ws.reg?.results.find((x) => x.result_id === ref.id); if (r) selectResult(r); else selectSpace(id) }
  }, [ws.scene, ws.reg, selectSpace, selectFinding, selectResult])

  const clearSelection = useCallback(() => {
    setFindingId(null); setSpaceId(null); setResult(null); setMode(null); setDetail(null); setRelated(null); setEvidence(null)
  }, [])

  /** "Locate in drawing": original drawing view, correct sheet, framed on the finding's evidence. */
  const locate = useCallback(() => {
    setViewMode('2d')
    if (mode === 'result' && result) { frame([...result.element_ids.slice(0, 12), ...result.highlight_path], null, 0.3); return }
    if (mode === 'space' && spaceId) { frame([spaceId], null, 1.5); return }
    const f = selected?.raw
    if (f) frame([...f.affected_ids.slice(0, 1), ...f.highlight_path, ...f.highlight_ids], f.location, 0.25)
  }, [mode, result, spaceId, selected, frame])

  const showEvidence = useCallback((box: BBox, id: string) => {
    setViewMode('2d'); setEvidence({ box, id }); setFocus({ bbox: box, pad: 3, key: Date.now() })
  }, [])

  const highlight: Highlight | null = useMemo(() => {
    if (mode === 'result' && result) {
      return { status: viewStatus(result.status === 'POTENTIAL_NON_COMPLIANCE' ? 'POTENTIAL_CONNECTIVITY_ISSUE' : result.status === 'COMPLIANT_ON_AVAILABLE_EVIDENCE' ? 'CONNECTIVITY_VERIFIED' : 'INCONCLUSIVE'),
        primary: result.element_ids[0] ?? null, ids: result.element_ids.slice(0, 40), path: result.highlight_path, box: null }
    }
    const f = selected?.raw
    if (!f) return null
    return { status: viewStatus(f.status), primary: f.affected_ids[0] ?? null, ids: [...f.affected_ids, ...f.highlight_ids], path: f.highlight_path, box: f.location }
  }, [mode, result, selected])

  const explain = useCallback(async () => {
    if (!selected || !designId) return
    setLoadingDetail(true)
    try { setDetail(await api.finding(selected.id, designId, scenario, true)) } catch (e) { setDetailError(String(e)) } finally { setLoadingDetail(false) }
  }, [selected, designId, scenario])

  return {
    views, filtered, module, setModule, statuses, setStatuses, search, setSearch, groupBy, setGroupBy,
    selected, findingId, spaceId, result, mode, detail, detailError, loadingDetail, related, clauseId, setClauseId,
    selectFinding, selectSpace, selectResult, select3d, clearSelection, locate, showEvidence, explain,
    viewMode, setViewMode, overlays, setOverlays, focus, evidence, page, setPage, hiddenDecks, setHiddenDecks,
    onlyFlagged, setOnlyFlagged, focus3d, highlight,
  }
}
export type Review = ReturnType<typeof useReview>
export type { FindingView }
