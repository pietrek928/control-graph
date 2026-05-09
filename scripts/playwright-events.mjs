#!/usr/bin/env node

import { chromium, firefox, webkit } from 'playwright'
import process from 'node:process'

function parseArgs(argv) {
  const args = {
    url: 'http://127.0.0.1:5173',
    browser: 'chromium',
    headless: true,
    timeoutMs: 30000,
    eventsJson: null,
    eventsFile: null,
    screenshotPath: null,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--url') args.url = argv[++i]
    else if (token === '--browser') args.browser = argv[++i]
    else if (token === '--headed') args.headless = false
    else if (token === '--timeout-ms') args.timeoutMs = Number(argv[++i])
    else if (token === '--events') args.eventsJson = argv[++i]
    else if (token === '--events-file') args.eventsFile = argv[++i]
    else if (token === '--screenshot') args.screenshotPath = argv[++i]
    else if (token === '--help' || token === '-h') args.help = true
    else throw new Error(`Unknown argument: ${token}`)
  }

  return args
}

function usage() {
  return `Usage:
  node scripts/playwright-events.mjs --events '<json>'
  node scripts/playwright-events.mjs --events-file path/to/events.json

Options:
  --url <url>              App URL (default: http://127.0.0.1:5173)
  --browser <name>         chromium|firefox|webkit (default: chromium)
  --headed                 Run browser in headed mode
  --timeout-ms <number>    Navigation/action timeout (default: 30000)
  --screenshot <path>      Save screenshot after replay
  --help                   Show this help

Event schema (array of objects):
  { "type": "focus", "selector": ".flow-wrap" }
  { "type": "click", "x": 400, "y": 220, "button": "left", "modifiers": ["Shift"] }
  { "type": "click", "selector": ".react-flow__pane", "offsetX": 300, "offsetY": 180 }
  { "type": "down", "x": 300, "y": 180, "button": "left", "modifiers": ["Shift"] }
  { "type": "move", "x": 540, "y": 380, "steps": 20 }
  { "type": "up", "button": "left" }
  { "type": "keydown", "key": "Shift" }
  { "type": "keyup", "key": "Shift" }
  { "type": "press", "key": "Control+j" }
  { "type": "boxNode", "nodeId": "n-add", "mode": "add", "padding": 12 }
  { "type": "wait", "ms": 150 }
  { "type": "state", "label": "after selection" }
  { "type": "reload" }
  { "type": "loadSheet", "sheetFile": "scripts/fixtures/all-block-types-sheet.json" }
  { "type": "rememberNodeCenter", "nodeId": "n-add", "key": "add-start" }
  { "type": "assertNodeCenterChanged", "nodeId": "n-add", "fromKey": "add-start", "minDistance": 20 }
  { "type": "assertNodeCenterNear", "nodeId": "n-add", "fromKey": "add-start", "tolerance": 10 }
  { "type": "rememberNodeCount", "key": "count-before" }
  { "type": "assertNodeCountDelta", "fromKey": "count-before", "delta": 1 }
  { "type": "assertNodeExists", "nodeId": "n-not", "exists": true }
  { "type": "assertStatusIncludes", "text": "Undo applied." }
  { "type": "rememberLayoutMetric", "key": "m0" }
  { "type": "rememberBlockOverlapCount", "key": "o0" }
  { "type": "assertLayoutScoreNotWorse", "fromKey": "m0", "maxIncrease": 0 }
  { "type": "assertLayoutCrossingsNotWorse", "fromKey": "m0", "maxIncrease": 0 }
  { "type": "assertBlockOverlapCountNotWorse", "fromKey": "o0", "maxIncrease": 0 }`
}

function browserTypeFromName(name) {
  if (name === 'chromium') return chromium
  if (name === 'firefox') return firefox
  if (name === 'webkit') return webkit
  throw new Error(`Unsupported browser: ${name}`)
}

