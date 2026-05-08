import type { DragEvent } from 'react'
import { BLOCK_DEFINITIONS } from '../data/blockDefinitions'
import { BlockPreview } from './blockPreviews'
import './BlockPalette.css'

const DND_MIME = 'application/reactflow-plc'

export function BlockPalette() {
  const byCategory = BLOCK_DEFINITIONS.reduce<Record<string, typeof BLOCK_DEFINITIONS>>((acc, b) => {
    if (!acc[b.category]) acc[b.category] = []
    acc[b.category].push(b)
    return acc
  }, {})

  const onDragStart = (event: DragEvent, blockType: string) => {
    event.dataTransfer.setData(DND_MIME, blockType)
    event.dataTransfer.effectAllowed = 'copy'
  }

  return (
    <aside className="palette" aria-label="PLC blocks library">
      <div className="palette__header">
        <h2 className="palette__title">Blocks</h2>
        <p className="palette__hint">Drag onto the canvas</p>
      </div>
      <div className="palette__scroll">
        {Object.entries(byCategory).map(([category, blocks]) => (
          <section key={category} className="palette__section">
            <h3 className="palette__category">{category}</h3>
            <ul className="palette__list">
              {blocks.map((b) => (
                <li key={b.type}>
                  <button
                    type="button"
                    className="palette__card"
                    draggable
                    onDragStart={(e) => onDragStart(e, b.type)}
                    title={b.description}
                  >
                    <div className="palette__thumb" aria-hidden>
                      <BlockPreview blockType={b.type} />
                    </div>
                    <div className="palette__meta">
                      <span className="palette__name">{b.label}</span>
                      <span className="palette__desc">{b.description}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </aside>
  )
}

export { DND_MIME }
