import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../services/api'
import type { BBox, EngineeringModel, Finding, Space } from '../types'
import { KIND_COLOR, STATUS_META } from './ui'

export interface FocusRequest { bbox: BBox; pad?: number; key: number }

interface Props {
  page: number
  onPage: (p: number) => void
  designId: string
  sourceType: string
  model: EngineeringModel
  finding: Finding | null
  focus: FocusRequest | null
  evidenceBox: BBox | null
  selectedSpace: string | null
  onSelectSpace: (id: string | null) => void
}

type VB = { x: number; y: number; w: number; h: number }

export default function DrawingViewer({ page, onPage, designId, sourceType, model, finding, focus, evidenceBox, selectedSpace, onSelectSpace }: Props) {
  const [W, H] = model.document.page_sizes[page] ?? model.document.page_sizes[0] ?? [1000, 1000]
  const onPg = (b: { page?: number } | null | undefined) => (b?.page ?? 0) === page
  const pageDecks = model.decks.filter((d) => d.page === page)
  const hasDrawing = sourceType !== 'json'
  const wrap = useRef<HTMLDivElement>(null)
  const svg = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [vb, setVb] = useState<VB>({ x: 0, y: 0, w: W, h: H })
  const [hi, setHi] = useState<{ url: string; x: number; y: number; w: number; h: number } | null>(null)
  const [layers, setLayers] = useState({ spaces: true, doors: true, escapes: true, labels: false })
  const drag = useRef<{ x: number; y: number; vb: VB } | null>(null)

  // keep viewBox aspect equal to the container
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const fit = useCallback((b: { x0: number; y0: number; x1: number; y1: number }, pad = 0.15) => {
    const bw = Math.max(b.x1 - b.x0, 20), bh = Math.max(b.y1 - b.y0, 20)
    let w = bw * (1 + 2 * pad), h = bh * (1 + 2 * pad)
    const ar = size.w / Math.max(size.h, 1)
    if (w / h > ar) h = w / ar; else w = h * ar
    setVb({ x: (b.x0 + b.x1) / 2 - w / 2, y: (b.y0 + b.y1) / 2 - h / 2, w, h })
  }, [size])

  // initial view: the decks area (or whole page)
  const initialised = useRef('')
  useEffect(() => {
    const key = `${designId}:${page}`
    if (initialised.current === key || size.w < 10) return
    initialised.current = key
    setHi(null)
    if (pageDecks.length && model.document.page_count === 1) {
      const x0 = Math.min(...pageDecks.map((d) => d.bbox.x0)), x1 = Math.max(...pageDecks.map((d) => d.bbox.x1))
      const y0 = Math.min(...pageDecks.map((d) => d.bbox.y0)), y1 = Math.max(...pageDecks.map((d) => d.bbox.y1))
      fit({ x0, y0, x1, y1 }, 0.02)
    } else fit({ x0: 0, y0: 0, x1: W, y1: H }, 0.02)
  }, [designId, page, size, pageDecks, model.document.page_count, W, H, fit])

  useEffect(() => {
    if (!focus) return
    if ((focus.bbox.page ?? 0) !== page) { initialised.current = `${designId}:${focus.bbox.page}`; onPage(focus.bbox.page ?? 0) }
    fit(focus.bbox, focus.pad ?? 0.6)
  }, [focus]) // eslint-disable-line react-hooks/exhaustive-deps

  // high-resolution tile for the current view
  useEffect(() => {
    if (!hasDrawing) return
    if (vb.w > W * 0.55) { setHi(null); return }
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
  }, [vb, size, designId, W, H, hasDrawing])

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
    if (!d || !svg.current) return
    const r = svg.current.getBoundingClientRect()
    setVb({ ...d.vb, x: d.vb.x - ((e.clientX - d.x) / r.width) * d.vb.w, y: d.vb.y - ((e.clientY - d.y) / r.height) * d.vb.h })
  }
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (d && Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) < 4) {
      // click: select space under cursor
      const t = (e.target as Element).getAttribute('data-space')
      onSelectSpace(t)
    }
  }

  const spaceById = useMemo(() => new Map(model.spaces.map((s) => [s.id, s])), [model.spaces])
  const escById = useMemo(() => new Map(model.escape_points.map((e) => [e.id, e])), [model.escape_points])
  const anchorOf = (id: string): [number, number] | null => {
    const s = spaceById.get(id)
    if (s?.anchor) return s.anchor
    const e = escById.get(id)
    if (e?.bbox) return [(e.bbox.x0 + e.bbox.x1) / 2, (e.bbox.y0 + e.bbox.y1) / 2]
    return null
  }

  const statusColor = finding ? STATUS_META[finding.status].hex : '#38bdf8'
  const hl = new Set(finding ? [...finding.affected_ids, ...finding.highlight_ids] : [])
  const primary = finding?.affected_ids[0]
  const pathPts = (finding?.highlight_path ?? []).filter((id) => onPg(spaceById.get(id)?.bbox ?? escById.get(id)?.bbox)).map(anchorOf).filter(Boolean) as [number, number][]
  const sw = Math.max(vb.w / Math.max(size.w, 1), vb.h / Math.max(size.h, 1)) // one screen pixel in page units
  const synthetic = new Set(model.scenario_affected_ids)

  const poly = (s: Space) => s.polygon.map((p) => p.join(',')).join(' ')

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#0b1220]" ref={wrap}>
      <svg ref={svg} className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid meet"
        onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
        {hasDrawing ? <>
          <rect x={0} y={0} width={W} height={H} fill="#fff" />
          <image href={api.pageUrl(designId, page, Math.min(1, 2400 / Math.max(W, H)))} x={0} y={0} width={W} height={H} preserveAspectRatio="none" />
          {hi && <image href={hi.url} x={hi.x} y={hi.y} width={hi.w} height={hi.h} preserveAspectRatio="none" />}
        </> : <>
          <rect x={0} y={0} width={W} height={H} fill="#0f1b30" stroke="#24406a" strokeWidth={sw} />
          {pageDecks.map((d) => <text key={d.id} x={d.bbox.x0 + 2} y={d.bbox.y0 - 3} fontSize={sw * 12} fill="#7f9cc6">{d.name}</text>)}
        </>}

        {layers.spaces && model.spaces.map((s) => s.polygon.length > 2 && onPg(s.bbox) && (
          <polygon key={s.id} data-space={s.id} points={poly(s)}
            fill={KIND_COLOR[s.kind] ?? '#64748b'} fillOpacity={hl.has(s.id) ? 0 : s.id === selectedSpace ? 0.45 : hasDrawing ? 0.16 : 0.35}
            stroke={s.id === selectedSpace ? '#38bdf8' : KIND_COLOR[s.kind] ?? '#64748b'} strokeOpacity={hasDrawing ? 0.55 : 0.9}
            strokeWidth={sw * (s.id === selectedSpace ? 2.5 : 0.8)}
            strokeDasharray={s.provenance === 'manual_annotation' ? `${sw * 6} ${sw * 3}` : undefined} />
        ))}
        {layers.labels && model.spaces.map((s) => s.anchor && onPg(s.bbox) && (s.name || s.kind === 'corridor' || s.kind === 'stair') && (
          <text key={'l' + s.id} x={s.anchor[0]} y={s.anchor[1]} fontSize={sw * 10} fill="#0b3a75" textAnchor="middle" style={{ pointerEvents: 'none', fontWeight: 600 }}>
            {s.name ?? s.kind}
          </text>
        ))}
        {layers.doors && model.doors.filter((d) => onPg(d.bbox)).map((d) => (
          <rect key={d.id} x={d.bbox.x0} y={d.bbox.y0} width={d.bbox.x1 - d.bbox.x0} height={d.bbox.y1 - d.bbox.y0}
            fill="none" stroke={d.resolution === 'resolved' ? '#0ea5e9' : '#f97316'} strokeWidth={sw * 1.2} style={{ pointerEvents: 'none' }} />
        ))}
        {layers.escapes && model.escape_points.map((e) => {
          if (!e.bbox || !onPg(e.bbox)) return null
          const big = e.kind === 'open_deck_access'
          const cx = big && e.space_id && spaceById.get(e.space_id)?.anchor ? spaceById.get(e.space_id)!.anchor![0] : (e.bbox.x0 + e.bbox.x1) / 2
          const cy = big && e.space_id && spaceById.get(e.space_id)?.anchor ? spaceById.get(e.space_id)!.anchor![1] : (e.bbox.y0 + e.bbox.y1) / 2
          return <g key={e.id} style={{ pointerEvents: 'none' }}>
            <circle cx={cx} cy={cy} r={sw * 9} fill="#16a34a" fillOpacity={0.85} stroke="#fff" strokeWidth={sw * 1.5}
              strokeDasharray={e.provenance === 'manual_annotation' ? `${sw * 3} ${sw * 2}` : undefined} />
            <text x={cx} y={cy + sw * 3.5} fontSize={sw * 9} fill="#fff" textAnchor="middle" fontWeight={700}>{big ? 'OUT' : 'ESC'}</text>
          </g>
        })}

        {/* finding highlight */}
        {finding && [...hl].map((id) => {
          const s = spaceById.get(id)
          if (!s || s.polygon.length < 3 || !onPg(s.bbox)) return null
          const isPrimary = id === primary
          return <polygon key={'h' + id} points={poly(s)} fill={statusColor} fillOpacity={isPrimary ? 0.35 : 0.14}
            stroke={statusColor} strokeWidth={sw * (isPrimary ? 3 : 1.5)} style={{ pointerEvents: 'none' }}
            strokeDasharray={synthetic.has(id) ? `${sw * 5} ${sw * 3}` : undefined} />
        })}
        {pathPts.length > 1 && <g style={{ pointerEvents: 'none' }}>
          <polyline points={pathPts.map((p) => p.join(',')).join(' ')} fill="none" stroke="#0b1220" strokeWidth={sw * 6} strokeLinejoin="round" strokeOpacity={0.6} />
          <polyline points={pathPts.map((p) => p.join(',')).join(' ')} fill="none" stroke={statusColor} strokeWidth={sw * 3} strokeLinejoin="round" strokeDasharray={`${sw * 8} ${sw * 4}`} />
          {pathPts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={sw * (i === 0 ? 6 : 4)} fill={i === 0 ? statusColor : '#fff'} stroke={statusColor} strokeWidth={sw * 2} />)}
        </g>}
        {evidenceBox && onPg(evidenceBox) && <rect x={evidenceBox.x0 - sw * 4} y={evidenceBox.y0 - sw * 4} width={evidenceBox.x1 - evidenceBox.x0 + sw * 8}
          height={evidenceBox.y1 - evidenceBox.y0 + sw * 8} fill="#22d3ee" fillOpacity={0.12} stroke="#22d3ee" strokeWidth={sw * 2.5}
          strokeDasharray={`${sw * 6} ${sw * 3}`} style={{ pointerEvents: 'none' }} />}
      </svg>

      <div className="absolute left-3 top-3 flex flex-wrap gap-1.5 rounded-md bg-navy-900/90 p-1.5 text-[11px] ring-1 ring-navy-700 backdrop-blur">
        {(Object.keys(layers) as (keyof typeof layers)[]).map((k) => (
          <button key={k} onClick={() => setLayers({ ...layers, [k]: !layers[k] })}
            className={`rounded px-2 py-0.5 capitalize ${layers[k] ? 'bg-navy-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>{k}</button>
        ))}
        <span className="mx-1 w-px bg-navy-700" />
        <button className="rounded px-2 py-0.5 text-slate-300 hover:bg-navy-700" onClick={() => setVb((v) => ({ x: v.x + v.w * 0.15, y: v.y + v.h * 0.15, w: v.w * 0.7, h: v.h * 0.7 }))}>＋</button>
        <button className="rounded px-2 py-0.5 text-slate-300 hover:bg-navy-700" onClick={() => setVb((v) => ({ x: v.x - v.w * 0.2, y: v.y - v.h * 0.2, w: v.w * 1.4, h: v.h * 1.4 }))}>－</button>
        <button className="rounded px-2 py-0.5 text-slate-300 hover:bg-navy-700" onClick={() => { initialised.current = ''; setSize({ ...size }) }}>Fit</button>
        {model.document.page_count > 1 && <>
          <span className="mx-1 w-px bg-navy-700" />
          <button disabled={page <= 0} className="rounded px-1.5 text-slate-300 hover:bg-navy-700 disabled:opacity-30" onClick={() => onPage(page - 1)}>‹</button>
          <select value={page} onChange={(e) => onPage(Number(e.target.value))} className="rounded bg-navy-800 px-1 text-slate-200">
            {Array.from({ length: model.document.page_count }, (_, i) => {
              const ds = model.decks.filter((d) => d.page === i)
              return <option key={i} value={i}>Sheet {i + 1}{ds.length ? ` · ${ds.map((d) => d.name.split(' (')[0]).join(', ').slice(0, 40)}` : ''}</option>
            })}
          </select>
          <button disabled={page >= model.document.page_count - 1} className="rounded px-1.5 text-slate-300 hover:bg-navy-700 disabled:opacity-30" onClick={() => onPage(page + 1)}>›</button>
        </>}
        {finding?.location && <button className="rounded px-2 py-0.5 text-sky-300 hover:bg-navy-700" onClick={() => fit(finding.location!, 0.8)}>Finding</button>}
      </div>
      <div className="pointer-events-none absolute bottom-2 left-3 rounded bg-navy-900/85 px-2 py-1 font-mono text-[10px] text-slate-400 ring-1 ring-navy-700">
        {hasDrawing ? `Sheet ${page + 1}/${model.document.page_count} · underlying image = original ${sourceType.toUpperCase()} rendering` : 'Structured JSON data - no drawing; polygons drawn from data'}
        {(pageDecks[0] ?? model.decks[0])?.scale && ` · 1 pt = ${((pageDecks[0] ?? model.decks[0]).scale!.metres_per_unit * 1000).toFixed(1)} mm`}
        {model.document.metadata?.pdf_mode === 'outlined_text_ocr' && ' · labels by OCR'}
      </div>
      <div className="pointer-events-none absolute bottom-2 right-3 flex gap-2 rounded bg-navy-900/85 px-2 py-1 text-[10px] text-slate-300 ring-1 ring-navy-700">
        {['corridor', 'stair', 'accommodation', 'machinery_space', 'open_deck'].map((k) => (
          <span key={k} className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: KIND_COLOR[k] }} />{k.replace('_', ' ')}</span>
        ))}
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-green-600" />escape point</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 border border-sky-500" />door</span>
      </div>
    </div>
  )
}