async function loadEvents(args) {
  if (args.eventsJson && args.eventsFile) {
    throw new Error('Use either --events or --events-file, not both.')
  }

  let text = args.eventsJson
  if (args.eventsFile) {
    const fs = await import('node:fs/promises')
    text = await fs.readFile(args.eventsFile, 'utf8')
  }
  if (!text) throw new Error('Provide events with --events or --events-file.')

  const parsed = JSON.parse(text)
  if (!Array.isArray(parsed)) throw new Error('Events payload must be a JSON array.')
  return parsed
}

async function snapshotState(page, label = '') {
  const state = await page.evaluate(() => {
    const selectedNodeEls = [...document.querySelectorAll('.react-flow__node.selected')]
    const selectedNodes = selectedNodeEls.map((n) => n.getAttribute('data-id'))
    const selectedNodeCenters = selectedNodeEls.map((n) => {
      const r = n.getBoundingClientRect()
      return {
        id: n.getAttribute('data-id'),
        x: Math.round(r.left + r.width / 2),
        y: Math.round(r.top + r.height / 2),
      }
    })
    const debugText = document.querySelector('.flow-selection-debug')?.textContent ?? null
    const box = document.querySelector('.flow-select-box, .flow-unselect-box')
    const statusText = document.querySelector('.flow-status__msg')?.textContent ?? null
    const layoutMetricText = document.querySelector('.flow-status__io-metric')?.textContent ?? null
    const blockNodes = [...document.querySelectorAll('.react-flow__node.react-flow__node-plcBlock')]
      .map((n) => {
        const id = n.getAttribute('data-id')
        const r = n.getBoundingClientRect()
        return {
          id,
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
        }
      })
      .filter((n) => Boolean(n.id))
    const blockOverlapPairs = []
    for (let i = 0; i < blockNodes.length; i += 1) {
      for (let j = i + 1; j < blockNodes.length; j += 1) {
        const a = blockNodes[i]
        const b = blockNodes[j]
        const intersects =
          a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
        if (intersects) blockOverlapPairs.push([a.id, b.id])
      }
    }
    return {
      selectedCount: selectedNodes.length,
      selectedNodes,
      selectedNodeCenters,
      selectionBoxVisible: Boolean(box),
      statusText,
      layoutMetricText,
      debugText,
      blockOverlapPairs,
      blockOverlapCount: blockOverlapPairs.length,
    }
  })

  console.log(JSON.stringify({ type: 'state', label, ...state }, null, 2))
}

async function resolvePoint(page, ev, idx) {
  if (typeof ev.x === 'number' && typeof ev.y === 'number') {
    return { x: ev.x, y: ev.y }
  }
  if (ev.selector) {
    const box = await page.locator(ev.selector).first().boundingBox()
    if (!box) throw new Error(`Event ${idx}: selector has no box: ${ev.selector}`)
    const offsetX = typeof ev.offsetX === 'number' ? ev.offsetX : box.width / 2
    const offsetY = typeof ev.offsetY === 'number' ? ev.offsetY : box.height / 2
    return { x: box.x + offsetX, y: box.y + offsetY }
  }
  throw new Error(`Event ${idx} requires either x/y or selector.`)
}

async function boxAroundNode(page, ev, idx) {
  const nodeId = ev.nodeId
  if (!nodeId || typeof nodeId !== 'string') {
    throw new Error(`Event ${idx}: boxNode requires "nodeId".`)
  }
  const selector = `.react-flow__node[data-id="${nodeId}"]`
  const box = await page.locator(selector).first().boundingBox()
  if (!box) throw new Error(`Event ${idx}: node not found: ${nodeId}`)

  const padding = typeof ev.padding === 'number' ? ev.padding : 12
  const startX = box.x - padding
  const startY = box.y - padding
  const endX = box.x + box.width + padding
  const endY = box.y + box.height + padding
  const steps = typeof ev.steps === 'number' ? ev.steps : 12
  const mode = ev.mode === 'remove' ? 'remove' : 'add'

  await page.keyboard.down('Shift')
  await page.mouse.move(startX, startY, { steps: 1 })
  await page.mouse.down({ button: mode === 'remove' ? 'right' : 'left' })
  await page.mouse.move(endX, endY, { steps })
  await page.mouse.up({ button: mode === 'remove' ? 'right' : 'left' })
  await page.keyboard.up('Shift')
}

