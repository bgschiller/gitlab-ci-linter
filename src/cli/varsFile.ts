import { readFileSync } from 'fs'
import { extname } from 'path'
import { parse as parseYaml } from 'yaml'

/**
 * Load and parse a vars file (JSON or YAML format).
 * Detects format based on file extension.
 */
export function loadVarsFile(filePath: string): Record<string, unknown> {
  const content = readFileSync(filePath, 'utf8')
  const ext = extname(filePath).toLowerCase()
  const parsed: unknown =
    ext === '.yaml' || ext === '.yml' ? parseYaml(content) : JSON.parse(content)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError(`Vars file '${filePath}' did not parse to an object`)
  }
  return parsed as Record<string, unknown>
}

/**
 * Print a friendly error for a failed vars-file read and exit with the
 * given code. Distinguishes JSON syntax errors, missing files, YAML parse
 * errors, and miscellaneous IO errors.
 */
export function reportVarsFileError(varsFile: string, error: unknown, exitCode: 1 | 2): never {
  console.error(formatVarsFileError(varsFile, error))
  process.exit(exitCode)
}

function formatVarsFileError(varsFile: string, error: unknown): string {
  if (error instanceof SyntaxError) {
    return `Error: Invalid JSON in vars file '${varsFile}': ${error.message}`
  }
  if (hasErrnoCode(error, 'ENOENT')) {
    return `Error: Vars file not found: '${varsFile}'`
  }
  if (error instanceof Error && error.message.startsWith('Path not found')) {
    return `Error: Vars file not found: '${varsFile}'`
  }
  if (error instanceof Error && error.name === 'YAMLParseError') {
    return `Error: Invalid YAML in vars file '${varsFile}': ${error.message}`
  }
  return `Error reading vars file '${varsFile}': ${stringifyUnknown(error)}`
}

/**
 * Convert an unknown throwable to a human-readable string without falling
 * through to `Object.prototype.toString` (which produces `[object Object]`
 * for plain objects). Errors → `.message`; primitives → `String(x)`;
 * arbitrary objects → `JSON.stringify` with a `Object.prototype.toString`
 * fallback if the value is not serializable (circular refs, BigInt, etc.).
 */
export function stringifyUnknown(value: unknown): string {
  if (value instanceof Error) return value.message
  if (typeof value === 'string') return value
  if (typeof value === 'number') return value.toString()
  if (typeof value === 'boolean') return value.toString()
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  try {
    return JSON.stringify(value) ?? Object.prototype.toString.call(value)
  } catch {
    return Object.prototype.toString.call(value)
  }
}

function hasErrnoCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === code
  )
}

/**
 * Parse a `--var KEY=VALUE` accumulator value. Used as Commander's
 * collector callback so a repeated flag aggregates into a Record.
 */
export function collectVar(
  value: string,
  previous: Record<string, string>,
): Record<string, string> {
  const eq = value.indexOf('=')
  if (eq === -1) return previous
  return { ...previous, [value.slice(0, eq)]: value.slice(eq + 1) }
}

/**
 * Parse a comma-separated string list, trimming each element.
 * Used by `--changes`, `--jobs`, `--exclude-component-jobs`.
 */
export function parseCommaList(value: string): string[] {
  return value.split(',').map(s => s.trim())
}
