import { getBlockDefinition } from '../data/blockDefinitions'
import type { BlockDefinition, DataType, PortDefinition } from '../types/plc'
import { mergeSettings, type SettingsRecord } from './blockSettings'

const DATA_TYPES: ReadonlySet<DataType> = new Set(['BOOL', 'INT', 'REAL', 'WORD', 'TIME'])

const PRETTY_JSON_MAX = 4000

export type PortSpecJsonAnalysis = {
  /** JSON parses to a value */
  syntaxOk: boolean
  syntaxError?: string
  /** Parsed root is an array */
  isArray: boolean
  /** Ports kept after validation (same rules as `parsePortArray`) */
  validPorts: PortDefinition[]
  /** Array entries that did not become a port (wrong shape / bad type) */
  skippedEntries: number
  /** Pretty-printed JSON when `syntaxOk` (trimmed for UI caps) */
  formattedJson: string | null
}

/**
 * Inspect port JSON for tooltips, live hints, and pretty-printing (does not apply fallback ports).
 */
export function analyzePortSpecJson(raw: string): PortSpecJsonAnalysis {
  const trimmed = raw.trim()
  if (!trimmed) {
    return {
      syntaxOk: false,
      syntaxError: 'Empty — defaults apply after Apply.',
      isArray: false,
      validPorts: [],
      skippedEntries: 0,
      formattedJson: null,
    }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Invalid JSON'
    return {
      syntaxOk: false,
      syntaxError: msg,
      isArray: false,
      validPorts: [],
      skippedEntries: 0,
      formattedJson: null,
    }
  }
  if (!Array.isArray(parsed)) {
    return {
      syntaxOk: true,
      isArray: false,
      validPorts: [],
      skippedEntries: 0,
      formattedJson: null,
    }
  }

  const out: PortDefinition[] = []
  let skipped = 0
  for (const item of parsed) {
    if (!item || typeof item !== 'object') {
      skipped += 1
      continue
    }
    const o = item as Record<string, unknown>
    const rawId = typeof o.id === 'string' ? o.id : `p${out.length}`
    const id = rawId.replace(/[^a-zA-Z0-9_]/g, '') || `p${out.length}`
    const label = typeof o.label === 'string' ? o.label : id
    const t = String(o.type ?? 'BOOL').toUpperCase()
    if (!DATA_TYPES.has(t as DataType)) {
      skipped += 1
      continue
    }
    const hint = typeof o.hint === 'string' ? o.hint : undefined
    out.push({ id, label, type: t as DataType, hint })
  }

  const formattedJson = (() => {
    try {
      const pretty = JSON.stringify(parsed, null, 2)
      return pretty.length > PRETTY_JSON_MAX ? `${pretty.slice(0, PRETTY_JSON_MAX)}\n…` : pretty
    } catch {
      return null
    }
  })()

  return {
    syntaxOk: true,
    isArray: true,
    validPorts: out,
    skippedEntries: skipped,
    formattedJson,
  }
}

export function parsePortArray(raw: string, fallback: PortDefinition[]): PortDefinition[] {
  const a = analyzePortSpecJson(raw)
  if (!a.syntaxOk || !a.isArray) return fallback
  return a.validPorts.length ? a.validPorts : fallback
}

export function getEffectiveBlockPorts(
  blockType: string,
  settings?: Partial<SettingsRecord>,
): { inputs: PortDefinition[]; outputs: PortDefinition[] } {
  const def = getBlockDefinition(blockType)
  if (!def) return { inputs: [], outputs: [] }
  if (!usesPortSpecSettings(blockType)) return { inputs: def.inputs, outputs: def.outputs }
  const merged = mergeSettings(def, settings)
  return {
    inputs: parsePortArray(String(merged.inputsSpec ?? ''), def.inputs),
    outputs: parsePortArray(String(merged.outputsSpec ?? ''), def.outputs),
  }
}

export function usesPortSpecSettings(blockType: string): boolean {
  return blockType === 'CODE' || blockType === 'SHEET'
}

