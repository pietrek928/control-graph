import type { Node, XYPosition } from '@xyflow/react'
import { useInternalNode, useReactFlow, useStore } from '@xyflow/react'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { getBlockDefinition } from '../data/blockDefinitions'
import { analyzePortSpecJson, portSpecLiveStatus } from '../utils/codeBlockPorts'
import { type SettingsRecord, mergeSettings } from '../utils/blockSettings'
import type { FlowNodeData } from '../utils/connectionValidation'
import type { PlcNodeData } from './PLCBlockNode'
import './BlockSettingsModal.css'

const PANEL_W = 280
const PANEL_W_CODE = 520
const PANEL_MAX_H = 420
const PANEL_MAX_H_CODE = 560
const GAP = 10
const NODE_FALLBACK_W = 112

type Props = {
  nodeId: string | null
  nodes: Node<FlowNodeData>[]
  onClose: () => void
  onApply: (nodeId: string, settings: SettingsRecord) => void
}

function clampPanelToViewport(
  flowToScreenPosition: (p: XYPosition) => XYPosition,
  abs: XYPosition,
  nw: number,
  panelWidth: number,
  panelMaxHeight: number,
): { left: number; top: number; anchor: 'right' | 'left' } {
  const vw = window.innerWidth
  const vh = window.innerHeight

  const screenTopLeft = flowToScreenPosition(abs)
  const screenTopRight = flowToScreenPosition({ x: abs.x + nw, y: abs.y })

  let anchor: 'right' | 'left' = 'right'
  let left = screenTopRight.x + GAP

  if (left + panelWidth > vw - 12) {
    left = screenTopLeft.x - panelWidth - GAP
    anchor = 'left'
  }

  left = Math.max(12, Math.min(left, vw - panelWidth - 12))

  let top = screenTopLeft.y
  top = Math.max(12, Math.min(top, vh - Math.min(panelMaxHeight, vh - 24)))

  return { left, top, anchor }
}

function PortJsonLiveHint({
  raw,
  showFormattedPreview = true,
}: {
  raw: string
  showFormattedPreview?: boolean
}) {
  const status = useMemo(() => portSpecLiveStatus(raw), [raw])
  const parsed = useMemo(() => analyzePortSpecJson(raw), [raw])

  return (
    <div
      className={`settings-modal__json-live settings-modal__json-live--${status.tone}`}
      role="status"
    >
      <div className="settings-modal__json-live__row">
        <span className="settings-modal__json-live__head">{status.headline}</span>
      </div>
      {status.detail ? (
        <p className="settings-modal__json-live__detail">{status.detail}</p>
      ) : null}
      {showFormattedPreview &&
      parsed.formattedJson &&
      parsed.syntaxOk &&
      parsed.isArray ? (
        <pre className="settings-modal__json-live__pre" aria-label="Formatted JSON preview">
          {parsed.formattedJson}
        </pre>
      ) : null}
    </div>
  )
}

function PortJsonSummaryStrip({ raw }: { raw: string }) {
  const status = useMemo(() => portSpecLiveStatus(raw), [raw])
  const sub = status.detail
    ? status.detail.length > 96
      ? `${status.detail.slice(0, 96)}…`
      : status.detail
    : null
  return (
    <div
      className={`settings-modal__json-summary settings-modal__json-summary--${status.tone}`}
      role="status"
    >
      <span className="settings-modal__json-summary__main">{status.headline}</span>
      {sub ? <span className="settings-modal__json-summary__sub">{sub}</span> : null}
    </div>
  )
}

