# Spec 1: the local learning loop

Date: 2026-10-26. Status: approved by the owner in chat on 2026-10-26.

## Goal

A developer runs Muellim on their own machine while they work on a branch. Muellim quizzes them on the code in the change, much of it written by an AI agent, and teaches each answer they get wrong. When the branch becomes a pull request, `muellim pr <number>` quizzes whatever earlier checks did not cover and produces a pass result. Spec 2 posts that result to GitHub, and spec 3 turns the transcript into a PDF.

Muellim is a learning tool, not a security gate. A determined author can forge a pass, and the docs say so.

v0.1 is done when an author on a real GitHub repository runs Muellim, passes, sees the `muellim` check turn green, and receives a PDF of what they learned. This spec covers the local part of that path.

## Decisions

| Decision | Made by |
|---|---|
| Muellim is open source and built from scratch. It reuses no code from `parthh01/sphinx` or `sphinx-doc/sphinx`. | Owner |
| The check runs on pull requests before merge and never blocks a push. | Owner |
| The author of the code takes the quiz, in a local tool, on GitHub only. | Owner |
| Passing is a required GitHub check. A `muellim-skip` bypass exists, and running Muellim is the user's choice. | Owner |
| `muellim start` at the start of a session takes a brief, so large pull requests are quizzed in parts. | Owner proposed, design agreed |
| English only in v0.1. Every user-facing string lives outside the code. | Owner |
| TypeScript on Node 22 or later, one npm package named `muellim`. | Research recommendation; the owner did not object when told it was assumed |
| Open answers for behaviour and design questions, multiple choice for exact details. | Owner |
| The engine reads a fixed context bundle and may make up to 3 read-only lookups. | Owner |
| A run passes when every wrong answer got its lesson and a retry, even if the retry is also wrong. | Owner |

## Commands

`muellim start` records the commit where the branch left the default branch. It then asks for a short brief: the goal of the work and the areas the author wants to be checked on. It writes both to `.muellim/session.json`.

`muellim check` quizzes the change since the last passed check, or since `start` when no check has passed yet.

`muellim pr <number>` gets the pull request's change through the author's `gh` sign-in and quizzes the parts that no earlier check covered. On a pass it produces the result that spec 2 posts: the pull request's head commit, the score and the topics taught.

The terminal is the only interface. The author types open answers and picks multiple-choice answers with the arrow keys.

## Modules

| Module | Job |
|---|---|
| `cli` | Parses the `start`, `check` and `pr` commands. |
| `session` | Reads and writes `.muellim/`: the brief, the start commit, the passed chunk fingerprints and the transcripts. |
| `diff` | Gets the change from git, or from GitHub for `pr`. Splits it into chunks, fingerprints each chunk by content, and ranks chunks by risk. |
| `engine` | Plans the questions, writes each question and its answer key, grades answers and writes lessons. |
| `providers` | Calls the AI through the Vercel AI SDK. Two routes: an Anthropic key, or any OpenAI-compatible base URL, which covers OpenAI, Ollama, LM Studio and OpenRouter. |
| `ui` | Shows questions in the terminal and reads answers. |
| `strings` | Holds every user-facing string, in English for v0.1. |
| `eval` | Holds the evaluation fixtures and scores question and grading quality. |

The user brings their own key. Muellim has no hosted service and never falls back to a paid service on its own.

## Data flow

A `check` run, and the quiz part of a `pr` run, goes through these steps:

1. Take the change since the last pass, or since `start`.
2. Split the change into chunks and fingerprint each chunk by its content. Rebases and squashes change commit IDs but not fingerprints, so passed work stays passed.
3. Drop chunks whose fingerprints already passed.
4. Rank the remaining chunks by risk: size, kind of file, and how often other code uses the changed code. Areas named in the brief rank higher. The brief never removes an area.
5. Build the context bundle: the ranked chunks, the functions around them and the brief. The AI may make up to 3 read-only lookups when it needs more context.
6. Plan at most 5 questions. Behaviour and design questions are open. Questions on exact details are multiple choice.
7. For each question, write the question and its answer key, and save the answer key to the transcript before the author answers.
8. Ask the question and grade the answer.
9. On a wrong answer, show a lesson and ask once more. A retry that is still wrong is recorded as "taught, not yet understood".
10. When every wrong answer has had its lesson and retry, the run passes. Muellim records the run's chunk fingerprints as passed and appends the run to the Markdown transcript in `.muellim/`.

The score counts first-time and retry results separately, so the result posted to GitHub shows what the author understood. Spec 3 lists the "taught, not yet understood" questions first in the PDF.

## Errors

| Situation | Behaviour |
|---|---|
| No API key, or the AI service is unreachable | Print a clear message, exit with a non-zero code, mark nothing as passed. |
| The AI returns output that fails its zod schema | Retry the request once. On a second failure, stop the run and mark nothing as passed. |
| The run reaches its AI call cap (default 20) or its token budget | Stop the run and mark nothing as passed. |
| The author presses Ctrl-C | Mark nothing as passed. Keep the partial transcript, marked "abandoned". |
| No change since the last pass | `check` reports that there is nothing to check. `pr` counts it as a pass. |
| More chunks than 5 questions can cover | Quiz the top-ranked chunks. List the rest in the transcript as "not quizzed" and count them as covered, so `pr` does not quiz the same pull request forever. |
| `pr` runs without a `gh` sign-in | Tell the author to run `gh auth login`. |

Lookups are read-only and confined to the repository. They respect `.gitignore` and a `.muellimignore` file. Muellim never sends files that look like secrets to the AI, including when they are part of the change. That covers `.env*`, `*.pem`, `id_*` and other key files.

## Testing

Vitest unit tests cover chunking and fingerprints, risk ranking and the brief's boost, session state, the pass rule, and the secret-file filter.

Tests replay saved AI responses, so they need no key and cost nothing.

The evaluation set holds about 20 small real-world changes in TypeScript, JavaScript and Python. Each fixture has accepted answers and common wrong answers. `npm run eval` runs the set with a real key and reports how often Muellim's grading agrees with the accepted grades. The target is 90% agreement or better. The owner runs it by hand before each release. It does not run in CI.

CI on GitHub Actions runs lint, type checks and the unit tests on Node 22.

## Out of scope for v0.1

- The GitHub comment, the Action check and `muellim-skip`, which belong to spec 2.
- The PDF report, which belongs to spec 3. Spec 3 needs a design source before its own spec.
- A web interface.
- Languages other than English.
- GitLab and other platforms.
- Reading AI agent session logs.
- Spaced repetition.
- A hosted service.
- Reusing a Claude Code or Codex sign-in.
- A single-binary build and a Homebrew package.

## Design file

Spec 1 is a terminal tool, and no design file applies to it. The repository has no `DESIGN.md`.
