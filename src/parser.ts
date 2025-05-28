interface TableExtractionOptions {
  /** Set of known real table names from Metabase's table index */
  knownTables?: Set<string>;
  /** Whether to filter out CTE tables using the known tables set */
  filterCTEs?: boolean;
  /** Additional keywords that might precede table names */
  customKeywords?: string[];
}

interface TableExtractionResult {
  /** All extracted table names (including potential CTEs) */
  allTables: string[];
  /** Only real tables (if filtering enabled) */
  realTables: string[];
  /** Potential CTE names that were filtered out */
  filteredCTEs: string[];
}

class SqlTableExtractor {
  private static readonly DEFAULT_KEYWORDS = [
    'FROM', 'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN',
    'CROSS JOIN', 'OUTER JOIN', 'INTO', 'UPDATE', 'DELETE FROM'
  ];

  /**
   * Extract table names from SQL query using the naive post-keyword approach
   */
  static extractTableNames(
    sql: string,
    options: TableExtractionOptions = {}
  ): TableExtractionResult {
    const { knownTables, filterCTEs = false, customKeywords = [] } = options;

    // Step 1: Clean the SQL by removing comments and string literals
    const cleanSql = this.removeCommentsAndStrings(sql);

    // Step 2: Build the regex pattern with all keywords
    const allKeywords = [...this.DEFAULT_KEYWORDS, ...customKeywords];
    const keywordPattern = allKeywords.join('|');

    // Step 3: Extract table names
    // This regex handles:
    // - Quoted identifiers: `table_name` or "table_name" or [table_name]
    // - Schema.table notation: schema.table
    // - Regular identifiers: table_name
    const regex = new RegExp(
      `(?:${keywordPattern})\\s+` +                    // Keywords followed by whitespace
      `(?:` +
        `\`([^\`]+)\`` +                               // Backtick quoted: `table`
        `|"([^"]+)"` +                                 // Double quoted: "table"
        `|\\[([^\\]]+)\\]` +                           // Square bracket quoted: [table]
        `|([\\w\\.]+)` +                               // Regular identifier with optional schema
      `)`,
      'gi'
    );

    const extractedTables = new Set<string>();
    let match;

    while ((match = regex.exec(cleanSql)) !== null) {
      // Get the table name from whichever capture group matched
      const tableName = match[1] || match[2] || match[3] || match[4];

      if (tableName) {
        // For quoted identifiers, preserve the full name including spaces
        // For unquoted identifiers, split on whitespace and take first part (removes aliases)
        let cleanTableName: string;
        if (match[1] || match[2] || match[3]) {
          // This is a quoted identifier, preserve spaces
          cleanTableName = tableName.trim();
        } else {
          // This is an unquoted identifier, remove aliases
          cleanTableName = tableName.trim().split(/\s+/)[0];
        }

        // Handle schema.table notation - keep the full name
        extractedTables.add(cleanTableName);
      }
    }

    const allTables = Array.from(extractedTables);

    // Step 4: Filter CTEs if requested and known tables are provided
    if (filterCTEs && knownTables) {
      const realTables = allTables.filter(table => {
        // Check if table exists in known tables (with or without schema)
        const tableWithoutSchema = table.includes('.') ? table.split('.').pop()! : table;
        return knownTables.has(table) || knownTables.has(tableWithoutSchema);
      });

      const filteredCTEs = allTables.filter(table => {
        const tableWithoutSchema = table.includes('.') ? table.split('.').pop()! : table;
        return !knownTables.has(table) && !knownTables.has(tableWithoutSchema);
      });

      return {
        allTables,
        realTables,
        filteredCTEs
      };
    }

    return {
      allTables,
      realTables: allTables,
      filteredCTEs: []
    };
  }

  /**
   * Remove SQL comments and string literals from the query string
   */
  private static removeCommentsAndStrings(sql: string): string {
    let result = '';
    let i = 0;

    while (i < sql.length) {
      const char = sql[i];
      const nextChar = sql[i + 1];

      // Handle single-line comments (-- comment)
      if (char === '-' && nextChar === '-') {
        // Skip until end of line
        while (i < sql.length && sql[i] !== '\n') {
          i++;
        }
        continue;
      }

      // Handle multi-line comments (/* comment */)
      if (char === '/' && nextChar === '*') {
        i += 2; // Skip /*
        // Skip until */
        while (i < sql.length - 1) {
          if (sql[i] === '*' && sql[i + 1] === '/') {
            i += 2; // Skip */
            break;
          }
          i++;
        }
        continue;
      }

      // Handle single-quoted strings ('string')
      if (char === "'") {
        i++; // Skip opening quote
        // Skip until closing quote, handling escaped quotes
        while (i < sql.length) {
          if (sql[i] === "'") {
            if (sql[i + 1] === "'") {
              // Escaped quote, skip both
              i += 2;
            } else {
              // Closing quote
              i++;
              break;
            }
          } else {
            i++;
          }
        }
        // Replace the entire string with a space
        result += ' ';
        continue;
      }

      // Handle double-quoted strings/identifiers ("string" or "identifier")
      if (char === '"') {
        // Look back to see if this might be an identifier (after FROM, JOIN, etc.)
        const beforeQuote = result.trim().split(/\s+/).slice(-2).join(' ').toUpperCase();
        const isLikelyIdentifier = beforeQuote && (
          beforeQuote.endsWith('FROM') ||
          beforeQuote.endsWith('JOIN') ||
          beforeQuote.endsWith('UPDATE') ||
          beforeQuote.endsWith('INTO')
        );

        // Also check for comparison operators that suggest this is a string literal
        const hasComparisonOperator = /[=!<>]\s*$/.test(result.slice(-10));

        // If it looks like an identifier context and no comparison operator, keep it
        if (isLikelyIdentifier && !hasComparisonOperator) {
          // This is likely a quoted identifier, preserve it entirely
          result += char; // Add opening quote
          i++; // Move past opening quote

          // Copy everything until closing quote
          while (i < sql.length) {
            result += sql[i];
            if (sql[i] === '"') {
              if (sql[i + 1] === '"') {
                // Escaped quote, copy both
                i++;
                result += sql[i];
              } else {
                // Closing quote, we're done
                i++;
                break;
              }
            }
            i++;
          }
          continue;
        }

        // Otherwise, treat as string literal and remove it
        i++; // Skip opening quote
        // Skip until closing quote, handling escaped quotes
        while (i < sql.length) {
          if (sql[i] === '"') {
            if (sql[i + 1] === '"') {
              // Escaped quote, skip both
              i += 2;
            } else {
              // Closing quote
              i++;
              break;
            }
          } else {
            i++;
          }
        }
        // Replace the entire string with a space
        result += ' ';
        continue;
      }

      // Regular character, add to result
      result += char;
      i++;
    }

    return result
      // Clean up extra whitespace
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Simple helper for when you just want the table names as strings
   */
  static getTableNamesSimple(sql: string, knownTables?: Set<string>): string[] {
    const result = this.extractTableNames(sql, {
      knownTables,
      filterCTEs: !!knownTables
    });
    return knownTables ? result.realTables : result.allTables;
  }
}

export { SqlTableExtractor, TableExtractionOptions, TableExtractionResult };