/** Compact lines for `fullHoverHint` / plain-text summaries (no raw JSON blobs). */
export function formatCodeBlockSettingsSummaryLines(
  def: BlockDefinition,
  settings: SettingsRecord,
): string[] {
  const merged = mergeSettings(def, settings)
  const { inputs, outputs } = getEffectiveBlockPorts('CODE', merged)
  const inRaw = String(merged.inputsSpec ?? '')
  const outRaw = String(merged.outputsSpec ?? '')
  const code = String(merged.code ?? '')
  const inA = analyzePortSpecJson(inRaw)
  const outA = analyzePortSpecJson(outRaw)

  const portLine = (ports: PortDefinition[]) =>
    ports.length ? ports.map((p) => `${p.id}·${p.type}`).join(', ') : 'defaults'

  const jsonStatus = (a: PortSpecJsonAnalysis) => {
    if (!a.syntaxOk) return a.syntaxError ?? 'Invalid'
    if (!a.isArray) return 'root must be a JSON array'
    const bits = [`${a.validPorts.length} port(s)`]
    if (a.skippedEntries) bits.push(`${a.skippedEntries} skipped`)
    return bits.join(', ')
  }

  const codeTrim = code.trim()
  const lineCount = codeTrim ? codeTrim.split(/\r?\n/).length : 0

  return [
    `Inputs (canvas): ${portLine(inputs)}`,
    `  JSON: ${jsonStatus(inA)}`,
    `Outputs (canvas): ${portLine(outputs)}`,
    `  JSON: ${jsonStatus(outA)}`,
    `C++ body: ${lineCount} line(s)`,
  ]
}

export function formatPortSpecBlockSettingsSummaryLines(
  blockType: string,
  def: BlockDefinition,
  settings: SettingsRecord,
): string[] {
  const merged = mergeSettings(def, settings)
  const { inputs, outputs } = getEffectiveBlockPorts(blockType, merged)
  const inRaw = String(merged.inputsSpec ?? '')
  const outRaw = String(merged.outputsSpec ?? '')
  const inA = analyzePortSpecJson(inRaw)
  const outA = analyzePortSpecJson(outRaw)

  const portLine = (ports: PortDefinition[]) =>
    ports.length ? ports.map((p) => `${p.id}·${p.type}`).join(', ') : 'defaults'

  const jsonStatus = (a: PortSpecJsonAnalysis) => {
    if (!a.syntaxOk) return a.syntaxError ?? 'Invalid'
    if (!a.isArray) return 'root must be a JSON array'
    const bits = [`${a.validPorts.length} port(s)`]
    if (a.skippedEntries) bits.push(`${a.skippedEntries} skipped`)
    return bits.join(', ')
  }

  const lines = [
    `Inputs (canvas): ${portLine(inputs)}`,
    `  JSON: ${jsonStatus(inA)}`,
    `Outputs (canvas): ${portLine(outputs)}`,
    `  JSON: ${jsonStatus(outA)}`,
  ]

  if (blockType === 'SHEET') {
    lines.unshift(`Target sheet: ${String(merged.sheetId ?? '') || '(unset)'}`)
  }
  return lines
}

export type PortSpecLiveStatus = {
  tone: 'ok' | 'warn' | 'err'
  headline: string
  detail?: string
}

/** One-line status + optional detail for settings UI under JSON textareas. */
export function portSpecLiveStatus(raw: string): PortSpecLiveStatus {
  const a = analyzePortSpecJson(raw)
  if (!a.syntaxOk) {
    return {
      tone: 'err',
      headline: 'Invalid JSON',
      detail: a.syntaxError,
    }
  }
  if (!a.isArray) {
    return {
      tone: 'err',
      headline: 'Must be a JSON array',
      detail: 'Example: [{"id":"in0","label":"IN0","type":"BOOL"}]',
    }
  }
  if (a.validPorts.length === 0) {
    return {
      tone: 'warn',
      headline: 'No valid ports in this array',
      detail:
        'Check id / type (BOOL, INT, REAL, WORD, TIME). Until fixed, defaults apply after Apply.',
    }
  }
  const bits = [`${a.validPorts.length} port(s)`]
  if (a.skippedEntries) bits.push(`${a.skippedEntries} skipped`)
  return {
    tone: 'ok',
    headline: bits.join(' · '),
    detail: a.validPorts.map((p) => `${p.id} · ${p.type}`).join(', '),
  }
}
