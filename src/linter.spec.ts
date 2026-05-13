import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Linter } from './linter'
import type { ProcessedConfig } from './ProcessedConfig'
import type { LintIssue } from './types'
import { checkManualJobs } from './rules/checkManualJobs'
import { checkJobStageAssignments } from './rules/checkJobStageAssignments'
import { checkCircularDependencies } from './rules/checkCircularDependencies'
import { checkDependencyRules } from './rules/checkDependencyRules'
import { checkArtifactPaths } from './rules/checkArtifactPaths'
import { checkConflictingRules } from './rules/checkConflictingRules'
import { checkMissingDependencies } from './rules/checkMissingDependencies'
import { checkConditionalDependencies } from './rules/checkConditionalDependencies'
import { checkKubernetesResources } from './rules/checkKubernetesResources'
import { checkSecurityIssues } from './rules/checkSecurityIssues'
import { checkInvalidNeeds } from './rules/checkInvalidNeeds'

// Mock all rule modules
vi.mock('./rules/checkManualJobs', () => ({
  checkManualJobs: vi.fn(),
}))
vi.mock('./rules/checkJobStageAssignments', () => ({
  checkJobStageAssignments: vi.fn(),
}))
vi.mock('./rules/checkCircularDependencies', () => ({
  checkCircularDependencies: vi.fn(),
}))
vi.mock('./rules/checkDependencyRules', () => ({
  checkDependencyRules: vi.fn(),
}))
vi.mock('./rules/checkArtifactPaths', () => ({
  checkArtifactPaths: vi.fn(),
}))
vi.mock('./rules/checkConflictingRules', () => ({
  checkConflictingRules: vi.fn(),
}))
vi.mock('./rules/checkMissingDependencies', () => ({
  checkMissingDependencies: vi.fn(),
}))
vi.mock('./rules/checkConditionalDependencies', () => ({
  checkConditionalDependencies: vi.fn(),
}))
vi.mock('./rules/checkKubernetesResources', () => ({
  checkKubernetesResources: vi.fn(),
}))
vi.mock('./rules/checkSecurityIssues', () => ({
  checkSecurityIssues: vi.fn(),
}))
vi.mock('./rules/checkInvalidNeeds', () => ({
  checkInvalidNeeds: vi.fn(),
}))

