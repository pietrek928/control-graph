/** Wire / signal types used for connection validation */
export type DataType = 'BOOL' | 'INT' | 'REAL' | 'WORD' | 'TIME'

export interface PortDefinition {
  id: string
  label: string
  type: DataType
  /** Tooltip when hovering the port (defaults to "label · TYPE") */
  hint?: string
}

export type SettingFieldType = 'number' | 'text' | 'checkbox' | 'textarea'

export interface SettingFieldDef {
  key: string
  label: string
  type: SettingFieldType
  default: string | number | boolean
  min?: number
  max?: number
  step?: number
  /** Used when `type` is `textarea` */
  rows?: number
}

export interface BlockDefinition {
  type: string
  label: string
  category: string
  description: string
  /** Tooltip when hovering the block symbol (defaults to description) */
  symbolHint?: string
  /** Editable parameters (double-click); shown on hover summary */
  settingsFields?: SettingFieldDef[]
  inputs: PortDefinition[]
  outputs: PortDefinition[]
}
