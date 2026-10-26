import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export interface TempRepo {
  dir: string
  write(path: string, text: string): Promise<void>
  commit(message: string): void
}

/** A fresh git repository in a temporary folder, with one commit on `main`. */
export async function tempRepo(): Promise<TempRepo> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'muellim-repo-')))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  git('config', 'commit.gpgsign', 'false')
  const repo: TempRepo = {
    dir,
    async write(path, text) {
      await mkdir(dirname(join(dir, path)), { recursive: true })
      await writeFile(join(dir, path), text)
    },
    commit(message) {
      git('add', '-A')
      git('commit', '-q', '-m', message)
    },
  }
  await repo.write('README.md', '# test\n')
  repo.commit('initial')
  return repo
}
