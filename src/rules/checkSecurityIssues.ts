import type { LintIssue } from '../types'
import type { ProcessedConfig } from '../ProcessedConfig'

export function checkSecurityIssues(config: ProcessedConfig): LintIssue[] {
  const issues: LintIssue[] = []
  const jobs = config.getJobs()
  const variables = config.getVariables()

  // Check global variables for security issues
  for (const [varName, varValue] of Object.entries(variables)) {
    checkVariableForSecurityIssues(varName, varValue, 'global variables', issues)
  }

  // Check each job for security issues
  for (const [jobName, job] of Object.entries(jobs)) {
    // Check job variables
    if (job.variables) {
      for (const [varName, varValue] of Object.entries(job.variables)) {
        checkVariableForSecurityIssues(varName, varValue, `job '${jobName}'`, issues)
      }
    }

    // Check scripts for security issues
    const scriptSections = ['script', 'before_script', 'after_script']
    for (const section of scriptSections) {
      const scripts = job[section] as string[] | undefined
      if (scripts) {
        for (let i = 0; i < scripts.length; i++) {
          const script = scripts[i]
          checkScriptForSecurityIssues(script, jobName, section, i, issues)
        }
      }
    }
  }

  return issues
}

function checkVariableForSecurityIssues(
  varName: string,
  varValue: string,
  location: string,
  issues: LintIssue[],
): void {
  // Check for hardcoded credentials based on variable names and values
  const suspiciousNames = [
    'password',
    'passwd',
    'pwd',
    'secret',
    'key',
    'token',
    'auth',
    'api_key',
    'access_key',
    'private_key',
    'client_secret',
    'credential',
  ]

  const varNameLower = varName.toLowerCase()
  const isSuspiciousName = suspiciousNames.some(name => varNameLower.includes(name))

  if (isSuspiciousName && !isLikelySecureVariable(varValue)) {
    // Check if it looks like a hardcoded credential (not a CI variable reference)
    if (isLikelyHardcodedCredential(varValue)) {
      issues.push({
        severity: 'error',
        message: `Variable '${varName}' in ${location} appears to contain hardcoded credentials`,
        location: location.includes('job') ? location.split("'")[1] : undefined,
      })
    }
  }
}

function checkScriptForSecurityIssues(
  script: any,
  jobName: string,
  section: string,
  index: number,
  issues: LintIssue[],
): void {
  // Ensure script is a string
  if (typeof script !== 'string') {
    return
  }

  // Check for insecure curl commands
  if (script.includes('curl')) {
    const insecureCurlPatterns = [
      /curl\s+[^|&;]*-k\b/, // curl -k (ignore SSL errors)
      /curl\s+[^|&;]*--insecure\b/, // curl --insecure
      /curl\s+[^|&;]*--no-check-certificate\b/, // curl --no-check-certificate (wget)
    ]

    for (const pattern of insecureCurlPatterns) {
      if (pattern.test(script)) {
        issues.push({
          severity: 'warning',
          message: `Insecure curl command in job '${jobName}' ${section} (line ${index + 1}): curl with -k/--insecure disables certificate verification`,
          location: jobName,
        })
        break // Only report once per script line
      }
    }
  }

  // Check for wget with insecure options
  if (script.includes('wget') && /wget\s+[^|&;]*--no-check-certificate\b/.test(script)) {
    issues.push({
      severity: 'warning',
      message: `Insecure wget command in job '${jobName}' ${section} (line ${index + 1}): wget with --no-check-certificate disables certificate verification`,
      location: jobName,
    })
  }

  // Check for dangerous eval patterns
  const dangerousEvalPatterns = [
    /eval\s+\$\{[^}]*\}/, // eval ${variable}
    /eval\s+"\$[^"]*"/, // eval "$variable"
    /eval\s+`[^`]*`/, // eval `command`
    /\|\s*sh\s*$/, // | sh at end of line
    /\|\s*bash\s*$/, // | bash at end of line
    /curl\s+[^|&;]*\|\s*sh/, // curl ... | sh
    /wget\s+[^|&;]*-O\s*-\s*[^|&;]*\|\s*sh/, // wget ... -O - ... | sh
  ]

  for (const pattern of dangerousEvalPatterns) {
    if (pattern.test(script)) {
      issues.push({
        severity: 'error',
        message: `Dangerous code execution pattern in job '${jobName}' ${section} (line ${index + 1}): potential security risk`,
        location: jobName,
      })
      break // Only report once per script line
    }
  }
}

function isLikelySecureVariable(value: string): boolean {
  // Check if the variable looks like it references a CI/CD variable or is protected
  const securePatterns = [
    /^\$CI_/, // GitLab CI variables
    /^\$\{CI_/, // GitLab CI variables in braces
    /^\$GL_/, // GitLab variables
    /^\$\{GL_/, // GitLab variables in braces
    /^\$\w+$/, // Any variable reference
    /^\$\{\w+\}$/, // Any variable reference in braces
    /^file:/, // File-based secrets
    /^vault:/, // Vault references
  ]

  return securePatterns.some(pattern => pattern.test(value))
}

function isLikelyHardcodedCredential(value: string): boolean {
  // Check if the value looks like a hardcoded credential (not a variable reference)
  if (isLikelySecureVariable(value)) {
    return false
  }

  // Check for patterns that look like hardcoded credentials
  const hardcodedPatterns = [
    /^[a-fA-F0-9]{32,}$/, // Hex strings (32+ chars)
    /^[a-zA-Z0-9+/]{20,}={0,2}$/, // Base64-like strings
    /^[a-zA-Z0-9._-]{40,}$/, // Long alphanumeric strings
    /^ghp_[a-zA-Z0-9]{36}$/, // GitHub personal access token
    /^gho_[a-zA-Z0-9]{36}$/, // GitHub OAuth token
    /^ghu_[a-zA-Z0-9]{36}$/, // GitHub user token
    /^ghs_[a-zA-Z0-9]{36}$/, // GitHub server token
    /^glpat-[a-zA-Z0-9_-]{20}$/, // GitLab personal access token
  ]

  return hardcodedPatterns.some(pattern => pattern.test(value))
}
