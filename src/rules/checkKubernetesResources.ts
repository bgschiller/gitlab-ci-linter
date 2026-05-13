import { type LintIssue } from '../types'
import { type ProcessedConfig } from '../ProcessedConfig'

interface KubernetesResourceVar {
  name: string
  value: string
  type: 'memory' | 'cpu'
  kind: 'request' | 'limit'
}

export function checkKubernetesResources(config: ProcessedConfig): LintIssue[] {
  const issues: LintIssue[] = []
  const jobs = config.getJobs()

  for (const [jobName, job] of Object.entries(jobs)) {
    // Skip template jobs
    if (jobName.startsWith('.')) {
      continue
    }

    // Get all variables (global + job-level)
    const allVariables = {
      ...config.getVariables(),
      ...job.variables,
    }

    // Check for Kubernetes resource configuration
    const kubernetesVars = extractKubernetesResourceVars(allVariables)

    if (kubernetesVars.length > 0) {
      // Validate resource limit configurations
      validateKubernetesResources(jobName, kubernetesVars, issues)
    }
  }

  return issues
}

function extractKubernetesResourceVars(variables: Record<string, string>): KubernetesResourceVar[] {
  const kubernetesVars: KubernetesResourceVar[] = []

  for (const [name, value] of Object.entries(variables)) {
    if (name.startsWith('KUBERNETES_')) {
      if (name.includes('MEMORY_')) {
        const kind = name.includes('_REQUEST') ? 'request' : 'limit'
        kubernetesVars.push({ name, value, type: 'memory', kind })
      } else if (name.includes('CPU_')) {
        const kind = name.includes('_REQUEST') ? 'request' : 'limit'
        kubernetesVars.push({ name, value, type: 'cpu', kind })
      }
    }
  }

  return kubernetesVars
}

function validateKubernetesResources(
  jobName: string,
  kubernetesVars: KubernetesResourceVar[],
  issues: LintIssue[],
): void {
  const memoryVars = kubernetesVars.filter(v => v.type === 'memory')
  const cpuVars = kubernetesVars.filter(v => v.type === 'cpu')

  // Validate memory configurations
  for (const memVar of memoryVars) {
    if (!isValidMemoryValue(memVar.value)) {
      issues.push({
        severity: 'error',
        message: `Job '${jobName}' has invalid Kubernetes memory ${memVar.kind} '${memVar.value}'. Expected format: number + unit (e.g., '1Gi', '512Mi', '2G')`,
        location: jobName,
      })
    }
  }

  // Validate CPU configurations
  for (const cpuVar of cpuVars) {
    if (!isValidCpuValue(cpuVar.value)) {
      issues.push({
        severity: 'error',
        message: `Job '${jobName}' has invalid Kubernetes CPU ${cpuVar.kind} '${cpuVar.value}'. Expected format: number or number with 'm' suffix (e.g., '2', '1.5', '500m')`,
        location: jobName,
      })
    }
  }

  // Check for memory request > limit
  const memoryRequest = memoryVars.find(v => v.kind === 'request')
  const memoryLimit = memoryVars.find(v => v.kind === 'limit')

  if (memoryRequest && memoryLimit) {
    const requestBytes = parseMemoryToBytes(memoryRequest.value)
    const limitBytes = parseMemoryToBytes(memoryLimit.value)

    if (requestBytes > limitBytes) {
      issues.push({
        severity: 'error',
        message: `Job '${jobName}' has memory request (${memoryRequest.value}) greater than memory limit (${memoryLimit.value})`,
        location: jobName,
      })
    }
  }

  // Check for CPU request > limit
  const cpuRequest = cpuVars.find(v => v.kind === 'request')
  const cpuLimit = cpuVars.find(v => v.kind === 'limit')

  if (cpuRequest && cpuLimit) {
    const requestCpu = parseCpuToMillicores(cpuRequest.value)
    const limitCpu = parseCpuToMillicores(cpuLimit.value)

    if (requestCpu > limitCpu) {
      issues.push({
        severity: 'error',
        message: `Job '${jobName}' has CPU request (${cpuRequest.value}) greater than CPU limit (${cpuLimit.value})`,
        location: jobName,
      })
    }
  }

  // Warn about very high resource requests
  checkForExcessiveResources(jobName, kubernetesVars, issues)
}

function isValidMemoryValue(value: string): boolean {
  // Convert to string if needed and check Kubernetes memory units
  const stringValue = typeof value === 'string' ? value : String(value)
  return /^\d+(\.\d+)?(E|P|T|G|M|K)i?$/.test(stringValue)
}

function isValidCpuValue(value: string): boolean {
  // Convert to string if needed
  const stringValue = typeof value === 'string' ? value : String(value)

  // CPU can be expressed as:
  // - Whole numbers: "2", "1" (cores)
  // - Decimal numbers: "1.5", "0.5" (cores)
  // - Millicores: "500m", "1500m" (millicore units)
  return /^\d+(\.\d+)?m?$/.test(stringValue)
}

function parseMemoryToBytes(value: string): number {
  // Convert value to string if it's not already
  const stringValue = typeof value === 'string' ? value : String(value)

  const match = stringValue.match(/^(\d+(?:\.\d+)?)(E|P|T|G|M|K)i?$/)
  if (!match) return 0

  const num = parseFloat(match[1] ?? '0')
  const unit = match[2]
  const isBinary = stringValue.endsWith('i')

  const multipliers = isBinary
    ? { K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4, P: 1024 ** 5, E: 1024 ** 6 }
    : { K: 1000, M: 1000 ** 2, G: 1000 ** 3, T: 1000 ** 4, P: 1000 ** 5, E: 1000 ** 6 }

  return num * (multipliers[unit as keyof typeof multipliers] || 1)
}

function parseCpuToMillicores(value: string): number {
  // Convert value to string if it's not already
  const stringValue = typeof value === 'string' ? value : String(value)

  if (stringValue.endsWith('m')) {
    return parseInt(stringValue.slice(0, -1))
  } else {
    return parseFloat(stringValue) * 1000
  }
}

function checkForExcessiveResources(
  jobName: string,
  kubernetesVars: KubernetesResourceVar[],
  issues: LintIssue[],
): void {
  // Warn about potentially excessive resource requests
  const memoryLimits = kubernetesVars.filter(v => v.type === 'memory' && v.kind === 'limit')
  const cpuLimits = kubernetesVars.filter(v => v.type === 'cpu' && v.kind === 'limit')

  for (const memVar of memoryLimits) {
    const bytes = parseMemoryToBytes(memVar.value)
    const gigabytes = bytes / 1024 ** 3

    if (gigabytes > 32) {
      issues.push({
        severity: 'warning',
        message: `Job '${jobName}' requests very high memory limit (${memVar.value}). Consider if this is necessary for the job`,
        location: jobName,
      })
    }
  }

  for (const cpuVar of cpuLimits) {
    const millicores = parseCpuToMillicores(cpuVar.value)
    const cores = millicores / 1000

    if (cores > 16) {
      issues.push({
        severity: 'warning',
        message: `Job '${jobName}' requests very high CPU limit (${cpuVar.value}). Consider if this is necessary for the job`,
        location: jobName,
      })
    }
  }
}
