import type { BlockDefinition } from '../types/plc'
import { getBlockDefinition } from '../data/blockDefinitions'
import {
  formatCodeBlockSettingsSummaryLines,
  formatPortSpecBlockSettingsSummaryLines,
} from './codeBlockPorts'
import { resolveSymbolHint } from './portHints'

export type SettingsRecord = Record<string, string | number | boolean>

export function defaultSettingsFromFields(def: BlockDefinition): SettingsRecord {
  if (!def.settingsFields?.length) return {}
  return Object.fromEntries(def.settingsFields.map((f) => [f.key, f.default])) as SettingsRecord
}

export function defaultSettingsForBlock(blockType: string): SettingsRecord {
  const def = getBlockDefinition(blockType)
  if (!def) return {}
  return defaultSettingsFromFields(def)
}

export function mergeSettings(def: BlockDefinition, partial?: Partial<SettingsRecord>): SettingsRecord {
  const base = defaultSettingsFromFields(def)
  if (!partial) return base
  const next = { ...base }
  for (const key of Object.keys(partial)) {
    const v = partial[key]
    if (v !== undefined) next[key] = v
  }
  return next
}

/** Lines for hover tooltip / modal subtitle */
export function formatSettingsSummary(def: BlockDefinition, settings: SettingsRecord): string[] {
  if (!def.settingsFields?.length) return []
  if (def.type === 'CODE') {
    return formatCodeBlockSettingsSummaryLines(def, settings)
  }
  if (def.type === 'SHEET') {
    return formatPortSpecBlockSettingsSummaryLines(def.type, def, settings)
  }
  return def.settingsFields.map((f) => {
    const v = settings[f.key] ?? f.default
    if (f.type === 'textarea') {
      const s = String(v).replace(/\s+/g, ' ').trim()
      const short = s.length > 72 ? `${s.slice(0, 72)}…` : s
      return `${f.label}: ${short}`
    }
    return `${f.label}: ${String(v)}`
  })
}

export function fullHoverHint(blockType: string, settings?: Partial<SettingsRecord>): string {
  const def = getBlockDefinition(blockType)
  if (!def) return blockType
  const merged = mergeSettings(def, settings)
  const head = resolveSymbolHint(def)
  const lines = formatSettingsSummary(def, merged)
  if (!lines.length) return head
  return [head, ...lines].join('\n')
}
