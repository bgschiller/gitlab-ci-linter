import type { CollectionTag, ParsedNode, YAMLMap, YAMLSeq } from 'yaml'
import { parse, parseAllDocuments } from 'yaml'
import type { GitLabCI } from '../types'
import { extractYamlErrorPosition, YamlParseError } from '../errors'

export interface ParseOptions {
  /** File path for error reporting */
  filePath?: string
  /** Include stack for error context */
  includeStack?: string[]
}

export function parseWithCustomTags(content: string, options?: ParseOptions): GitLabCI {
  // Define custom !reference tag
  const referenceTag = {
    tag: '!reference',
    collection: 'seq' as const,
    identify: (_value: unknown) => false, // We don't identify JS values as references, only parse them
    resolve: (seq: YAMLMap.Parsed<ParsedNode, ParsedNode | null> | YAMLSeq.Parsed<ParsedNode>) => {
      if (seq.items.length < 2) {
        throw new Error('!reference requires at least [job, section]')
      }
      // seq is a YAMLSeq, convert to array
      const items = seq.items.map(item => {
        if (!('value' in item)) {
          throw new Error('!reference must be used with a sequence')
        }
        return item.value
      })

      return {
        __gitlab_reference: true,
        job: items[0],
        section: items[1],
        key: items[2], // optional third element
      }
    },
  } satisfies CollectionTag

  const parseOptions = {
    customTags: [referenceTag],
    merge: true,
  }

  try {
    // Support multi-document YAML files (e.g. spec: inputs followed by --- and the CI config).
    // GitLab uses the last document as the pipeline configuration; the first document(s) contain
    // metadata like `spec:` for optional input parameters.
    if (content.includes('\n---\n') || content.includes('\n---\r\n')) {
      const docs = parseAllDocuments(content, parseOptions)
      if (docs.length > 1) {
        const lastDoc = docs[docs.length - 1]!
        return lastDoc.toJSON() as GitLabCI
      }
    }
    return parse(content, parseOptions)
  } catch (error) {
    // If we have file path info, wrap the error with context
    if (options?.filePath && error instanceof Error) {
      const { line, column } = extractYamlErrorPosition(error)
      throw new YamlParseError(
        error.message,
        {
          filePath: options.filePath,
          line,
          column,
          includeStack: options.includeStack,
        },
        error,
      )
    }
    // Re-throw original error if no context available
    throw error
  }
}
