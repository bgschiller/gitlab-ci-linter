import { describe, expect, it } from 'vitest'
import { isLikelyCommitSha, isValidProjectPath, isValidRef, parseGitLabInput } from './urlParser'

describe('parseGitLabInput', () => {
  describe('URL parsing', () => {
    it('should parse commit URLs on gitlab.com', () => {
      const result = parseGitLabInput(
        'https://gitlab.com/acme/widgets/-/commit/225a63dd1fa2b38ee101f7a7bc6a55248ad649bd',
      )
      expect(result).toEqual({
        project: 'acme/widgets',
        ref: '225a63dd1fa2b38ee101f7a7bc6a55248ad649bd',
        host: 'gitlab.com',
      })
    })

    it('should parse short commit URLs on a self-hosted instance', () => {
      const result = parseGitLabInput('https://gitlab.example.com/acme/widgets/-/commit/225a63dd1')
      expect(result).toEqual({
        project: 'acme/widgets',
        ref: '225a63dd1',
        host: 'gitlab.example.com',
      })
    })

    it('should parse tree URLs with file paths', () => {
      const result = parseGitLabInput(
        'https://gitlab.com/acme/widgets/-/tree/main/.gitlab-ci.yml',
      )
      expect(result).toEqual({
        project: 'acme/widgets',
        ref: 'main',
        file: '.gitlab-ci.yml',
        host: 'gitlab.com',
      })
    })

    it('should parse tree URLs without file paths', () => {
      const result = parseGitLabInput('https://gitlab.example.com/acme/widgets/-/tree/develop')
      expect(result).toEqual({
        project: 'acme/widgets',
        ref: 'develop',
        host: 'gitlab.example.com',
      })
    })

    it('should parse blob URLs with refs that contain slashes', () => {
      const result = parseGitLabInput(
        'https://gitlab.example.com/acme/widgets/-/blob/feature/ci-updates/.gitlab-ci.yml',
      )
      expect(result).toEqual({
        project: 'acme/widgets',
        ref: 'feature/ci-updates',
        file: '.gitlab-ci.yml',
        host: 'gitlab.example.com',
      })
    })

    it('should parse basic project URLs', () => {
      const result = parseGitLabInput('https://gitlab.example.com/acme/widgets')
      expect(result).toEqual({
        project: 'acme/widgets',
        ref: 'main',
        host: 'gitlab.example.com',
      })
    })

    it('should handle gitlab.com URLs', () => {
      const result = parseGitLabInput('https://gitlab.com/gitlab-org/gitlab/-/commit/abc123')
      expect(result).toEqual({
        project: 'gitlab-org/gitlab',
        ref: 'abc123',
        host: 'gitlab.com',
      })
    })

    it('should handle URLs with trailing slashes', () => {
      const result = parseGitLabInput('https://gitlab.example.com/acme/widgets/')
      expect(result).toEqual({
        project: 'acme/widgets',
        ref: 'main',
        host: 'gitlab.example.com',
      })
    })
  })

  describe('project/ref parsing', () => {
    it('should parse project and full commit SHA', () => {
      const result = parseGitLabInput(
        'acme/widgets',
        '225a63dd1fa2b38ee101f7a7bc6a55248ad649bd',
      )
      expect(result).toEqual({
        project: 'acme/widgets',
        ref: '225a63dd1fa2b38ee101f7a7bc6a55248ad649bd',
      })
    })

    it('should parse project and short commit SHA', () => {
      const result = parseGitLabInput('acme/widgets', '225a63dd1')
      expect(result).toEqual({
        project: 'acme/widgets',
        ref: '225a63dd1',
      })
    })

    it('should parse project and branch name', () => {
      const result = parseGitLabInput('acme/widgets', 'deliberately-failing-pipeline')
      expect(result).toEqual({
        project: 'acme/widgets',
        ref: 'deliberately-failing-pipeline',
      })
    })

    it('should parse nested project paths', () => {
      const result = parseGitLabInput('group/subgroup/project', 'main')
      expect(result).toEqual({
        project: 'group/subgroup/project',
        ref: 'main',
      })
    })

    it('should handle refs with slashes', () => {
      const result = parseGitLabInput('acme/widgets', 'feature/awesome-feature')
      expect(result).toEqual({
        project: 'acme/widgets',
        ref: 'feature/awesome-feature',
      })
    })

    it('should trim whitespace', () => {
      const result = parseGitLabInput('  acme/widgets  ', '  main  ')
      expect(result).toEqual({
        project: 'acme/widgets',
        ref: 'main',
      })
    })
  })

  describe('invalid inputs', () => {
    it('should return null for single non-URL input', () => {
      const result = parseGitLabInput('acme/widgets')
      expect(result).toBeNull()
    })

    it('should return null for invalid URLs', () => {
      const result = parseGitLabInput('not-a-url')
      expect(result).toBeNull()
    })

    it("should return null for URLs that don't match GitLab patterns", () => {
      const result = parseGitLabInput('https://github.com/user/repo')
      expect(result).toBeNull()
    })
  })
})

