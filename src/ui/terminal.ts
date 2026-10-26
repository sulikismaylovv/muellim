import { input, select } from '@inquirer/prompts'
import { MuellimError } from '../errors.js'
import type { Question } from '../types.js'

/** How Muellim talks to the person at the keyboard. Tests use a scripted fake. */
export interface Asker {
  /** A free-text answer. `required: false` accepts an empty answer. */
  askText(message: string, required: boolean): Promise<string>
  /** A choice question: returns the text of the chosen option. */
  askChoice(question: Question): Promise<string>
  show(text: string): void
}

export interface PromptFns {
  input(config: { message: string; required?: boolean }): Promise<string>
  select(config: {
    message: string
    choices: Array<{ name: string; value: string }>
  }): Promise<string>
}

/** Fisher-Yates, so the correct choice is not always where the AI put it. */
export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const a = out[i] as T
    out[i] = out[j] as T
    out[j] = a
  }
  return out
}

async function guard<T>(prompt: Promise<T>): Promise<T> {
  try {
    return await prompt
  } catch (error) {
    // Inquirer rejects with ExitPromptError when the user presses Ctrl-C.
    if (error instanceof Error && error.name === 'ExitPromptError')
      throw new MuellimError('aborted')
    throw error
  }
}

export function createTerminalAsker(
  fns: PromptFns = { input, select },
  out: (text: string) => void = (text) => process.stdout.write(`${text}\n`),
  random: () => number = Math.random,
): Asker {
  return {
    askText: (message, required) => guard(fns.input({ message, required })),

    askChoice: (question) =>
      guard(
        fns.select({
          message: question.prompt,
          choices: shuffle(question.choices, random).map((c) => ({ name: c, value: c })),
        }),
      ),

    show: out,
  }
}
