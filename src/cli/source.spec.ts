import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildLinter, resolveSource } from './source'
import { GitLabCILinter } from '../GitLabCILinter'
import { GitLabRemoteSource } from '../GitLabRemoteSource'

describe('resolveSource', () => {
  it('defaults to local .gitlab-ci.yml when no positionals given', () => {
    expect(resolveSource([])).toEqual({ filePath: '.gitlab-ci.yml' })
  })

  it('treats a single local path as filePath', () => {
    expect(resolveSource(['my-pipeline.yml'])).toEqual({ filePath: 'my-pipeline.yml' })
  })

  it('parses a single GitLab URL into a remote source', () => {
    const out = resolveSource(['https://gitlab.com/group/project/-/blob/main/.gitlab-ci.yml'])
    expect(out.remoteSource).toBeInstanceOf(GitLabRemoteSource)
    expect(out.filePath).toBeUndefined()
  })

  it('treats <project> <ref> pair as a remote source', () => {
    const out = resolveSource(['group/project', 'main'])
    expect(out.remoteSource).toBeInstanceOf(GitLabRemoteSource)
  })

  it('throws on an invalid project/ref pair', () => {
    expect(() => resolveSource(['not a valid project', 'main'])).toThrow(/Invalid project path/)
  })
})

describe('buildLinter', () => {
  let dir: string
  let errorSpy: ReturnType<typeof vi.spyOn>
  let exitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gci-linter-source-'))
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((_c?: number) => {
      throw new Error('exit')
    }) as never)
  })
  afterEach(() => {
    errorSpy.mockRestore()
    exitSpy.mockRestore()
  })

  it('returns a remote-source GitLabCILinter when given one', () => {
    const linter = buildLinter({ remoteSource: new GitLabRemoteSource('group/project', 'main') })
    expect(linter).toBeInstanceOf(GitLabCILinter)
  })

  it('exits 1 when no source is provided', () => {
    expect(() => buildLinter({})).toThrow('exit')
    expect(errorSpy).toHaveBeenCalledWith('Error: No input source specified')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('exits 1 when filePath does not exist', () => {
    expect(() => buildLinter({ filePath: join(dir, 'nope.yml') })).toThrow('exit')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/not found/))
  })

  it('loads a local .gitlab-ci.yml from a passed directory', () => {
    writeFileSync(join(dir, '.gitlab-ci.yml'), 'stages: [build]\n')
    const linter = buildLinter({ filePath: dir })
    expect(linter).toBeInstanceOf(GitLabCILinter)
  })

  it('exits 1 when a passed directory has no .gitlab-ci.yml', () => {
    const subdir = join(dir, 'sub')
    mkdirSync(subdir)
    expect(() => buildLinter({ filePath: subdir })).toThrow('exit')
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/does not contain \.gitlab-ci\.yml/),
    )
  })

  it('loads a direct file path', () => {
    const path = join(dir, 'ci.yml')
    writeFileSync(path, 'stages: [build]\n')
    const linter = buildLinter({ filePath: path })
    expect(linter).toBeInstanceOf(GitLabCILinter)
  })
})