describe('Linter', () => {
  let mockProcessedConfig: ProcessedConfig

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks()

    // Create a minimal mock ProcessedConfig
    mockProcessedConfig = {
      config: {},
      context: {
        filePath: '',
        baseDir: '',
        includedFiles: new Set(),
        includeStack: [],
        remoteJobs: new Set(),
        gitlabHost: 'gitlab.example.com',
      },
      getJobs: vi.fn().mockReturnValue({}),
      getStages: vi.fn().mockReturnValue([]),
      getVariables: vi.fn().mockReturnValue({}),
      getWorkflow: vi.fn().mockReturnValue(undefined),
      isRemoteJob: vi.fn().mockReturnValue(false),
      getRemoteJobs: vi.fn().mockReturnValue(new Set()),
    }
  })

  describe('constructor', () => {
    it('should create linter with default options', () => {
      const linter = new Linter()
      expect(linter).toBeDefined()
    })

    it('should create linter with custom options', () => {
      const options = {
        severityLevel: 'error' as const,
        enabledRules: ['manual-jobs'],
        disabledRules: ['security-issues'],
      }
      const linter = new Linter(options)
      expect(linter).toBeDefined()
    })
  })

  describe('getAvailableRules', () => {
    it('should return all available rule names', () => {
      const linter = new Linter()
      const rules = linter.getAvailableRules()

      expect(rules).toEqual([
        'manual-jobs',
        'job-stage-assignments',
        'circular-dependencies',
        'dependency-rules',
        'artifact-paths',
        'conflicting-rules',
        'missing-dependencies',
        'conditional-dependencies',
        'kubernetes-resources',
        'security-issues',
        'invalid-needs',
        'unknown-keys',
      ])
    })
  })

  describe('lint', () => {
    it('should run all rules by default', () => {
      const linter = new Linter()

      // Mock each rule to return an empty array
      vi.mocked(checkManualJobs).mockReturnValue([])
      vi.mocked(checkJobStageAssignments).mockReturnValue([])
      vi.mocked(checkCircularDependencies).mockReturnValue([])
      vi.mocked(checkDependencyRules).mockReturnValue([])
      vi.mocked(checkArtifactPaths).mockReturnValue([])
      vi.mocked(checkConflictingRules).mockReturnValue([])
      vi.mocked(checkMissingDependencies).mockReturnValue([])
      vi.mocked(checkConditionalDependencies).mockReturnValue([])
      vi.mocked(checkKubernetesResources).mockReturnValue([])
      vi.mocked(checkSecurityIssues).mockReturnValue([])
      vi.mocked(checkInvalidNeeds).mockReturnValue([])

      const issues = linter.lint(mockProcessedConfig)

      expect(issues).toEqual([])
      expect(checkManualJobs).toHaveBeenCalledWith(mockProcessedConfig)
      expect(checkJobStageAssignments).toHaveBeenCalledWith(mockProcessedConfig)
      expect(checkCircularDependencies).toHaveBeenCalledWith(mockProcessedConfig)
      expect(checkDependencyRules).toHaveBeenCalledWith(mockProcessedConfig)
      expect(checkArtifactPaths).toHaveBeenCalledWith(mockProcessedConfig)
      expect(checkConflictingRules).toHaveBeenCalledWith(mockProcessedConfig)
      expect(checkMissingDependencies).toHaveBeenCalledWith(mockProcessedConfig)
      expect(checkConditionalDependencies).toHaveBeenCalledWith(mockProcessedConfig)
      expect(checkKubernetesResources).toHaveBeenCalledWith(mockProcessedConfig)
      expect(checkSecurityIssues).toHaveBeenCalledWith(mockProcessedConfig)
    })

    it('should collect issues from all rules', () => {
      const linter = new Linter()

      const mockIssue1: LintIssue = {
        severity: 'warning',
        message: 'Manual job without allow_failure',
      }

      const mockIssue2: LintIssue = {
        severity: 'error',
        message: 'Job references invalid stage',
      }

      // Mock rules to return different issues
      vi.mocked(checkManualJobs).mockReturnValue([mockIssue1])
      vi.mocked(checkJobStageAssignments).mockReturnValue([mockIssue2])
      vi.mocked(checkCircularDependencies).mockReturnValue([])
      vi.mocked(checkDependencyRules).mockReturnValue([])
      vi.mocked(checkArtifactPaths).mockReturnValue([])
      vi.mocked(checkConflictingRules).mockReturnValue([])
      vi.mocked(checkMissingDependencies).mockReturnValue([])
      vi.mocked(checkConditionalDependencies).mockReturnValue([])
      vi.mocked(checkKubernetesResources).mockReturnValue([])
      vi.mocked(checkSecurityIssues).mockReturnValue([])
      vi.mocked(checkInvalidNeeds).mockReturnValue([])

      const issues = linter.lint(mockProcessedConfig)

      expect(issues).toEqual([mockIssue1, mockIssue2])
    })

    it('should handle rule execution errors gracefully', () => {
      const linter = new Linter()
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
        /* empty */
      })

      // Mock one rule to throw an error
      vi.mocked(checkManualJobs).mockImplementation(() => {
        throw new Error('Rule execution failed')
      })
      vi.mocked(checkJobStageAssignments).mockReturnValue([])
      vi.mocked(checkCircularDependencies).mockReturnValue([])
      vi.mocked(checkDependencyRules).mockReturnValue([])
      vi.mocked(checkArtifactPaths).mockReturnValue([])
      vi.mocked(checkConflictingRules).mockReturnValue([])
      vi.mocked(checkMissingDependencies).mockReturnValue([])
      vi.mocked(checkConditionalDependencies).mockReturnValue([])
      vi.mocked(checkKubernetesResources).mockReturnValue([])
      vi.mocked(checkSecurityIssues).mockReturnValue([])
      vi.mocked(checkInvalidNeeds).mockReturnValue([])

      const issues = linter.lint(mockProcessedConfig)

      expect(issues).toEqual([])
      expect(consoleSpy).toHaveBeenCalledWith(
        "Warning: Rule 'manual-jobs' failed to execute: Error: Rule execution failed",
      )

      consoleSpy.mockRestore()
    })
  })

  describe('rule filtering', () => {
    it('should only run enabled rules when enabledRules is specified', () => {
      const linter = new Linter({ enabledRules: ['manual-jobs', 'circular-dependencies'] })

      vi.mocked(checkManualJobs).mockReturnValue([])
      vi.mocked(checkCircularDependencies).mockReturnValue([])

      linter.lint(mockProcessedConfig)

      expect(checkManualJobs).toHaveBeenCalledWith(mockProcessedConfig)
      expect(checkCircularDependencies).toHaveBeenCalledWith(mockProcessedConfig)
      expect(checkJobStageAssignments).not.toHaveBeenCalled()
      expect(checkDependencyRules).not.toHaveBeenCalled()
      expect(checkArtifactPaths).not.toHaveBeenCalled()
      expect(checkConflictingRules).not.toHaveBeenCalled()
      expect(checkMissingDependencies).not.toHaveBeenCalled()
      expect(checkConditionalDependencies).not.toHaveBeenCalled()
      expect(checkKubernetesResources).not.toHaveBeenCalled()
      expect(checkSecurityIssues).not.toHaveBeenCalled()
    })

    it('should skip disabled rules when disabledRules is specified', () => {
      const linter = new Linter({ disabledRules: ['manual-jobs', 'security-issues'] })

      // Mock all rules to return empty arrays
      vi.mocked(checkManualJobs).mockReturnValue([])
      vi.mocked(checkJobStageAssignments).mockReturnValue([])
      vi.mocked(checkCircularDependencies).mockReturnValue([])
      vi.mocked(checkDependencyRules).mockReturnValue([])
      vi.mocked(checkArtifactPaths).mockReturnValue([])
      vi.mocked(checkConflictingRules).mockReturnValue([])
      vi.mocked(checkMissingDependencies).mockReturnValue([])
      vi.mocked(checkConditionalDependencies).mockReturnValue([])
      vi.mocked(checkKubernetesResources).mockReturnValue([])
      vi.mocked(checkSecurityIssues).mockReturnValue([])
      vi.mocked(checkInvalidNeeds).mockReturnValue([])

      linter.lint(mockProcessedConfig)

      expect(checkManualJobs).not.toHaveBeenCalled()
      expect(checkSecurityIssues).not.toHaveBeenCalled()
      expect(checkJobStageAssignments).toHaveBeenCalledWith(mockProcessedConfig)
      expect(checkCircularDependencies).toHaveBeenCalledWith(mockProcessedConfig)
      expect(checkDependencyRules).toHaveBeenCalledWith(mockProcessedConfig)
      expect(checkArtifactPaths).toHaveBeenCalledWith(mockProcessedConfig)
      expect(checkConflictingRules).toHaveBeenCalledWith(mockProcessedConfig)
      expect(checkMissingDependencies).toHaveBeenCalledWith(mockProcessedConfig)
      expect(checkConditionalDependencies).toHaveBeenCalledWith(mockProcessedConfig)
      expect(checkKubernetesResources).toHaveBeenCalledWith(mockProcessedConfig)
    })
  })

  describe('severity filtering', () => {
    beforeEach(() => {
      // Set up all rules to return empty arrays by default
      vi.mocked(checkManualJobs).mockReturnValue([])
      vi.mocked(checkJobStageAssignments).mockReturnValue([])
      vi.mocked(checkCircularDependencies).mockReturnValue([])
      vi.mocked(checkDependencyRules).mockReturnValue([])
      vi.mocked(checkArtifactPaths).mockReturnValue([])
      vi.mocked(checkConflictingRules).mockReturnValue([])
      vi.mocked(checkMissingDependencies).mockReturnValue([])
      vi.mocked(checkConditionalDependencies).mockReturnValue([])
      vi.mocked(checkKubernetesResources).mockReturnValue([])
      vi.mocked(checkSecurityIssues).mockReturnValue([])
      vi.mocked(checkInvalidNeeds).mockReturnValue([])
    })

    it('should return all issues when no severity filter is specified', () => {
      const linter = new Linter()

      const issues: LintIssue[] = [
        { severity: 'error', message: 'Error' },
        { severity: 'warning', message: 'Warning' },
        { severity: 'info', message: 'Info' },
      ]

      vi.mocked(checkManualJobs).mockReturnValue(issues)

      const result = linter.lint(mockProcessedConfig)

      expect(result).toEqual(issues)
    })

    it('should filter to error level only', () => {
      const linter = new Linter({ severityLevel: 'error' })

      const issues: LintIssue[] = [
        { severity: 'error', message: 'Error' },
        { severity: 'warning', message: 'Warning' },
        { severity: 'info', message: 'Info' },
      ]

      vi.mocked(checkManualJobs).mockReturnValue(issues)

      const result = linter.lint(mockProcessedConfig)

      expect(result).toEqual([issues[0]]) // Only error
    })

    it('should filter to warning level and above', () => {
      const linter = new Linter({ severityLevel: 'warning' })

      const issues: LintIssue[] = [
        { severity: 'error', message: 'Error' },
        { severity: 'warning', message: 'Warning' },
        { severity: 'info', message: 'Info' },
      ]

      vi.mocked(checkManualJobs).mockReturnValue(issues)

      const result = linter.lint(mockProcessedConfig)

      expect(result).toEqual([issues[0], issues[1]]) // Error and warning
    })

    it('should filter to info level and above (all issues)', () => {
      const linter = new Linter({ severityLevel: 'info' })

      const issues: LintIssue[] = [
        { severity: 'error', message: 'Error' },
        { severity: 'warning', message: 'Warning' },
        { severity: 'info', message: 'Info' },
      ]

      vi.mocked(checkManualJobs).mockReturnValue(issues)

      const result = linter.lint(mockProcessedConfig)

      expect(result).toEqual(issues) // All issues
    })
  })

  describe('combined options', () => {
    it('should apply both rule filtering and severity filtering', () => {
      const linter = new Linter({
        enabledRules: ['manual-jobs'],
        severityLevel: 'warning',
      })

      const issues: LintIssue[] = [
        { severity: 'error', message: 'Error' },
        { severity: 'warning', message: 'Warning' },
        { severity: 'info', message: 'Info' },
      ]

      vi.mocked(checkManualJobs).mockReturnValue(issues)

      const result = linter.lint(mockProcessedConfig)

      expect(result).toEqual([issues[0], issues[1]]) // Error and warning only
      expect(checkManualJobs).toHaveBeenCalledWith(mockProcessedConfig)
      expect(checkJobStageAssignments).not.toHaveBeenCalled()
    })
  })
})