async function nodeCenterById(page, nodeId, idx, typeName) {
  if (!nodeId || typeof nodeId !== 'string') {
    throw new Error(`Event ${idx}: ${typeName} requires "nodeId".`)
  }
  const box = await page.locator(`.react-flow__node[data-id="${nodeId}"]`).first().boundingBox()
  if (!box) throw new Error(`Event ${idx}: node not found: ${nodeId}`)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

function ensureMemoryKey(ev, idx, keyName = 'key') {
  const key = ev?.[keyName]
  if (!key || typeof key !== 'string') {
    throw new Error(`Event ${idx} requires string "${keyName}".`)
  }
  return key
}

function requireStored(memory, key, idx) {
  if (!memory.has(key)) {
    throw new Error(`Event ${idx}: no stored value for key "${key}".`)
  }
  return memory.get(key)
}

function dist(a, b) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

function parseLayoutMetricText(text) {
  if (!text || typeof text !== 'string') return null
  const score = /Score\s+(-?\d+(?:\.\d+)?)/i.exec(text)
  const crossings = /\bX\s+(-?\d+(?:\.\d+)?)/i.exec(text)
  const wire = /\bW\s+(-?\d+(?:\.\d+)?)/i.exec(text)
  const area = /\bA\s+(-?\d+(?:\.\d+)?)/i.exec(text)
  if (!score || !crossings || !wire || !area) return null
  return {
    score: Number(score[1]),
    crossings: Number(crossings[1]),
    wire: Number(wire[1]),
    area: Number(area[1]),
    raw: text,
  }
}

async function blockOverlapCount(page) {
  return page.evaluate(() => {
    const blocks = [...document.querySelectorAll('.react-flow__node.react-flow__node-plcBlock')]
      .map((n) => {
        const id = n.getAttribute('data-id')
        const r = n.getBoundingClientRect()
        return { id, left: r.left, right: r.right, top: r.top, bottom: r.bottom }
      })
      .filter((n) => Boolean(n.id))
    let count = 0
    for (let i = 0; i < blocks.length; i += 1) {
      for (let j = i + 1; j < blocks.length; j += 1) {
        const a = blocks[i]
        const b = blocks[j]
        const intersects =
          a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
        if (intersects) count += 1
      }
    }
    return count
  })
}

async function runEvent(page, ev, idx, memory) {
  const type = ev?.type
  if (!type || typeof type !== 'string') {
    throw new Error(`Event ${idx} missing string "type".`)
  }

  if (type === 'focus') {
    await page.locator(ev.selector ?? '.flow-wrap').first().focus()
    return
  }

  if (type === 'click') {
    const { x, y } = await resolvePoint(page, ev, idx)
    await page.mouse.click(x, y, {
      button: ev.button ?? 'left',
      clickCount: ev.clickCount ?? 1,
      modifiers: ev.modifiers ?? [],
      delay: ev.delay ?? 0,
    })
    return
  }

  if (type === 'down') {
    const { x, y } = await resolvePoint(page, ev, idx)
    await page.mouse.move(x, y, { steps: ev.steps ?? 1 })
    await page.mouse.down({
      button: ev.button ?? 'left',
      clickCount: ev.clickCount ?? 1,
    })
    return
  }

  if (type === 'move') {
    const { x, y } = await resolvePoint(page, ev, idx)
    await page.mouse.move(x, y, { steps: ev.steps ?? 1 })
    return
  }

  if (type === 'up') {
    await page.mouse.up({
      button: ev.button ?? 'left',
      clickCount: ev.clickCount ?? 1,
    })
    return
  }

  if (type === 'keydown') {
    await page.keyboard.down(ev.key)
    return
  }

  if (type === 'keyup') {
    await page.keyboard.up(ev.key)
    return
  }

  if (type === 'press') {
    await page.keyboard.press(ev.key)
    return
  }

  if (type === 'type') {
    await page.keyboard.type(ev.text ?? '', { delay: ev.delay ?? 0 })
    return
  }

  if (type === 'wheel') {
    await page.mouse.wheel(ev.dx ?? 0, ev.dy ?? 0)
    return
  }

  if (type === 'wait') {
    await page.waitForTimeout(ev.ms ?? 50)
    return
  }

  if (type === 'state') {
    await snapshotState(page, ev.label ?? `step-${idx}`)
    return
  }

  if (type === 'boxNode') {
    await boxAroundNode(page, ev, idx)
    return
  }

  if (type === 'reload') {
    await page.reload({ waitUntil: 'networkidle' })
    return
  }

  if (type === 'loadSheet') {
    const sheetText =
      typeof ev.sheetText === 'string'
        ? ev.sheetText
        : typeof ev.sheetFile === 'string'
          ? await (await import('node:fs/promises')).readFile(ev.sheetFile, 'utf8')
          : null
    if (!sheetText) {
      throw new Error(`Event ${idx}: loadSheet requires "sheetText" or "sheetFile".`)
    }
    const importButton = page
      .locator('button:has-text("Import sheet…"), button:has-text("Close import")')
      .first()
    await importButton.click()
    await page.locator('.flow-sheet-import__textarea').fill(sheetText)
    await page.locator('button:has-text("Load sheet")').click()
    await page.waitForTimeout(typeof ev.waitMs === 'number' ? ev.waitMs : 120)
    return
  }

  if (type === 'rememberNodeCenter') {
    const key = ensureMemoryKey(ev, idx, 'key')
    const center = await nodeCenterById(page, ev.nodeId, idx, 'rememberNodeCenter')
    memory.set(key, center)
    console.log(JSON.stringify({ type: 'rememberNodeCenter', key, center }, null, 2))
    return
  }

  if (type === 'assertNodeCenterChanged') {
    const fromKey = ensureMemoryKey(ev, idx, 'fromKey')
    const prev = requireStored(memory, fromKey, idx)
    if (!prev || typeof prev.x !== 'number' || typeof prev.y !== 'number') {
      throw new Error(`Event ${idx}: key "${fromKey}" does not hold a node center.`)
    }
    const now = await nodeCenterById(page, ev.nodeId, idx, 'assertNodeCenterChanged')
    const minDistance = typeof ev.minDistance === 'number' ? ev.minDistance : 14
    const d = dist(now, prev)
    if (d < minDistance) {
      throw new Error(
        `Event ${idx}: center moved ${d.toFixed(2)}px, expected at least ${minDistance}px.`,
      )
    }
    console.log(
      JSON.stringify({ type: 'assertNodeCenterChanged', nodeId: ev.nodeId, fromKey, distance: d }, null, 2),
    )
    return
  }

  if (type === 'assertNodeCenterNear') {
    const fromKey = ensureMemoryKey(ev, idx, 'fromKey')
    const prev = requireStored(memory, fromKey, idx)
    if (!prev || typeof prev.x !== 'number' || typeof prev.y !== 'number') {
      throw new Error(`Event ${idx}: key "${fromKey}" does not hold a node center.`)
    }
    const now = await nodeCenterById(page, ev.nodeId, idx, 'assertNodeCenterNear')
    const tolerance = typeof ev.tolerance === 'number' ? ev.tolerance : 12
    const d = dist(now, prev)
    if (d > tolerance) {
      throw new Error(`Event ${idx}: center drift ${d.toFixed(2)}px exceeds tolerance ${tolerance}px.`)
    }
    console.log(
      JSON.stringify({ type: 'assertNodeCenterNear', nodeId: ev.nodeId, fromKey, distance: d }, null, 2),
    )
    return
  }

  if (type === 'rememberNodeCount') {
    const key = ensureMemoryKey(ev, idx, 'key')
    const count = await page
      .locator('.react-flow__node.react-flow__node-plcBlock, .react-flow__node.react-flow__node-plcFrame')
      .count()
    memory.set(key, count)
    console.log(JSON.stringify({ type: 'rememberNodeCount', key, count }, null, 2))
    return
  }

  if (type === 'assertNodeCountDelta') {
    const fromKey = ensureMemoryKey(ev, idx, 'fromKey')
    const prev = requireStored(memory, fromKey, idx)
    if (typeof prev !== 'number') {
      throw new Error(`Event ${idx}: key "${fromKey}" does not hold a numeric node count.`)
    }
    const current = await page
      .locator('.react-flow__node.react-flow__node-plcBlock, .react-flow__node.react-flow__node-plcFrame')
      .count()
    const delta = typeof ev.delta === 'number' ? ev.delta : 0
    if (current - prev !== delta) {
      throw new Error(
        `Event ${idx}: node count delta ${current - prev}, expected ${delta}. (prev=${prev}, current=${current})`,
      )
    }
    console.log(
      JSON.stringify({ type: 'assertNodeCountDelta', fromKey, prev, current, delta }, null, 2),
    )
    return
  }

  if (type === 'assertNodeExists') {
    const nodeId = ev.nodeId
    if (!nodeId || typeof nodeId !== 'string') {
      throw new Error(`Event ${idx}: assertNodeExists requires "nodeId".`)
    }
    const expected = typeof ev.exists === 'boolean' ? ev.exists : true
    const exists = (await page.locator(`.react-flow__node[data-id="${nodeId}"]`).count()) > 0
    if (exists !== expected) {
      throw new Error(`Event ${idx}: node "${nodeId}" exists=${exists}, expected ${expected}.`)
    }
    console.log(JSON.stringify({ type: 'assertNodeExists', nodeId, exists }, null, 2))
    return
  }

  if (type === 'assertStatusIncludes') {
    const needle = ev.text
    if (!needle || typeof needle !== 'string') {
      throw new Error(`Event ${idx}: assertStatusIncludes requires string "text".`)
    }
    const status = (await page.locator('.flow-status__msg').textContent()) ?? ''
    if (!status.includes(needle)) {
      throw new Error(`Event ${idx}: status "${status}" does not include "${needle}".`)
    }
    console.log(JSON.stringify({ type: 'assertStatusIncludes', expected: needle, status }, null, 2))
    return
  }

  if (type === 'rememberLayoutMetric') {
    const key = ensureMemoryKey(ev, idx, 'key')
    const text = (await page.locator('.flow-status__io-metric').textContent()) ?? ''
    const metric = parseLayoutMetricText(text)
    if (!metric) {
      throw new Error(`Event ${idx}: could not parse layout metric from "${text}".`)
    }
    memory.set(key, metric)
    console.log(JSON.stringify({ type: 'rememberLayoutMetric', key, metric }, null, 2))
    return
  }

  if (type === 'rememberBlockOverlapCount') {
    const key = ensureMemoryKey(ev, idx, 'key')
    const count = await blockOverlapCount(page)
    memory.set(key, count)
    console.log(JSON.stringify({ type: 'rememberBlockOverlapCount', key, count }, null, 2))
    return
  }

  if (type === 'assertLayoutScoreNotWorse') {
    const fromKey = ensureMemoryKey(ev, idx, 'fromKey')
    const prev = requireStored(memory, fromKey, idx)
    if (!prev || typeof prev.score !== 'number') {
      throw new Error(`Event ${idx}: key "${fromKey}" does not hold a layout metric.`)
    }
    const currentText = (await page.locator('.flow-status__io-metric').textContent()) ?? ''
    const current = parseLayoutMetricText(currentText)
    if (!current) {
      throw new Error(`Event ${idx}: could not parse current layout metric from "${currentText}".`)
    }
    const maxIncrease = typeof ev.maxIncrease === 'number' ? ev.maxIncrease : 0
    if (current.score > prev.score + maxIncrease) {
      throw new Error(
        `Event ${idx}: layout score regressed from ${prev.score} to ${current.score} (allowed +${maxIncrease}).`,
      )
    }
    console.log(
      JSON.stringify(
        {
          type: 'assertLayoutScoreNotWorse',
          fromKey,
          previous: prev.score,
          current: current.score,
          maxIncrease,
        },
        null,
        2,
      ),
    )
    return
  }

  if (type === 'assertLayoutCrossingsNotWorse') {
    const fromKey = ensureMemoryKey(ev, idx, 'fromKey')
    const prev = requireStored(memory, fromKey, idx)
    if (!prev || typeof prev.crossings !== 'number') {
      throw new Error(`Event ${idx}: key "${fromKey}" does not hold a layout metric.`)
    }
    const currentText = (await page.locator('.flow-status__io-metric').textContent()) ?? ''
    const current = parseLayoutMetricText(currentText)
    if (!current) {
      throw new Error(`Event ${idx}: could not parse current layout metric from "${currentText}".`)
    }
    const maxIncrease = typeof ev.maxIncrease === 'number' ? ev.maxIncrease : 0
    if (current.crossings > prev.crossings + maxIncrease) {
      throw new Error(
        `Event ${idx}: crossing count regressed from ${prev.crossings} to ${current.crossings} (allowed +${maxIncrease}).`,
      )
    }
    console.log(
      JSON.stringify(
        {
          type: 'assertLayoutCrossingsNotWorse',
          fromKey,
          previous: prev.crossings,
          current: current.crossings,
          maxIncrease,
        },
        null,
        2,
      ),
    )
    return
  }

  if (type === 'assertBlockOverlapCountNotWorse') {
    const fromKey = ensureMemoryKey(ev, idx, 'fromKey')
    const prev = requireStored(memory, fromKey, idx)
    if (typeof prev !== 'number') {
      throw new Error(`Event ${idx}: key "${fromKey}" does not hold block overlap count.`)
    }
    const current = await blockOverlapCount(page)
    const maxIncrease = typeof ev.maxIncrease === 'number' ? ev.maxIncrease : 0
    if (current > prev + maxIncrease) {
      throw new Error(
        `Event ${idx}: block overlap count regressed from ${prev} to ${current} (allowed +${maxIncrease}).`,
      )
    }
    console.log(
      JSON.stringify(
        {
          type: 'assertBlockOverlapCountNotWorse',
          fromKey,
          previous: prev,
          current,
          maxIncrease,
        },
        null,
        2,
      ),
    )
    return
  }

  if (type === 'clearMemory') {
    memory.clear()
    console.log(JSON.stringify({ type: 'clearMemory' }, null, 2))
    return
  }

  throw new Error(`Unsupported event type "${type}" at index ${idx}.`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(usage())
    return
  }

  const events = await loadEvents(args)
  const memory = new Map()
  const browserType = browserTypeFromName(args.browser)
  const browser = await browserType.launch({ headless: args.headless })

  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
    const page = await context.newPage()
    page.setDefaultTimeout(args.timeoutMs)
    await page.goto(args.url, { waitUntil: 'networkidle' })

    for (let i = 0; i < events.length; i += 1) {
      await runEvent(page, events[i], i, memory)
    }

    await snapshotState(page, 'final')

    if (args.screenshotPath) {
      await page.screenshot({ path: args.screenshotPath, fullPage: true })
      console.log(`Saved screenshot: ${args.screenshotPath}`)
    }
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error(`playwright-events failed: ${err instanceof Error ? err.message : String(err)}`)
  process.exitCode = 1
})

