import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react'
import { api } from '../services/api'
import type { BBox, EngineeringModel, Space } from '../types'
import { VIEW_STATUS, type ViewStatus } from '../lib/present'
import type { FocusRequest, Highlight, Overlays } from '../state/useReview'
import { KIND_COLOR } from './ui'

export type { FocusRequest }
export interface ViewerHandle { zoomIn: () => void; zoomOut: () => void; fitAll: () => void }

interface Props {
  page: number
  onPage: (p: number) => void
  designId: string
  sourceType: string
  model: EngineeringModel
  highlight: Highlight | null
  focus: FocusRequest | null
  evidenceBox: BBox | null
  selectedSpace: string | null
  onSelectSpace: (id: string | null) => void
  overlays: Overlays
  escStatus: Map<string, ViewStatus>
  ref?: Ref<ViewerHandle>
}

type VB = { x: number; y: number; w: number; h: number }
const HAZ = '#b8622e'
const ACCENT = '#12807f'

/** Original drawing (PDF render) with extracted geometry drawn on top in page coordinates. */
export default function DrawingViewer({ page, onPage, designId, sourceType, model, highlight, focus, evidenceBox, selectedSpace, onSelectSpace, overlays, escStatus, ref }: Props) {
  const [W, H] = model.document.page_sizes[page] ?? model.document.page_sizes[0] ?? [1000, 1000]
  const onPg = (b: { page?: number } | null | undefined) => (b?.page ?? 0) === page
  const pageDecks = useMemo(() => model.decks.filter((d) => d.page === page), [model.decks, page])
  const hasDrawing = sourceType !== 'json'
  const wrap = useRef<HTMLDivElement>(null)
  const svg = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [vb, setVb] = useState<VB>({ x: 0, y: 0, w: W, h: H })
  const [hi, setHi] = useState<{ url: string; x: number; y: number; w: number; h: number } | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const drag = useRef<{ x: number; y: number; vb: VB } | null>(null)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const fit = useCallback((b: { x0: number; y0: number; x1: number; y1: number }, pad = 0.15) => {
    if (size.w < 10 || size.h < 10 || ![b.x0, b.y0, b.x1, b.y1].every(Number.isFinite)) return
    const bw = Math.max(b.x1 - b.x0, 20), bh = Math.max(b.y1 - b.y0, 20)
    let w = bw * (1 + 2 * pad), h = bh * (1 + 2 * pad)
    const ar = size.w / Math.max(size.h, 1)
    if (w / h > ar) h = w / ar; else w = h * ar
    setVb({ x: (b.x0 + b.x1) / 2 - w / 2, y: (b.y0 + b.y1) / 2 - h / 2, w, h })
  }, [size])

  const fitAll = useCallback(() => {
    if (pageDecks.length && model.document.page_count === 1) {
      fit({ x0: Math.min(...pageDecks.map((d) => d.bbox.x0)), x1: Math.max(...pageDecks.map((d) => d.bbox.x1)),
        y0: Math.min(...pageDecks.map((d) => d.bbox.y0)), y1: Math.max(...pageDecks.map((d) => d.bbox.y1)) }, 0.02)
    } else fit({ x0: 0, y0: 0, x1: W, y1: H }, 0.02)
  }, [pageDecks, model.document.page_count, W, H, fit])

  useImperativeHandle(ref, () => ({
    zoomIn: () => setVb((v) => ({ x: v.x + v.w * 0.15, y: v.y + v.h * 0.15, w: v.w * 0.7, h: v.h * 0.7 })),
    zoomOut: () => setVb((v) => ({ x: v.x - v.w * 0.2, y: v.y - v.h * 0.2, w: v.w * 1.4, h: v.h * 1.4 })),
    fitAll,
  }), [fitAll])

  // initial view per sheet
  const initialised = useRef('')
  useEffect(() => {
    const key = `${designId}:${page}`
    if (initialised.current === key || size.w < 10) return
    initialised.current = key
    setHi(null)
    fitAll()
  }, [designId, page, size, fitAll])

  const laidOut = size.w >= 10 && size.h >= 10
  useEffect(() => {
    if (!focus || !laidOut) return
    const pg = focus.bbox.page ?? 0
    initialised.current = `${designId}:${pg}`
    if (pg !== page) onPage(pg)
    fit(focus.bbox, focus.pad ?? 0.6)
  }, [focus, laidOut]) // eslint-disable-line react-hooks/exhaustive-deps

  // high-resolution tile for the current view
  useEffect(() => {
    if (!hasDrawing) return
    if (vb.w > W * 0.55 || !Number.isFinite(vb.w) || size.w < 10) { setHi(null); return }
    const t = setTimeout(() => {
      const dpr = window.devicePixelRatio || 1
      const zoom = Math.min(8, (size.w * dpr) / vb.w)
      const x0 = Math.max(0, vb.x), y0 = Math.max(0, vb.y), x1 = Math.min(W, vb.x + vb.w), y1 = Math.min(H, vb.y + vb.h)
      if (x1 <= x0 || y1 <= y0) return
      const url = api.pageUrl(designId, page, zoom, [x0, y0, x1, y1])
      const img = new Image()
      img.onload = () => setHi({ url, x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
      img.src = url
    }, 220)
    return () => clearTimeout(t)
  }, [vb, size, designId, page, W, H, hasDrawing])

  const toSvg = (cx: number, cy: number) => {
    const s = svg.current
    if (!s) return { x: 0, y: 0 }
    const r = s.getBoundingClientRect()
    return { x: vb.x + ((cx - r.left) / r.width) * vb.w, y: vb.y + ((cy - r.top) / r.height) * vb.h }
  }
  const onWheel = (e: React.WheelEvent) => {
    const p = toSvg(e.clientX, e.clientY)
    const f = Math.exp(e.deltaY * 0.0015)
    const w = Math.min(Math.max(vb.w * f, 15), W * 3), h = (w * vb.h) / vb.w
    setVb({ x: p.x - ((p.x - vb.x) * w) / vb.w, y: p.y - ((p.y - vb.y) * h) / vb.h, w, h })
  }
  const onDown = (e: React.PointerEvent) => { drag.current = { x: e.clientX, y: e.clientY, vb }; (e.target as Element).setPointerCapture?.(e.pointerId) }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) { setHover((e.target as Element).getAttribute?.('data-space') ?? null); return }
    if (!svg.current) return
    const r = svg.current.getBoundingClientRect()
    setVb({ ...d.vb, x: d.vb.x - ((e.clientX - d.x) / r.width) * d.vb.w, y: d.vb.y - ((e.clientY - d.y) / r.height) * d.vb.h })
  }
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (d && Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) < 4) onSelectSpace((e.target as Element).getAttribute('data-space'))
  }

  const spaceById = useMemo(() => new Map(model.spaces.map((s) => [s.id, s])), [model.spaces])
  const escById = useMemo(() => new Map(model.escape_points.map((e) => [e.id, e])), [model.escape_points])
  const anchorOf = useCallback((id: string): [number, number] | null => {
    const s = spaceById.get(id)
    if (s?.anchor) return s.anchor
    const e = escById.get(id)
    if (e?.bbox) return [(e.bbox.x0 + e.bbox.x1) / 2, (e.bbox.y0 + e.bbox.y1) / 2]
    return null
  }, [spaceById, escById])
  const boxOf = (id: string) => spaceById.get(id)?.bbox ?? escById.get(id)?.bbox ?? null

  const sw = Math.max(vb.w / Math.max(size.w, 1), vb.h / Math.max(size.h, 1)) // one screen pixel in page units
  const statusColor = highlight ? VIEW_STATUS[highlight.status].hex : ACCENT
  const hl = new Set(highlight?.ids ?? [])
  const primary = highlight?.primary
  const pathPts = (highlight?.path ?? []).filter((id) => onPg(boxOf(id))).map(anchorOf).filter(Boolean) as [number, number][]
  const synthetic = new Set(model.scenario_affected_ids)
  const poly = (s: Space) => s.polygon.map((p) => p.join(',')).join(' ')
  const visibleSpaces = model.spaces.filter((s) => s.polygon.length > 2 && onPg(s.bbox))

  // escape-route graph on this sheet (door / escape-access links between anchors on the same sheet)
  const routeEdges = useMemo(() => !overlays.routes ? [] : model.connections.flatMap((c) => {
    if (c.type === 'vertical_stair') return []
    const a = anchorOf(c.source), b = anchorOf(c.target)
    if (!a || !b || !onPg(boxOf(c.source)) || !onPg(boxOf(c.target))) return []
    return [{ c, a, b }]
  }), [overlays.routes, model.connections, anchorOf, page]) // eslint-disable-line react-hooks/exhaustive-deps
  const stairLinks = useMemo(() => {
    const m = new Map<string, string>()
    if (overlays.routes) for (const c of model.connections) if (c.type === 'vertical_stair') { m.set(c.source, c.certainty); m.set(c.target, c.certainty) }
    return m
  }, [overlays.routes, model.connections])
  const routeNodes = useMemo(() => {
    if (!overlays.routes) return []
    const ids = new Set<string>()
    for (const { c } of routeEdges) { ids.add(c.source); ids.add(c.target) }
    for (const id of escStatus.keys()) ids.add(id)
    return [...ids].filter((id) => spaceById.has(id) && onPg(spaceById.get(id)!.bbox) && spaceById.get(id)!.anchor)
  }, [overlays.routes, routeEdges, escStatus, spaceById, page]) // eslint-disable-line react-hooks/exhaustive-deps

  // fire-risk adjacency on this sheet (shared boundaries; vertical overlaps are listed in the inspector)
  const fireEdges = useMemo(() => !overlays.fire ? [] : model.adjacencies.flatMap((a) => {
    if (a.relation !== 'shared_boundary') return []
    const sa = spaceById.get(a.space_a), sb = spaceById.get(a.space_b)
    if (!sa || !sb || !(sa.hazard?.fire_risk || sb.hazard?.fire_risk) || !sa.anchor || !sb.anchor || !onPg(sa.bbox) || !onPg(sb.bbox)) return []
    return [{ a, p: sa.anchor, q: sb.anchor }]
  }), [overlays.fire, model.adjacencies, spaceById, page]) // eslint-disable-line react-hooks/exhaustive-deps

  const hoverSpace = hover ? spaceById.get(hover) : null
  const scale = (pageDecks[0] ?? model.decks[0])?.scale

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#e9f1f1]" ref={wrap}>
      <svg ref={svg} className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid meet"
        onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => setHover(null)}>
        <defs>
          <pattern id="haz-hatch" patternUnits="userSpaceOnUse" width={sw * 7} height={sw * 7} patternTransform="rotate(45)">
            <line x1={0} y1={0} x2={0} y2={sw * 7} stroke={HAZ} strokeWidth={sw * 1.6} strokeOpacity={0.75} />
          </pattern>
        </defs>
        {hasDrawing ? <>
          <rect x={0} y={0} width={W} height={H} fill="#fff" />
          <image href={api.pageUrl(designId, page, Math.min(1, 2400 / Math.max(W, H)))} x={0} y={0} width={W} height={H} preserveAspectRatio="none" />
          {hi && <image href={hi.url} x={hi.x} y={hi.y} width={hi.w} height={hi.h} preserveAspectRatio="none" />}
        </> : <>
          <rect x={0} y={0} width={W} height={H} fill="#ffffff" stroke="#c9dada" strokeWidth={sw} />
          {pageDecks.map((d) => <text key={d.id} x={d.bbox.x0 + 2} y={d.bbox.y0 - 3} fontSize={sw * 12} fill="#4d6363">{d.name}</text>)}
        </>}

        {/* rooms: always hit-testable so the drawing stays clickable with the overlay hidden */}
        {visibleSpaces.map((s) => {
          const sel = s.id === selectedSpace
          const show = overlays.rooms
          return <polygon key={s.id} data-space={s.id} points={poly(s)}
            fill={KIND_COLOR[s.kind] ?? '#6b7685'}
            fillOpacity={!show ? 0 : (overlays.selection && hl.has(s.id)) ? 0 : sel ? 0.4 : hover === s.id ? 0.3 : hasDrawing ? 0.12 : 0.3}
            stroke={sel ? ACCENT : KIND_COLOR[s.kind] ?? '#6b7685'} strokeOpacity={!show && !sel ? 0 : hasDrawing ? 0.6 : 0.9}
            strokeWidth={sw * (sel ? 2.5 : 0.8)}
            strokeDasharray={s.provenance === 'manual_annotation' ? `${sw * 6} ${sw * 3}` : undefined} />
        })}

        {overlays.hazards && visibleSpaces.filter((s) => s.hazard).map((s) => (
          <polygon key={'hz' + s.id} points={poly(s)} fill="url(#haz-hatch)" stroke={HAZ} strokeWidth={sw * 1.6} style={{ pointerEvents: 'none' }} />
        ))}

        {overlays.labels && visibleSpaces.map((s) => s.anchor && (s.name || s.kind === 'corridor' || s.kind === 'stair') && (
          <text key={'l' + s.id} x={s.anchor[0]} y={s.anchor[1]} fontSize={sw * 10} fill="#0b2f5c" textAnchor="middle" style={{ pointerEvents: 'none', fontWeight: 600 }}>
            {s.name ?? s.kind}{overlays.hazards && s.hazard ? ` · ${s.hazard.category.replace(/_/g, ' ')}` : ''}
          </text>
        ))}

        {overlays.doors && model.doors.filter((d) => onPg(d.bbox)).map((d) => (
          <rect key={d.id} x={d.bbox.x0} y={d.bbox.y0} width={d.bbox.x1 - d.bbox.x0} height={d.bbox.y1 - d.bbox.y0}
            fill="none" stroke={d.resolution === 'resolved' ? '#2b8fd6' : '#b7791f'} strokeWidth={sw * 1.2} style={{ pointerEvents: 'none' }} />
        ))}

        {/* fire-risk adjacency: geometric adjacency only, fire integrity not documented */}
        {fireEdges.map(({ a, p, q }) => {
          const on = hl.has(a.space_a) && hl.has(a.space_b)
          return <line key={a.id} x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} stroke="#b7791f" strokeWidth={sw * (on ? 3 : 1.4)}
            strokeOpacity={on || !highlight ? 0.9 : 0.35} strokeDasharray={`${sw * 5} ${sw * 3}`} style={{ pointerEvents: 'none' }} />
        })}

        {/* escape-route graph: rooms as nodes, door / escape-access links as edges */}
        {routeEdges.map(({ c, a, b }) => {
          const known = c.certainty === 'extracted' || c.certainty === 'synthetic'
          return <line key={c.id} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={known ? '#2e8b57' : '#b7791f'}
            strokeWidth={sw * (known ? 1.6 : 1.8)} strokeOpacity={0.85} strokeDasharray={known ? undefined : `${sw * 4} ${sw * 3}`} style={{ pointerEvents: 'none' }} />
        })}
        {routeNodes.map((id) => {
          const s = spaceById.get(id)!
          const st = escStatus.get(id) ?? 'not_assessed'
          const stair = stairLinks.get(id)
          return <g key={'n' + id}>
            {stair && <circle cx={s.anchor![0]} cy={s.anchor![1]} r={sw * 8} fill="none" stroke="#b7791f" strokeWidth={sw * 1.2}
              strokeDasharray={stair === 'extracted' || stair === 'synthetic' ? undefined : `${sw * 3} ${sw * 2}`} style={{ pointerEvents: 'none' }} />}
            <circle data-space={id} cx={s.anchor![0]} cy={s.anchor![1]} r={sw * (id === selectedSpace ? 6 : 4.5)} fill={VIEW_STATUS[st].hex}
              stroke={id === selectedSpace ? ACCENT : '#ffffff'} strokeWidth={sw * (id === selectedSpace ? 2.5 : 1)} className="cursor-pointer" />
          </g>
        })}

        {overlays.exits && model.escape_points.map((e) => {
          if (!e.bbox || !onPg(e.bbox)) return null
          const big = e.kind === 'open_deck_access'
          const a = big && e.space_id ? spaceById.get(e.space_id)?.anchor : null
          const cx = a ? a[0] : (e.bbox.x0 + e.bbox.x1) / 2, cy = a ? a[1] : (e.bbox.y0 + e.bbox.y1) / 2
          return <g key={e.id} style={{ pointerEvents: 'none' }}>
            <rect x={cx - sw * 8} y={cy - sw * 8} width={sw * 16} height={sw * 16} transform={`rotate(45 ${cx} ${cy})`}
              fill="#ffffff" stroke="#2e8b57" strokeWidth={sw * 2} strokeDasharray={e.provenance === 'manual_annotation' ? `${sw * 3} ${sw * 2}` : undefined} />
            <text x={cx} y={cy + sw * 3} fontSize={sw * 7.5} fill="#1d5a34" textAnchor="middle" fontWeight={700}>{big ? 'OUT' : 'ESC'}</text>
          </g>
        })}

        {/* selected finding */}
        {overlays.selection && highlight && [...hl].map((id) => {
          const s = spaceById.get(id)
          if (!s || s.polygon.length < 3 || !onPg(s.bbox)) return null
          const isPrimary = id === primary
          return <polygon key={'h' + id} points={poly(s)} fill={statusColor} fillOpacity={isPrimary ? 0.32 : 0.12}
            stroke={statusColor} strokeWidth={sw * (isPrimary ? 3 : 1.5)} style={{ pointerEvents: 'none' }}
            strokeDasharray={synthetic.has(id) ? `${sw * 5} ${sw * 3}` : undefined} />
        })}
        {overlays.selection && pathPts.length > 1 && <g style={{ pointerEvents: 'none' }}>
          <polyline points={pathPts.map((p) => p.join(',')).join(' ')} fill="none" stroke="#ffffff" strokeWidth={sw * 6} strokeLinejoin="round" strokeOpacity={0.55} />
          <polyline points={pathPts.map((p) => p.join(',')).join(' ')} fill="none" stroke={statusColor} strokeWidth={sw * 3} strokeLinejoin="round" strokeDasharray={`${sw * 8} ${sw * 4}`} />
          {pathPts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={sw * (i === 0 ? 6 : 4)} fill={i === 0 ? statusColor : '#fff'} stroke={statusColor} strokeWidth={sw * 2} />)}
        </g>}
        {evidenceBox && onPg(evidenceBox) && <rect x={evidenceBox.x0 - sw * 4} y={evidenceBox.y0 - sw * 4} width={evidenceBox.x1 - evidenceBox.x0 + sw * 8}
          height={evidenceBox.y1 - evidenceBox.y0 + sw * 8} fill={ACCENT} fillOpacity={0.1} stroke={ACCENT} strokeWidth={sw * 2.5}
          strokeDasharray={`${sw * 6} ${sw * 3}`} style={{ pointerEvents: 'none' }} />}
      </svg>

      {hoverSpace && <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded border border-navy-700 bg-navy-900/95 px-2 py-0.5 text-[11px] text-ink">
        {hoverSpace.name ?? '(unlabelled)'} <span className="text-faint">· {hoverSpace.kind.replace(/_/g, ' ')}{hoverSpace.hazard ? ` · ${hoverSpace.hazard.category.replace(/_/g, ' ')}` : ''}</span>
      </div>}

      <div className="pointer-events-none absolute bottom-2 left-2 rounded border border-navy-700 bg-navy-900/90 px-2 py-0.5 font-mono text-[10px] text-dim">
        {hasDrawing ? `Original ${sourceType.toUpperCase()} · sheet ${page + 1}/${model.document.page_count}` : 'Structured JSON - no drawing; polygons from data'}
        {scale && ` · 1 pt = ${(scale.metres_per_unit * 1000).toFixed(1)} mm`}
        {model.document.metadata?.pdf_mode === 'outlined_text_ocr' && ' · labels by OCR'}
      </div>
      <Legend overlays={overlays} highlight={highlight} />
    </div>
  )
}

