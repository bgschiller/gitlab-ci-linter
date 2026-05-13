/**
 * Narrow Commander's loose `opts` blob to typed values. Each helper returns
 * `undefined` (or the empty default) when the key is missing or holds the
 * wrong runtime type — keeps per-command actions free of `typeof x === 'y'
 * ? (x as Y) : undefined` boilerplate.
 */

type Opts = Record<string, unknown>

export function getString(opts: Opts, key: string): string | undefined {
  const v = opts[key]
  return typeof v === 'string' ? v : undefined
}

export function getBool(opts: Opts, key: string): boolean {
  return opts[key] === true
}

export function getStringArray(opts: Opts, key: string): string[] | undefined {
  const v = opts[key]
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : undefined
}

export function getNumber(opts: Opts, key: string): number | undefined {
  const v = opts[key]
  return typeof v === 'number' ? v : undefined
}

/**
 * Read a `--var KEY=VALUE`-style accumulator value. Returns the empty
 * record when the key is missing or not an object. The values are typed as
 * `string` even though we only validate the container shape — the
 * collector (see {@link collectVar}) guarantees string values.
 */
export function getStringRecord(opts: Opts, key: string): Record<string, string> {
  const v = opts[key]
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  return v as Record<string, string>
}
