# Muellim

Muellim ("teacher" in Azerbaijani) quizzes you on the code in your pull request before you merge it, and teaches you the parts you got wrong. It is meant for code written with AI agents, where it is easy to ship a change you never fully read.

Muellim is a learning tool, not a security gate. It never blocks a push. You run it locally with your own AI key, and a GitHub check shows that the author took the quiz. The pass is a file on the author's machine, so a determined author can forge it.

## Setup

Muellim needs Node 22 or later, git 2.38 or later, and the GitHub CLI for `muellim pr`. From a checkout of this repository, build and install the `muellim` command:

```sh
npm ci
npm run build
npm link
```

`MUELLIM_MODEL` names the AI provider and the model as `<provider>/<model>`, and Muellim sends your code only to that provider. Pick one of these setups:

```sh
# Anthropic. ANTHROPIC_API_KEY works too when MUELLIM_API_KEY is unset.
export MUELLIM_MODEL=anthropic/claude-haiku-5-5
export MUELLIM_API_KEY=<your Anthropic key>

# Ollama on this machine, at http://localhost:11434/v1. No key needed.
# Set MUELLIM_BASE_URL to use an Ollama server somewhere else.
export MUELLIM_MODEL=ollama/qwen3

# Any OpenAI-compatible server. Set MUELLIM_API_KEY if the server needs a key.
export MUELLIM_MODEL=openai-compatible/<model>
export MUELLIM_BASE_URL=<the server's base URL, such as http://localhost:1234/v1>
```

Then run these in your repository:

- `muellim start` records where your branch began and asks what you are building.
- `muellim check` quizzes you on the work since your last pass.
- `muellim pr <number>` quizzes you on what earlier checks did not cover in that pull request, and saves the pass to `.muellim/pr-<number>.json`. It reads the pull request through the GitHub CLI, so run `gh auth login` once first.

## License

Apache-2.0. See `LICENSE`.
