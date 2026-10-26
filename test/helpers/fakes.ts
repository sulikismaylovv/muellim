import type { LlmClient, LlmRequest, LookupTools, Purpose } from '../../src/providers/llm.js'
import type { Transcript } from '../../src/session/transcript.js'
import type { Question, Usage } from '../../src/types.js'
import type { Asker } from '../../src/ui/terminal.js'

/** Replays saved AI responses per purpose and checks each against the request's schema. */
export class FakeLlm implements LlmClient {
  readonly requests: Array<LlmRequest<unknown>> = []
  private readonly queues: Record<Purpose, unknown[]>

  constructor(responses: Partial<Record<Purpose, unknown[]>>) {
    this.queues = {
      plan: [...(responses.plan ?? [])],
      grade: [...(responses.grade ?? [])],
      lesson: [...(responses.lesson ?? [])],
    }
  }

  async generate<T>(request: LlmRequest<T>): Promise<T> {
    this.requests.push(request as LlmRequest<unknown>)
    const next = this.queues[request.purpose].shift()
    if (next === undefined) throw new Error(`FakeLlm has no ${request.purpose} response left`)
    return request.schema.parse(next)
  }

  usage(): Usage {
    return { calls: this.requests.length, inputTokens: 0, outputTokens: 0 }
  }
}

/** Answers questions from a script and logs everything it shows and asks. */
export class ScriptedAsker implements Asker {
  readonly shown: string[] = []

  constructor(
    private readonly answers: Array<string | Error>,
    private readonly log: string[] = [],
  ) {}

  private next(): Promise<string> {
    const answer = this.answers.shift()
    if (answer === undefined) throw new Error('ScriptedAsker ran out of answers')
    this.log.push('ask')
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)
  }

  askText(): Promise<string> {
    return this.next()
  }

  askChoice(_question: Question): Promise<string> {
    return this.next()
  }

  show(text: string): void {
    this.shown.push(text)
  }
}

/** Records transcript calls in order. */
export function recordingTranscript(log: string[]): Transcript {
  return {
    begin: async (kind) => void log.push(`begin:${kind}`),
    answerKeys: async (qs) => void log.push(`keys:${qs.length}`),
    result: async (i, r) => void log.push(`result:${i}:${r.outcome}`),
    passed: async (s, n) => void log.push(`passed:${s.total}:${n.length}`),
    abandoned: async () => void log.push('abandoned'),
  }
}

export const noLookups: LookupTools = {
  listFiles: async () => '',
  readFile: async () => '',
  search: async () => '',
}
