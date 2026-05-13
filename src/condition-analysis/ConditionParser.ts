import {
  type ComparisonOperator,
  type LogicalOperator,
  type ParsedCondition,
  type ParsingError,
  type Token,
  TokenType,
  type UnaryOperator,
} from './types.js'

/**
 * Tokenizes a GitLab CI condition string into tokens for parsing
 */
class ConditionLexer {
  private input: string
  private position = 0
  private currentChar: string | null

  constructor(input: string) {
    this.input = input.trim()
    this.currentChar = this.input.length > 0 ? (this.input[0] ?? null) : null
  }

  private advance(): void {
    this.position++
    this.currentChar =
      this.position < this.input.length ? (this.input[this.position] ?? null) : null
  }

  private peek(offset = 1): string | null {
    const peekPos = this.position + offset
    return peekPos < this.input.length ? (this.input[peekPos] ?? null) : null
  }

  private skipWhitespace(): void {
    while (this.currentChar && /\s/.test(this.currentChar)) {
      this.advance()
    }
  }

  private readString(quote: string): string {
    let result = ''
    this.advance() // Skip opening quote

    while (this.currentChar && this.currentChar !== quote) {
      if (this.currentChar === '\\') {
        this.advance() // Skip backslash
        if (this.currentChar) {
          // Handle escaped characters
          const escapedChar: string = this.currentChar
          switch (escapedChar) {
            case 'n':
              result += '\n'
              break
            case 't':
              result += '\t'
              break
            case 'r':
              result += '\r'
              break
            case '\\':
              result += '\\'
              break
            case '"':
              result += '"'
              break
            case "'":
              result += "'"
              break
            default:
              result += escapedChar
              break
          }
          this.advance()
        }
      } else {
        result += this.currentChar
        this.advance()
      }
    }

    if (this.currentChar === quote) {
      this.advance() // Skip closing quote
    } else {
      throw this.createError(`Unterminated string starting with ${quote}`)
    }

    return result
  }

  private readRegex(): string {
    let result = ''
    this.advance() // Skip opening /

    while (this.currentChar && this.currentChar !== '/') {
      if (this.currentChar === '\\') {
        result += this.currentChar
        this.advance()
        if (this.currentChar) {
          result += this.currentChar
          this.advance()
        }
      } else {
        result += this.currentChar
        this.advance()
      }
    }

    if (this.currentChar === '/') {
      this.advance() // Skip closing /
    } else {
      throw this.createError('Unterminated regex literal')
    }

    return result
  }

  private readVariable(): string {
    let result = ''

    if (this.currentChar === '$') {
      result += this.currentChar
      this.advance()

      // Handle ${VAR} syntax
      if ((this.currentChar as string | null) === '{') {
        result += this.currentChar
        this.advance()

        while (this.currentChar && (this.currentChar as string) !== '}') {
          result += this.currentChar
          this.advance()
        }

        if ((this.currentChar as string | null) === '}') {
          result += this.currentChar
          this.advance()
        } else {
          throw this.createError('Unterminated variable expression ${...}')
        }
      } else {
        // Handle $VAR syntax
        while (this.currentChar && /[A-Z0-9_]/.test(this.currentChar)) {
          result += this.currentChar
          this.advance()
        }
      }
    }

    return result
  }

  private readOperator(): string {
    let result = ''
    const start = this.currentChar!

    if (start === '=' || start === '!' || start === '>' || start === '<') {
      result += start
      this.advance()

      if (this.currentChar === '=') {
        result += this.currentChar
        this.advance()
      } else if (start === '=' && this.currentChar === '~') {
        result += this.currentChar
        this.advance()
      } else if (start === '!' && this.currentChar === '~') {
        result += this.currentChar
        this.advance()
      }
    } else if (start === '&' && this.peek() === '&') {
      result = '&&'
      this.advance()
      this.advance()
    } else if (start === '|' && this.peek() === '|') {
      result = '||'
      this.advance()
      this.advance()
    }

    return result
  }

