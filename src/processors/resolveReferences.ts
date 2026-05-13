import { type GitLabCI, type GitLabJob } from '../types'

export function resolveReferences(config: GitLabCI): GitLabCI {
  const resolveReferencesInObject = (obj: any): any => {
    if (Array.isArray(obj)) {
      // Use flatMap to properly flatten array references inline
      // When a !reference resolves to an array, its items should be spread into the parent array
      return obj.flatMap(item => {
        const resolved = resolveReferencesInObject(item)
        // Check if this was a reference that resolved to an array - flatten it
        if (
          item &&
          typeof item === 'object' &&
          item.__gitlab_reference &&
          Array.isArray(resolved)
        ) {
          return resolved
        }
        return [resolved]
      })
    } else if (obj && typeof obj === 'object') {
      if (obj.__gitlab_reference) {
        // This is a !reference tag - resolve it
        const { job: jobName, section, key } = obj
        const referencedJob = config[jobName] as GitLabJob

        if (referencedJob && referencedJob[section]) {
          if (
            key &&
            referencedJob[section] &&
            typeof referencedJob[section] === 'object' &&
            referencedJob[section][key]
          ) {
            return referencedJob[section][key]
          }
          return referencedJob[section]
        }

        // If reference can't be resolved, return placeholder
        console.warn(
          `Warning: Could not resolve reference to ${jobName}.${section}${key ? `.${key}` : ''}`,
        )
        return null
      }

      // Process regular objects
      const result: any = {}
      for (const [key, value] of Object.entries(obj)) {
        result[key] = resolveReferencesInObject(value)
      }
      return result
    }

    return obj
  }

  return resolveReferencesInObject(config)
}
