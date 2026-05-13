import type { GitLabCI } from '../types'

export function expandVariables(config: GitLabCI): GitLabCI {
  const variables = config.variables || {}

  const expandValue = (value: string): string => {
    return value.replace(/\$\{?([A-Z_][A-Z0-9_]*)\}?/g, (match, varName) => {
      return (
        (Object.prototype.hasOwnProperty.call(variables, varName) ? variables[varName] : match) ??
        ''
      )
    })
  }

  const expandObject = (obj: unknown): unknown => {
    if (typeof obj === 'string') {
      return expandValue(obj)
    } else if (Array.isArray(obj)) {
      return obj.map(expandObject)
    } else if (obj && typeof obj === 'object') {
      const result: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(obj)) {
        result[key] = expandObject(value)
      }
      return result
    }
    return obj
  }

  return expandObject(config) as GitLabCI
}