  private isRegexContext(tokens: Token[]): boolean {
    // A slash should be treated as regex delimiter if it follows =~ or !~
    if (tokens.length === 0) return false

    const lastToken = tokens[tokens.length - 1]
    return (
      lastToken !== undefined &&
      lastToken.type === TokenType.COMPARISON_OP &&
      (lastToken.value === '=~' || lastToken.value === '!~')
    )
  }

  private createError(message: string): ParsingError {
    const error = new Error(message) as ParsingError
    error.position = this.position
    error.name = 'ParsingError'
    return error
  }

  tokenize(): Token[] {
    const tokens: Token[] = []

    while (this.currentChar !== null) {
      this.skipWhitespace()

      if (this.currentChar === null) break

      const position = this.position

      if (this.currentChar === '"' || this.currentChar === "'") {
        const quote = this.currentChar
        const value = this.readString(quote)
        tokens.push({ type: TokenType.STRING, value, position })
      } else if (this.currentChar === '/' && this.isRegexContext(tokens)) {
        const value = this.readRegex()
        tokens.push({ type: TokenType.STRING, value, position })
      } else if (this.currentChar === '$') {
        const value = this.readVariable()
        tokens.push({ type: TokenType.VARIABLE, value, position })
      } else if (this.currentChar === '(') {
        tokens.push({ type: TokenType.LPAREN, value: '(', position })
        this.advance()
      } else if (this.currentChar === ')') {
        tokens.push({ type: TokenType.RPAREN, value: ')', position })
        this.advance()
      } else if (this.currentChar === '!') {
        if (this.peek() === '=' || this.peek() === '~') {
          const value = this.readOperator()
          tokens.push({ type: TokenType.COMPARISON_OP, value, position })
        } else {
          tokens.push({ type: TokenType.UNARY_OP, value: '!', position })
          this.advance()
        }
      } else if ('=<>'.includes(this.currentChar)) {
        const value = this.readOperator()
        tokens.push({ type: TokenType.COMPARISON_OP, value, position })
      } else if (this.currentChar === '&' || this.currentChar === '|') {
        const value = this.readOperator()
        if (value === '&&' || value === '||') {
          tokens.push({ type: TokenType.LOGICAL_OP, value, position })
        } else {
          throw this.createError(`Invalid operator: ${value}`)
        }
      } else if (this.input.substring(this.position, this.position + 4) === 'null') {
        tokens.push({ type: TokenType.NULL, value: 'null', position })
        this.position += 4
        this.currentChar =
          this.position < this.input.length ? (this.input[this.position] ?? null) : null
      } else {
        // Try to read as an unquoted string/identifier
        let value = ''
        while (this.currentChar && /[a-zA-Z0-9_.-]/.test(this.currentChar)) {
          value += this.currentChar
          this.advance()
        }

        if (value) {
          if (value === 'null') {
            tokens.push({ type: TokenType.NULL, value, position })
          } else {
            tokens.push({ type: TokenType.STRING, value, position })
          }
        } else {
          tokens.push({ type: TokenType.UNKNOWN, value: this.currentChar, position })
          this.advance()
        }
      }
    }

    tokens.push({ type: TokenType.EOF, value: '', position: this.position })
    return tokens
  }
}

/**
 * Recursive descent parser for GitLab CI conditions
 */
export class ConditionParser {
  private tokens: Token[]
  private current = 0

  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  static parse(condition: string): ParsedCondition {
    try {
      const lexer = new ConditionLexer(condition)
      const tokens = lexer.tokenize()
      const parser = new ConditionParser(tokens)
      return parser.parseExpression()
    } catch (error) {
      if (error instanceof Error) {
        const parseError = error as ParsingError
        parseError.message = `Failed to parse condition "${condition}": ${parseError.message}`
        throw parseError
      }
      throw error
    }
  }