describe('isValidProjectPath', () => {
  it('should accept valid project paths', () => {
    expect(isValidProjectPath('acme/widgets')).toBe(true)
    expect(isValidProjectPath('group/subgroup/project')).toBe(true)
    expect(isValidProjectPath('user123/my-project_2')).toBe(true)
    expect(isValidProjectPath('org.name/project.name')).toBe(true)
  })

  it('should reject invalid project paths', () => {
    expect(isValidProjectPath('no-slash')).toBe(false)
    expect(isValidProjectPath('')).toBe(false)
    expect(isValidProjectPath('/')).toBe(false)
    expect(isValidProjectPath('project/')).toBe(false)
    expect(isValidProjectPath('/project')).toBe(false)
    expect(isValidProjectPath('project with spaces/name')).toBe(false)
    expect(isValidProjectPath('project@invalid/name')).toBe(false)
  })
})

describe('isValidRef', () => {
  it('should accept valid refs', () => {
    expect(isValidRef('main')).toBe(true)
    expect(isValidRef('develop')).toBe(true)
    expect(isValidRef('feature/awesome')).toBe(true)
    expect(isValidRef('v1.2.3')).toBe(true)
    expect(isValidRef('abc123')).toBe(true)
    expect(isValidRef('225a63dd1fa2b38ee101f7a7bc6a55248ad649bd')).toBe(true)
    expect(isValidRef('release_1.0')).toBe(true)
  })

  it('should reject invalid refs', () => {
    expect(isValidRef('')).toBe(false)
    expect(isValidRef('ref with spaces')).toBe(false)
    expect(isValidRef('ref@invalid')).toBe(false)
    expect(isValidRef('a'.repeat(256))).toBe(false) // Too long
  })
})

describe('isLikelyCommitSha', () => {
  it('should identify commit SHAs', () => {
    expect(isLikelyCommitSha('225a63dd1fa2b38ee101f7a7bc6a55248ad649bd')).toBe(true)
    expect(isLikelyCommitSha('225a63dd1')).toBe(true)
    expect(isLikelyCommitSha('abcdef1234567')).toBe(true)
  })

  it('should not identify branch/tag names as SHAs', () => {
    expect(isLikelyCommitSha('main')).toBe(false)
    expect(isLikelyCommitSha('develop')).toBe(false)
    expect(isLikelyCommitSha('feature/awesome')).toBe(false)
    expect(isLikelyCommitSha('v1.2.3')).toBe(false)
    expect(isLikelyCommitSha('deliberately-failing-pipeline')).toBe(false)
    expect(isLikelyCommitSha('123abc')).toBe(false) // Too short
    expect(isLikelyCommitSha('g123456789012345678901234567890123456789')).toBe(false) // Contains non-hex
  })
})
