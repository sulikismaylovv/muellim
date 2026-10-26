import { describe, expect, it } from 'vitest'
import { MuellimError } from '../../src/errors.js'
import type { Question } from '../../src/types.js'
import { createTerminalAsker, type PromptFns, shuffle } from '../../src/ui/terminal.js'

const question: Question = {
  id: 'q1',
  kind: 'choice',
  topic: 't',
  prompt: 'Which one?',
  choices: ['a', 'b', 'c'],
  answerKey: 'a',
  rubric: [],
}

function exitPromptError(): Error {
  const error = new Error('User force closed the prompt')
  error.name = 'ExitPromptError'
  return error
}

describe('shuffle', () => {
  it('keeps every item and moves them with the given random source', () => {
    expect(shuffle(['a', 'b', 'c'], () => 0)).toEqual(['b', 'c', 'a'])
    expect(shuffle(['a', 'b', 'c'], () => 0.99).sort()).toEqual(['a', 'b', 'c'])
  })
})

describe('createTerminalAsker', () => {
  it('returns the chosen option text from shuffled choices', async () => {
    const seen: string[][] = []
    const fns: PromptFns = {
      input: async () => '',
      select: async ({ choices }) => {
        seen.push(choices.map((c) => c.value))
        return 'c'
      },
    }
    const asker = createTerminalAsker(
      fns,
      () => {},
      () => 0,
    )
    expect(await asker.askChoice(question)).toBe('c')
    expect(seen[0]).toEqual(['b', 'c', 'a'])
  })

  it('turns Ctrl-C into an aborted error', async () => {
    const fns: PromptFns = {
      input: async () => {
        throw exitPromptError()
      },
      select: async () => {
        throw exitPromptError()
      },
    }
    const asker = createTerminalAsker(fns, () => {})
    await expect(asker.askText('Answer', true)).rejects.toMatchObject({ code: 'aborted' })
    await expect(asker.askChoice(question)).rejects.toBeInstanceOf(MuellimError)
  })

  it('passes other errors through unchanged', async () => {
    const fns: PromptFns = {
      input: async () => {
        throw new Error('stdin closed')
      },
      select: async () => 'a',
    }
    await expect(createTerminalAsker(fns, () => {}).askText('x', false)).rejects.toThrow(
      'stdin closed',
    )
  })
})
