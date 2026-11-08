import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { initCommand, WORKFLOW, WORKFLOW_PATH } from '../../src/commands/init.js'

// Typed out by hand. Every adopting repository runs this text, so changing it takes two edits.
const EXPECTED_WORKFLOW = `name: muellim

on:
  pull_request_target:
    types: [opened, reopened, synchronize, labeled, unlabeled]
  issue_comment:
    types: [created]

permissions:
  statuses: write
  pull-requests: read

jobs:
  set-status:
    if: github.event_name != 'issue_comment' || github.event.issue.pull_request
    runs-on: ubuntu-latest
    steps:
      - uses: sulikismaylovv/muellim@v0
`

const roots: string[] = []

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'muellim-init-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('initCommand', () => {
  it('writes the workflow and tells the user to make the check required', async () => {
    const root = await tempRoot()
    const shown: string[] = []
    await initCommand({ root, show: (t) => shown.push(t) }, {})
    expect(await readFile(join(root, WORKFLOW_PATH), 'utf8')).toBe(WORKFLOW)
    expect(shown.join('\n')).toContain('required')
  })

  it('holds the exact workflow text', () => {
    expect(WORKFLOW).toBe(EXPECTED_WORKFLOW)
  })

  it('never checks out pull request code and asks for the least permissions', () => {
    expect(WORKFLOW).not.toContain('actions/checkout')
    expect(WORKFLOW).toContain('statuses: write')
    expect(WORKFLOW).toContain('pull-requests: read')
    expect(WORKFLOW).not.toContain('contents:')
  })

  it('refuses to replace an existing workflow, unless forced', async () => {
    const root = await tempRoot()
    const deps = { root, show: () => {} }
    await initCommand(deps, {})
    await expect(initCommand(deps, {})).rejects.toMatchObject({ code: 'workflow-exists' })
    await expect(initCommand(deps, { force: true })).resolves.toBeUndefined()
  })
})
