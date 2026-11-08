import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { MuellimError } from '../errors.js'
import { en } from '../strings/en.js'

export const WORKFLOW_PATH = '.github/workflows/muellim.yml'

export const WORKFLOW = `name: muellim

on:
  pull_request_target:
    types: [opened, reopened, synchronize, labeled, unlabeled]
  issue_comment:
    types: [created]

permissions:
  statuses: write
  pull-requests: read

jobs:
  muellim:
    if: github.event_name != 'issue_comment' || github.event.issue.pull_request
    runs-on: ubuntu-latest
    steps:
      - uses: sulikismaylovv/muellim@v0
`

export interface InitOptions {
  force?: boolean
}

/** Writes the workflow that runs the check. It stops rather than replace an existing file. */
export async function initCommand(
  deps: { root: string; show(text: string): void },
  options: InitOptions,
): Promise<void> {
  const target = join(deps.root, WORKFLOW_PATH)
  await mkdir(dirname(target), { recursive: true })
  try {
    await writeFile(target, WORKFLOW, { flag: options.force ? 'w' : 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new MuellimError('workflow-exists')
    }
    throw error
  }
  deps.show(en.init.written(WORKFLOW_PATH))
}
