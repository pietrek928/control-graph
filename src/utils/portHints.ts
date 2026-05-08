import type { BlockDefinition, PortDefinition } from '../types/plc'

/** Default hover text for a port when `hint` is omitted in block config */
export function defaultPortHint(port: PortDefinition): string {
  return `${port.label} · ${port.type}`
}

export function resolvePortHint(port: PortDefinition): string {
  return port.hint ?? defaultPortHint(port)
}

export function resolveSymbolHint(def: BlockDefinition): string {
  return def.symbolHint ?? def.description
}