export function BlockSettingsModal({ nodeId, nodes, onClose, onApply }: Props) {
  const { flowToScreenPosition, getNode } = useReactFlow()
  const internal = useInternalNode(nodeId ?? '')
  const viewportKey = useStore((s) => s.transform.join(','))

  const node = nodeId ? nodes.find((n) => n.id === nodeId) : undefined
  const plc =
    node?.type === 'plcBlock' ? (node.data as PlcNodeData) : undefined
  const def = plc ? getBlockDefinition(plc.blockType) : undefined
  const fields = def?.settingsFields

  const [openJsonField, setOpenJsonField] = useState<null | 'inputsSpec' | 'outputsSpec'>(null)

  const [draft, setDraft] = useState<SettingsRecord>(() => {
    if (!nodeId) return {}
    const n = nodes.find((x) => x.id === nodeId)
    if (!n || n.type !== 'plcBlock') return {}
    const plcData = n.data as PlcNodeData
    const d = getBlockDefinition(plcData.blockType)
    if (!d?.settingsFields?.length) return {}
    return mergeSettings(d, plcData.settings)
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  let shellLayout: {
    style: { left: number; top: number; width: number; maxHeight: number }
    anchor: 'right' | 'left'
  } | null = null
  const panelW = plc?.blockType === 'CODE' ? PANEL_W_CODE : PANEL_W
  const panelMaxBody = plc?.blockType === 'CODE' ? PANEL_MAX_H_CODE : PANEL_MAX_H

  if (nodeId && node && fields?.length) {
    void viewportKey
    const gn = getNode(nodeId)
    if (gn) {
      const abs = internal?.internals.positionAbsolute ?? gn.position
      const nw = internal?.measured.width ?? NODE_FALLBACK_W
      const { left, top, anchor } = clampPanelToViewport(
        flowToScreenPosition,
        abs,
        nw,
        panelW,
        panelMaxBody,
      )
      shellLayout = {
        style: {
          left,
          top,
          width: panelW,
          maxHeight: Math.min(
            panelMaxBody,
            typeof window !== 'undefined' ? window.innerHeight - top - 16 : panelMaxBody,
          ),
        },
        anchor,
      }
    }
  }

  if (!nodeId || !node || !def || !fields?.length || !shellLayout) {
    return null
  }

  const update = (key: string, value: string | number | boolean) => {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    onApply(nodeId, draft)
    onClose()
  }

  const nodeTitle = plc?.label ?? def.label
  const shortId = node.id.length > 14 ? `…${node.id.slice(-10)}` : node.id

  return (
    <div
      className={`settings-modal-shell anchor--${shellLayout.anchor}`}
      style={shellLayout.style}
      role="presentation"
    >
      <div
        className="settings-modal"
        role="dialog"
        aria-labelledby="settings-modal-title"
        aria-modal="true"
      >
        <header className="settings-modal__head">
          <div className="settings-modal__title-row">
            <h2 id="settings-modal-title">{def.label}</h2>
            <button
              type="button"
              className="settings-modal__close"
              aria-label="Close"
              onClick={onClose}
            >
              ×
            </button>
          </div>
          <p className="settings-modal__node-pin" title={node.id}>
            <strong>{nodeTitle}</strong>
            {' · '}
            <span className="settings-modal__node-id">{shortId}</span>
          </p>
          <p className="settings-modal__sub">{def.description}</p>
        </header>
        <form className="settings-modal__form" onSubmit={handleSubmit}>
          {fields.map((field) => {
            const isCodeJsonPortSpec =
              plc?.blockType === 'CODE' &&
              field.type === 'textarea' &&
              (field.key === 'inputsSpec' || field.key === 'outputsSpec')

            if (isCodeJsonPortSpec) {
              const raw = String(draft[field.key] ?? field.default ?? '')
              const jsonKey = field.key as 'inputsSpec' | 'outputsSpec'
              const jsonOpen = openJsonField === jsonKey
              return (
                <div
                  key={field.key}
                  className="settings-modal__field settings-modal__field--code-json"
                >
                  <div className="settings-modal__json-field-head">
                    <span className="settings-modal__label" id={`code-json-label-${field.key}`}>
                      {field.label}
                    </span>
                    <button
                      type="button"
                      className="settings-modal__json-edit-btn"
                      aria-expanded={jsonOpen}
                      aria-controls={`code-json-${field.key}`}
                      onClick={() => setOpenJsonField((k) => (k === jsonKey ? null : jsonKey))}
                    >
                      {jsonOpen ? 'Close' : 'Edit'}
                    </button>
                  </div>
                  {!jsonOpen ? (
                    <PortJsonSummaryStrip raw={raw} />
                  ) : (
                    <>
                      <textarea
                        id={`code-json-${field.key}`}
                        name={field.key}
                        className="settings-modal__textarea"
                        rows={field.rows ?? 8}
                        spellCheck={false}
                        aria-labelledby={`code-json-label-${field.key}`}
                        value={raw}
                        onChange={(e) => update(field.key, e.target.value)}
                      />
                      <PortJsonLiveHint raw={raw} showFormattedPreview />
                    </>
                  )}
                </div>
              )
            }

            return (
              <label key={field.key} className="settings-modal__field">
                <span className="settings-modal__label">{field.label}</span>
                {field.type === 'checkbox' ? (
                  <input
                    type="checkbox"
                    checked={Boolean(draft[field.key] ?? field.default)}
                    onChange={(e) => update(field.key, e.target.checked)}
                  />
                ) : field.type === 'textarea' ? (
                  <textarea
                    name={field.key}
                    className="settings-modal__textarea"
                    rows={field.rows ?? 8}
                    spellCheck={false}
                    value={String(draft[field.key] ?? field.default ?? '')}
                    onChange={(e) => update(field.key, e.target.value)}
                  />
                ) : (
                  <input
                    type={field.type === 'number' ? 'number' : 'text'}
                    name={field.key}
                    value={
                      field.type === 'number'
                        ? String(draft[field.key] ?? field.default ?? '')
                        : String(draft[field.key] ?? field.default ?? '')
                    }
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    onChange={(e) => {
                      if (field.type === 'number') {
                        const n = parseFloat(e.target.value)
                        update(field.key, Number.isFinite(n) ? n : (field.default as number))
                        return
                      }
                      update(field.key, e.target.value)
                    }}
                  />
                )}
              </label>
            )
          })}
          <div className="settings-modal__actions">
            <button type="button" className="settings-modal__btn secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="settings-modal__btn primary">
              Apply
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
