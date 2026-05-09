#!/usr/bin/env node

import { spawnSync } from 'node:child_process'

const baseArgs = ['scripts/playwright-events.mjs']
const cases = [
  'scripts/events/layout-benchmark-all-block-types.json',
  'scripts/events/layout-benchmark-case-dense-cluster.json',
  'scripts/events/layout-benchmark-case-reverse-flow.json',
  'scripts/events/layout-benchmark-case-frame-pressure.json',
]

const summaries = []
let hasFailure = false

for (const eventsFile of cases) {
  const started = Date.now()
  const result = spawnSync(
    process.execPath,
    [...baseArgs, '--events-file', eventsFile],
    { stdio: 'inherit' },
  )
  const elapsedMs = Date.now() - started
  const ok = (result.status ?? 1) === 0
  summaries.push({ eventsFile, ok, elapsedMs })
  if (!ok) hasFailure = true
}

console.log('\n=== layout benchmark suite ===')
for (const summary of summaries) {
  const marker = summary.ok ? 'PASS' : 'FAIL'
  console.log(`${marker} ${summary.eventsFile} (${summary.elapsedMs} ms)`)
}

if (hasFailure) {
  process.exitCode = 1
}