  private getCurrentToken(): Token {
    return this.tokens[this.current] || { type: TokenType.EOF, value: '', position: 0 }
  }

  private advance(): Token {
    if (this.current < this.tokens.length - 1) {
      this.current++
    }
    return this.getCurrentToken()
  }

  private expect(type: TokenType): Token {
    const token = this.getCurrentToken()
    if (token.type !== type) {
      throw this.createError(`Expected ${type}, got ${token.type}`)
    }
    this.advance()
    return token
  }

  private createError(message: string): ParsingError {
    const token = this.getCurrentToken()
    const error = new Error(message) as ParsingError
    error.position = token.position
    error.token = token.value
    error.name = 'ParsingError'
    return error
  }

  private parseExpression(): ParsedCondition {
    return this.parseLogicalOr()
  }

  private parseLogicalOr(): ParsedCondition {
    let left = this.parseLogicalAnd()

    while (
      this.getCurrentToken().type === TokenType.LOGICAL_OP &&
      this.getCurrentToken().value === '||'
    ) {
      const operator = this.getCurrentToken().value as LogicalOperator
      this.advance()
      const right = this.parseLogicalAnd()

      const variables = new Set([...left.variables, ...right.variables])
      left = {
        type: 'logical',
        operator,
        left,
        right,
        variables,
      }
    }

    return left
  }

  private parseLogicalAnd(): ParsedCondition {
    let left = this.parseUnary()

    while (
      this.getCurrentToken().type === TokenType.LOGICAL_OP &&
      this.getCurrentToken().value === '&&'
    ) {
      const operator = this.getCurrentToken().value as LogicalOperator
      this.advance()
      const right = this.parseUnary()

      const variables = new Set([...left.variables, ...right.variables])
      left = {
        type: 'logical',
        operator,
        left,
        right,
        variables,
      }
    }

    return left
  }

  private parseUnary(): ParsedCondition {
    const token = this.getCurrentToken()

    if (token.type === TokenType.UNARY_OP && token.value === '!') {
      const operator = token.value as UnaryOperator
      this.advance()
      const operand = this.parseComparison()

      return {
        type: 'logical',
        operator,
        right: operand,
        variables: operand.variables,
      }
    }

    return this.parseComparison()
  }

  private parseComparison(): ParsedCondition {
    const left = this.parsePrimary()

    const token = this.getCurrentToken()
    if (token.type === TokenType.COMPARISON_OP) {
      const operator = token.value as ComparisonOperator
      this.advance()
      const right = this.parsePrimary()

      const variables = new Set([...left.variables, ...right.variables])
      return {
        type: 'comparison',
        operator,
        left,
        right,
        variables,
      }
    }

    return left
  }

  private parsePrimary(): ParsedCondition {
    const token = this.getCurrentToken()

    switch (token.type) {
      case TokenType.VARIABLE: {
        this.advance()
        const variable = this.extractVariableName(token.value)
        return {
          type: 'variable',
          variable,
          value: token.value,
          variables: new Set([variable]),
        }
      }

      case TokenType.STRING: {
        this.advance()
        return {
          type: 'literal',
          value: token.value,
          variables: new Set(),
        }
      }

      case TokenType.NULL: {
        this.advance()
        return {
          type: 'literal',
          value: null,
          variables: new Set(),
        }
      }

      case TokenType.LPAREN: {
        this.advance() // consume '('
        const expr = this.parseExpression()
        this.expect(TokenType.RPAREN) // consume ')'
        return expr
      }

      default:
        throw this.createError(`Unexpected token: ${token.value} (${token.type})`)
    }
  }

  private extractVariableName(variableExpression: string): string {
    // Handle $VAR and ${VAR} formats
    if (variableExpression.startsWith('${') && variableExpression.endsWith('}')) {
      return variableExpression.slice(2, -1)
    } else if (variableExpression.startsWith('$')) {
      return variableExpression.slice(1)
    }
    return variableExpression
  }
}