function Legend({ overlays, highlight }: { overlays: Overlays; highlight: Highlight | null }) {
  const items: [React.ReactNode, string][] = []
  const sw = (c: string, dash = false) => <svg width="18" height="6"><line x1="1" y1="3" x2="17" y2="3" stroke={c} strokeWidth="2" strokeDasharray={dash ? '3 2' : undefined} /></svg>
  const dot = (c: string) => <span className="status-dot inline-block h-2 w-2 rounded-full" style={{ background: c }} />
  if (overlays.selection && highlight) items.push([dot(VIEW_STATUS[highlight.status].hex), `Selected: ${VIEW_STATUS[highlight.status].label.toLowerCase()}`])
  if (overlays.routes) {
    items.push([sw('#2e8b57'), 'Connection found in extracted geometry'], [sw('#b7791f', true), 'Inferred / manual link'])
    items.push([dot(VIEW_STATUS.issue.hex), 'Potential connectivity issue'], [dot(VIEW_STATUS.inconclusive.hex), 'Insufficient evidence / review'],
      [dot(VIEW_STATUS.verified.hex), 'Route found on available evidence'], [dot(VIEW_STATUS.not_assessed.hex), 'Not assessed by the escape module'])
  }
  if (overlays.hazards) items.push([<span className="inline-block h-2.5 w-3 border" style={{ borderColor: HAZ, background: `repeating-linear-gradient(45deg, ${HAZ} 0 1.5px, transparent 1.5px 4px)` }} />, 'Hazardous space (label)'])
  if (overlays.fire) items.push([sw('#b7791f', true), 'Fire-risk adjacency (rating not documented)'])
  if (overlays.exits) items.push([<span className="inline-block h-2 w-2 rotate-45 border-[1.5px] border-[#2e8b57] bg-[#ffffff]" />, 'Escape point'])
  if (overlays.doors) items.push([<span className="inline-block h-2 w-2 border border-[#2b8fd6]" />, 'Door'])
  const [open, setOpen] = useState(true)
  if (!items.length) return null
  return <div className="absolute bottom-2 right-2 max-w-[340px] rounded border border-navy-700 bg-navy-900/92 text-[10.5px] text-dim">
    <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-2 py-1 text-left text-[10px] font-semibold font-label uppercase tracking-[0.08em] text-faint hover:text-ink">
      Legend<span className="ml-auto">{open ? '▾' : '▴'}</span></button>
    {open && <div className="px-2 pb-1.5">
      {items.map(([icon, label], i) => <div key={i} className="flex items-center gap-1.5 leading-[16px]"><span className="flex w-[18px] justify-center">{icon}</span>{label}</div>)}
      {overlays.routes && <div className="mt-1 border-t border-navy-700 pt-1 text-[10px] text-faint">Graph connectivity is not a compliance determination.</div>}
    </div>}
  </div>
}
