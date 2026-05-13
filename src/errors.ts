/**
 * Custom error types for gitlab-ci-linter with enhanced context information.
 */

export interface YamlErrorContext {
  /** The file path where the error occurred */
  filePath: string
  /** Line number if available */
  line?: number
  /** Column number if available */
  column?: number
  /** The include stack leading to this file */
  includeStack?: string[]
}

/**
 * Error thrown when YAML parsing fails.
 * Includes file path and position information for better debugging.
 */
export class YamlParseError extends Error {
  public readonly filePath: string
  public readonly line?: number
  public readonly column?: number
  public readonly includeStack: string[]
  public readonly originalError: Error

  constructor(message: string, context: YamlErrorContext, originalError: Error) {
    // Build a detailed message with context
    let detailedMessage = `YAML parse error in '${context.filePath}'`

    if (context.line !== undefined) {
      detailedMessage += ` at line ${context.line}`
      if (context.column !== undefined) {
        detailedMessage += `, column ${context.column}`
      }
    }

    detailedMessage += `:\n  ${message}`

    if (context.includeStack && context.includeStack.length > 0) {
      detailedMessage += `\n\nInclude stack:\n  ${context.includeStack.join('\n  → ')}\n  → ${context.filePath}`
    }

    super(detailedMessage)
    this.name = 'YamlParseError'
    this.filePath = context.filePath
    this.line = context.line
    this.column = context.column
    this.includeStack = context.includeStack || []
    this.originalError = originalError

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, YamlParseError)
    }
  }
}

/**
 * Error thrown when an include cannot be resolved.
 */
export class IncludeResolutionError extends Error {
  public readonly includePath: string
  public readonly includeType: string
  public readonly includeStack: string[]

  constructor(includePath: string, includeType: string, includeStack: string[], reason?: string) {
    let message = `Failed to resolve ${includeType} include '${includePath}'`

    if (reason) {
      message += `: ${reason}`
    }

    if (includeStack.length > 0) {
      message += `\n\nInclude stack:\n  ${includeStack.join('\n  → ')}`
    }

    super(message)
    this.name = 'IncludeResolutionError'
    this.includePath = includePath
    this.includeType = includeType
    this.includeStack = includeStack

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, IncludeResolutionError)
    }
  }
}

/**
 * Extract line and column information from a YAML error.
 * The yaml library includes position info in the error message.
 */
export function extractYamlErrorPosition(error: Error): { line?: number; column?: number } {
  const message = error.message

  // Pattern: "at line X, column Y" or "(X:Y)"
  const lineColMatch = message.match(/(?:at line |line )(\d+)(?:,? column |:)(\d+)/i)
  if (lineColMatch) {
    return {
      line: parseInt(lineColMatch[1]!, 10),
      column: parseInt(lineColMatch[2]!, 10),
    }
  }

  // Pattern: just line number
  const lineMatch = message.match(/(?:at line |line )(\d+)/i)
  if (lineMatch) {
    return {
      line: parseInt(lineMatch[1]!, 10),
    }
  }

  return {}
}
