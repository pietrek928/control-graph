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
  { "type": "state", "label": "after selection" }`
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

async function runEvent(page, ev, idx) {
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

  throw new Error(`Unsupported event type "${type}" at index ${idx}.`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(usage())
    return
  }

  const events = await loadEvents(args)
  const browserType = browserTypeFromName(args.browser)
  const browser = await browserType.launch({ headless: args.headless })

  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
    const page = await context.newPage()
    page.setDefaultTimeout(args.timeoutMs)
    await page.goto(args.url, { waitUntil: 'networkidle' })

    for (let i = 0; i < events.length; i += 1) {
      await runEvent(page, events[i], i)
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

