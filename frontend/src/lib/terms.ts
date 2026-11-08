/**
 * Central terminology: every label an engineer reads comes from here.
 * Backend enum values are unchanged; this only maps them to plain engineering language.
 */
import type { ProvClass, ViewStatus } from './present'

/** Status wording. `label` is the full term; `short` fits list rows. Verified never means "compliant". */
export const STATUS_TERMS: Record<ViewStatus, { label: string; short: string; help: string }> = {
  issue: {
    label: 'Possible issue', short: 'Possible issue',
    help: 'The rules found a possible problem in the drawing. It needs an engineer to review it; it is not a confirmed violation.',
  },
  inconclusive: {
    label: 'Needs more information', short: 'Needs more info',
    help: 'The drawing does not contain enough information to decide. This is not a violation.',
  },
  verified: {
    label: 'Confirmed on available evidence', short: 'Confirmed',
    help: 'The condition holds on the evidence available in the drawing. This is not a statement of regulatory compliance.',
  },
  not_assessed: {
    label: 'Not checked', short: 'Not checked',
    help: 'No check was run for this item.',
  },
}

/** Inspector and panel headings. */
export const SECTION = {
  checkResults: 'Check results',
  whatWeFound: 'What we found',
  whyItMatters: 'Why it matters',
  whatToCheck: 'What to check next',
  evidence: 'What supports this finding',
  affectedArea: 'Affected area',
  infoNeeded: 'Information still needed',
  requirements: 'Applicable safety requirements',
  evidenceSource: 'Evidence source',
  technical: 'Technical details',
} as const

/** Where a piece of evidence came from, per backend provenance value. */
export const SOURCE_TERMS: Record<string, string> = {
  pdf_text: 'Text in drawing',
  pdf_vector_geometry: 'Found in drawing',
  ocr: 'Read from drawing (OCR)',
  derived_geometry: 'Calculated from drawing',
  llm_interpretation: 'AI-assisted interpretation',
  manual_annotation: 'Manual annotation',
  synthetic: 'Synthetic demonstration data',
}

/** Evidence classes, as shown in the evidence-source summary. */
export const SOURCE_CLASS_TERMS: Record<ProvClass, { label: string; help: string }> = {
  source: { label: 'Found in drawing', help: 'Read directly from the submitted drawing: text, line work or OCR.' },
  derived: { label: 'Calculated from drawing', help: 'Calculated from what the drawing shows: areas, which rooms touch, how rooms connect.' },
  manual: { label: 'Manual annotation', help: 'Added by a person to fill a gap in the drawing. Not engineer-validated.' },
  ai: { label: 'AI-assisted interpretation', help: 'Suggested by a language model. Never used as a fact read from the drawing.' },
  synthetic: { label: 'Synthetic demonstration data', help: 'Test data, not a real ship design.' },
}

/** Plain-language module names. */
export const MODULE_TERMS: Record<string, { label: string; short: string }> = {
  escape_route_connectivity: { label: 'Escape routes', short: 'Escape' },
  hazardous_space_accessibility: { label: 'Hazardous-space escape', short: 'Hazard' },
  fire_risk_proximity: { label: 'Fire separation', short: 'Fire' },
}
