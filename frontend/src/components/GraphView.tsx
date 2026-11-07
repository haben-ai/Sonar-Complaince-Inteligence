import { useMemo } from 'react'
import type { EngineeringModel, Finding, GraphData } from '../types'
import { KIND_COLOR, STATUS_META } from './ui'

/** Escape-route graph laid out by ship geometry: x = position along the ship, one lane per deck. */
export default function GraphView({ graph, model, finding, onSelectNode }: {
  graph: GraphData; model: EngineeringModel; finding: Finding | null; onSelectNode: (id: string) => void
}) {
  const layout = useMemo(() => {
    const decks = [...model.decks].sort((a, b) => (b.elevation_mm ?? -1) - (a.elevation_mm ?? -1))
    const lane = new Map(decks.map((d, i) => [d.id, i]))
    const LANE = 150
    const spaces = new Map(model.spaces.map((s) => [s.id, s]))
    const esc = new Map(model.escape_points.map((e) => [e.id, e]))
    const xs = model.spaces.map((s) => s.anchor?.[0] ?? 0)
    const minX = Math.min(...xs), maxX = Math.max(...xs)
    const sx = 1400 / Math.max(maxX - minX, 1)
    const pos = new Map<string, [number, number]>()
    for (const n of graph.nodes) {
      const deckId = n.deck
      const d = model.decks.find((k) => k.id === deckId)
      const s = spaces.get(n.id)
      const e = esc.get(n.id)
      const a = s?.anchor ?? (e?.bbox ? [(e.bbox.x0 + e.bbox.x1) / 2, (e.bbox.y0 + e.bbox.y1) / 2] : null)
      if (!a || !d) continue
      const yOff = d.centerline_y != null ? (a[1] - d.centerline_y) * 0.38 : (a[1] - (d.bbox.y0 + d.bbox.y1) / 2) * 0.38
      pos.set(n.id, [40 + (a[0] - minX) * sx + (e ? 10 : 0), 60 + (lane.get(deckId) ?? 0) * LANE + yOff + (e ? -14 : 0)])
    }
    return { decks, LANE, pos, height: 60 + decks.length * LANE }
  }, [graph, model])

  const connected = useMemo(() => {
    const deg = new Map<string, number>()
    graph.edges.forEach((e) => { deg.set(e.source, (deg.get(e.source) ?? 0) + 1); deg.set(e.target, (deg.get(e.target) ?? 0) + 1) })
    return deg
  }, [graph])

  const hl = new Set(finding ? [...finding.affected_ids, ...finding.highlight_ids, ...finding.highlight_path] : [])
  const pathEdges = new Set<string>()
  finding?.highlight_path.forEach((n, i, arr) => { if (i) { pathEdges.add(arr[i - 1] + '|' + n); pathEdges.add(n + '|' + arr[i - 1]) } })
  const col = finding ? STATUS_META[finding.status].hex : '#38bdf8'

  return (
    <div className="h-full overflow-auto bg-[#0b1220] p-2">
      <svg width={1500} height={layout.height} className="text-[10px]">
        {layout.decks.map((d, i) => <g key={d.id}>
          <rect x={0} y={60 + i * layout.LANE - layout.LANE / 2 + 8} width={1500} height={layout.LANE - 16} fill={i % 2 ? '#0e1a2e' : '#0c1627'} />
          <text x={6} y={60 + i * layout.LANE - layout.LANE / 2 + 22} fill="#5d7aa6" fontSize={11} fontWeight={600}>{d.name} {d.elevation_label ? `· ${d.elevation_label}` : ''}</text>
        </g>)}
        {graph.edges.map((e, i) => {
          const a = layout.pos.get(e.source), b = layout.pos.get(e.target)
          if (!a || !b) return null
          const onPath = pathEdges.has(e.source + '|' + e.target)
          return <line key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]}
            stroke={onPath ? col : e.type === 'vertical_stair' ? '#e879f9' : e.type === 'escape_access' ? '#22c55e' : '#3b5b8a'}
            strokeWidth={onPath ? 3 : 1.2} strokeDasharray={e.certainty === 'inferred' || e.certainty === 'manual' ? '4 3' : undefined} opacity={finding && !onPath ? 0.45 : 0.9} />
        })}
        {graph.nodes.map((n) => {
          const p = layout.pos.get(n.id)
          if (!p || (!connected.get(n.id) && !hl.has(n.id))) return null
          const isEsc = n.node_type === 'escape_point'
          const on = hl.has(n.id)
          return <g key={n.id} onClick={() => onSelectNode(n.id)} className="cursor-pointer">
            {isEsc ? <rect x={p[0] - 6} y={p[1] - 6} width={12} height={12} fill="#16a34a" stroke="#fff" strokeWidth={1} transform={`rotate(45 ${p[0]} ${p[1]})`} />
              : <circle cx={p[0]} cy={p[1]} r={on ? 7 : 4.5} fill={KIND_COLOR[n.kind] ?? '#64748b'} stroke={on ? col : '#0b1220'} strokeWidth={on ? 3 : 1} />}
            <title>{`${n.id} · ${n.name ?? n.kind}`}</title>
            {(on || n.kind === 'stair' || isEsc) && <text x={p[0] + 8} y={p[1] - 6} fill={on ? '#fff' : '#8aa3c7'} fontSize={9.5}>{n.name ?? n.kind}</text>}
          </g>
        })}
      </svg>
      <div className="mt-1 px-2 text-[10px] text-slate-500">Nodes positioned from extracted geometry (longitudinal position, deck lane). Dashed edges are inferred (stair matching) or manual links. Isolated nodes are hidden unless part of the selected finding.</div>
    </div>
  )
}
