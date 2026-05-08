import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { memo, useMemo, useState } from 'react'
import { getBlockDefinition } from '../data/blockDefinitions'
import {
  getEffectiveBlockPorts,
  portSpecLiveStatus,
} from '../utils/codeBlockPorts'
import { mergeSettings, type SettingsRecord } from '../utils/blockSettings'
import { resolvePortHint, resolveSymbolHint } from '../utils/portHints'
import type { PortDefinition } from '../types/plc'
import { BlockPreview } from './blockPreviews'
import './PLCBlockNode.css'

export type PlcNodeData = {
  blockType: string
  label?: string
  settings?: Partial<SettingsRecord>
}

function formatPortChips(ports: PortDefinition[]): string {
  if (!ports.length) return 'defaults'
  return ports.map((p) => `${p.id} ${p.type}`).join(' · ')
}

function CodeBlockHoverFlyout({
  symbolHint,
  mergedSettings,
  effectiveIn,
  effectiveOut,
}: {
  symbolHint: string
  mergedSettings: SettingsRecord
  effectiveIn: PortDefinition[]
  effectiveOut: PortDefinition[]
}) {
  const inRaw = String(mergedSettings.inputsSpec ?? '')
  const outRaw = String(mergedSettings.outputsSpec ?? '')
  const codeRaw = String(mergedSettings.code ?? '')

  const inLive = useMemo(() => portSpecLiveStatus(inRaw), [inRaw])
  const outLive = useMemo(() => portSpecLiveStatus(outRaw), [outRaw])

  const codeLines = codeRaw.split(/\r?\n/)
  const codePreview = codeLines.slice(0, 8).join('\n')
  const codeMore = codeLines.length > 8

  return (
    <div className="plc-node__settings-flyout plc-node__settings-flyout--code" role="tooltip">
      <p className="plc-node__settings-flyout-hint">{symbolHint}</p>

      <div className="plc-code-flyout__block">
        <div className="plc-code-flyout__head">
          <span className="plc-code-flyout__title">Inputs (canvas)</span>
          <span className="plc-code-flyout__muted">{formatPortChips(effectiveIn)}</span>
        </div>
        <div className="plc-code-flyout__sub">
          <span className="plc-code-flyout__kbd">inputsSpec</span>
          <span className={`plc-code-flyout__pill plc-code-flyout__pill--${inLive.tone}`}>
            {inLive.headline}
          </span>
        </div>
        {inLive.detail ? <p className="plc-code-flyout__detail">{inLive.detail}</p> : null}
      </div>

      <div className="plc-code-flyout__block">
        <div className="plc-code-flyout__head">
          <span className="plc-code-flyout__title">Outputs (canvas)</span>
          <span className="plc-code-flyout__muted">{formatPortChips(effectiveOut)}</span>
        </div>
        <div className="plc-code-flyout__sub">
          <span className="plc-code-flyout__kbd">outputsSpec</span>
          <span className={`plc-code-flyout__pill plc-code-flyout__pill--${outLive.tone}`}>
            {outLive.headline}
          </span>
        </div>
        {outLive.detail ? <p className="plc-code-flyout__detail">{outLive.detail}</p> : null}
      </div>

      <div className="plc-code-flyout__block">
        <div className="plc-code-flyout__head">
          <span className="plc-code-flyout__title">C++ body</span>
          <span className="plc-code-flyout__muted">
            {codeLines.length ? `${codeLines.length} line(s)` : 'empty'}
          </span>
        </div>
        {codePreview ? (
          <pre className="plc-node__code-cpp-pre" tabIndex={-1}>
            {codePreview}
            {codeMore ? '\n…' : ''}
          </pre>
        ) : null}
      </div>
    </div>
  )
}

function PLCBlockNodeInner(props: NodeProps<Node<PlcNodeData, 'plcBlock'>>) {
  const { data, dragging } = props
  const def = getBlockDefinition(data.blockType)
  const title = data.label ?? def?.label ?? data.blockType
  const [hover, setHover] = useState(false)

  const mergedSettings = useMemo(() => {
    if (!def) return {} as SettingsRecord
    return mergeSettings(def, data.settings)
  }, [def, data.settings])

  if (!def) {
    return (
      <div className="plc-node plc-node--unknown" title={`Unknown block: ${title}`}>
        <span className="plc-node__unknown-mark">?</span>
      </div>
    )
  }

  const symbolOnlyHint = resolveSymbolHint(def)
  const { inputs: portIn, outputs: portOut } = getEffectiveBlockPorts(data.blockType, data.settings)

  return (
    <div className="plc-node plc-node--compact">
      <div
        className="plc-node__body"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        <div
          className="plc-node__graphic"
          title={def.settingsFields?.length ? undefined : resolveSymbolHint(def)}
        >
          <BlockPreview blockType={data.blockType} variant="node" />
        </div>

        {hover && !dragging && def.settingsFields?.length ? (
          data.blockType === 'CODE' ? (
            <CodeBlockHoverFlyout
              symbolHint={symbolOnlyHint}
              mergedSettings={mergedSettings}
              effectiveIn={portIn}
              effectiveOut={portOut}
            />
          ) : (
            <div className="plc-node__settings-flyout" role="tooltip">
              <p className="plc-node__settings-flyout-hint">{symbolOnlyHint}</p>
              <ul className="plc-node__settings-flyout-list">
                {def.settingsFields.map((f) => (
                  <li key={f.key}>
                    {f.label}: {String(mergedSettings[f.key] ?? f.default)}
                  </li>
                ))}
              </ul>
            </div>
          )
        ) : null}

        <ul className="plc-node__handles plc-node__handles--in">
          {portIn.map((p) => (
            <li key={p.id} className="plc-port-slot" title={resolvePortHint(p)}>
              <Handle
                type="target"
                position={Position.Left}
                id={`in:${p.id}`}
                className="plc-handle plc-handle--in"
                isConnectable
              />
            </li>
          ))}
        </ul>

        <ul className="plc-node__handles plc-node__handles--out">
          {portOut.map((p) => (
            <li key={p.id} className="plc-port-slot" title={resolvePortHint(p)}>
              <Handle
                type="source"
                position={Position.Right}
                id={`out:${p.id}`}
                className="plc-handle plc-handle--out"
                isConnectable
              />
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export const PLCBlockNode = memo(PLCBlockNodeInner)
