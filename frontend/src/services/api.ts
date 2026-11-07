import type {
  Clause, ClauseHit, ComplianceResult, RegulatoryEvaluation,
  AnalysisSummary, DesignSummary, EngineeringModel, Finding, FindingDetail, GraphData, Requirement, Scenario, SystemStatus,
} from '../types'

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`
    try { msg = (await r.json()).detail ?? msg } catch { /* not json */ }
    throw new Error(msg)
  }
  return r.json() as Promise<T>
}

const q = (o: Record<string, string | null | undefined | boolean>) =>
  new URLSearchParams(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => [k, String(v)])).toString()

export const api = {
  status: () => fetch('/api/status').then(j<SystemStatus>),
  designs: () => fetch('/api/designs').then(j<DesignSummary[]>),
  design: (id: string) => fetch(`/api/designs/${id}`).then(j<DesignSummary>),
  scenarios: () => fetch('/api/scenarios').then(j<Scenario[]>),
  upload: (file: File) => {
    const fd = new FormData(); fd.append('file', file)
    return fetch('/api/upload/design', { method: 'POST', body: fd }).then(j<DesignSummary>)
  },
  fetchDanaV: () => fetch('/api/upload/fetch-dana-v', { method: 'POST' }).then(j<DesignSummary>),
  summary: (design_id: string, scenario?: string | null) => fetch(`/api/analysis/summary?${q({ design_id, scenario })}`).then(j<AnalysisSummary>),
  elements: (design_id: string, scenario?: string | null) => fetch(`/api/design/elements?${q({ design_id, scenario })}`).then(j<EngineeringModel>),
  graph: (design_id: string, scenario?: string | null) => fetch(`/api/design/graph?${q({ design_id, scenario })}`).then(j<GraphData>),
  findings: (design_id: string, scenario?: string | null) => fetch(`/api/findings?${q({ design_id, scenario })}`).then(j<Finding[]>),
  finding: (id: string, design_id: string, scenario?: string | null, explain = false) =>
    fetch(`/api/findings/${id}?${q({ design_id, scenario, explain: explain || null })}`).then(j<FindingDetail>),
  requirements: () => fetch('/api/requirements').then(j<Requirement[]>),
  importRequirements: (file: File, source_name: string) => {
    const fd = new FormData(); fd.append('file', file); fd.append('source_name', source_name)
    return fetch('/api/requirements/import', { method: 'POST', body: fd }).then(j<{ imported: number }>)
  },
  regEvaluate: (design_id: string, scenario: string | null, demo: boolean) =>
    fetch(`/api/regulatory/evaluate?${q({ design_id, scenario, demo: demo || null })}`).then(j<RegulatoryEvaluation>),
  regClause: (id: string) => fetch(`/api/regulatory/clauses/${id}`).then(j<{ clause: Clause; document: { title: string; url: string; completeness: string; edition: string; licence: string } }>),
  regSearch: (q_: string) => fetch(`/api/regulatory/search?${q({ q: q_ })}`).then(j<ClauseHit[]>),
  regRelated: (design_id: string, finding_id: string, scenario: string | null) =>
    fetch(`/api/regulatory/related?${q({ design_id, finding_id, scenario })}`).then(j<{ results: ComplianceResult[]; clauses: ClauseHit[]; query: string }>),
  regValidate: (spec_id: string, validated_by: string, status = 'engineer_validated') =>
    fetch(`/api/regulatory/specs/${spec_id}/validate`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ validated_by, status }) }).then(j<unknown>),
  regPutProfile: (design_id: string, values: Record<string, unknown>) =>
    fetch(`/api/regulatory/vessel-profile?${q({ design_id })}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) }).then(j<unknown>),
  pageUrl: (design_id: string, page: number, zoom: number, clip?: [number, number, number, number]) =>
    `/api/design/pages/${page}?${q({ design_id, zoom: zoom.toFixed(3), clip: clip ? clip.map((v) => v.toFixed(1)).join(',') : null })}`,
}
