import { defaultSqlKeywords, getKeywordsForDatabase } from './sql-keywords-config.js';

export interface TableExtractionResult {
  /** All tables found in the query */
  allTables: string[];
  /** Tables that exist in the known tables set (empty if no filtering) */
  realTables: string[];
  /** CTE tables that were filtered out (empty if no filtering) */
  filteredCTEs: string[];
}

interface TableExtractionOptions {
  /** Set of known real table names from Metabase's table index */
  knownTables?: Set<string>;
  /** Whether to filter out CTE tables using the known tables set */
  filterCTEs?: boolean;
  /** Custom keywords that might precede table names */
  customKeywords?: string[];
  /** Database type for automatic keyword inclusion (deprecated - use keywords instead) */
  databaseType?: 'postgresql' | 'mysql' | 'sqlserver' | 'oracle' | 'bigquery' | 'snowflake' | 'sqlite';
  /** Direct list of keywords to use (overrides databaseType if provided) */
  keywords?: string[];
}

class SqlTableExtractor {
  /**
   * Extract table names from SQL query using simplified approach
   */
  static extractTableNames(
    sql: string,
    options: TableExtractionOptions = {}
  ): TableExtractionResult {
    const { knownTables, filterCTEs = false, customKeywords = [], databaseType, keywords } = options;

    // Step 1: Clean the SQL by removing comments and string literals
    const cleanSql = this.removeCommentsAndStrings(sql);

    // Step 2: Build the keyword list
    let allKeywords: string[];

    if (keywords && keywords.length > 0) {
      // Use provided keywords directly
      allKeywords = keywords;
    } else if (databaseType) {
      // Use database-specific keywords from config (backward compatibility)
      allKeywords = getKeywordsForDatabase(databaseType);
    } else {
      // Use default keywords from config
      allKeywords = defaultSqlKeywords.default;
    }

    // Add any custom keywords
    if (customKeywords.length > 0) {
      allKeywords = [...allKeywords, ...customKeywords];
    }

    // Remove duplicates
    allKeywords = Array.from(new Set(allKeywords));

    const keywordPattern = allKeywords.join('|');

    // Step 3: Extract table names with simplified regex approach
    const regex = new RegExp(
      '(?:' + keywordPattern + ')\\s+' +               // Keywords followed by whitespace
      '(' +                                            // Capture the full table identifier
        // Multi-part identifiers: [db].[schema].[table], "db"."schema"."table", db.schema.table
        '(?:\\[[^\\]]+\\]|"[^"]+"|`[^`]+`|[\\w@#]+)' +  // First part
        '(?:\\.(?:\\[[^\\]]+\\]|"[^"]+"|`[^`]+`|[\\w@#]+))*' +  // Additional parts
      ')',                                             // End capture group
      'gi'
    );

    const extractedTables = new Set<string>();
    let match;

    while ((match = regex.exec(cleanSql)) !== null) {
      const tableIdentifier = match[1];

      if (tableIdentifier) {
        // Check if this looks like a function call
        const matchEnd = match.index + match[0].length;
        const remainingText = cleanSql.slice(matchEnd);
        const isFunction = /^\s*\(/.test(remainingText);

        if (isFunction) {
          // Extract the keyword to determine context
          const keywordMatch = match[0].match(new RegExp('^(' + keywordPattern + ')\\s+', 'i'));
          if (keywordMatch) {
            const keyword = keywordMatch[1].toUpperCase();

            // Only skip functions in FROM/JOIN contexts, not in INSERT/UPDATE/MERGE contexts
            const isFunctionContext = keyword === 'FROM' || keyword.includes('JOIN') || keyword === 'USING';

            if (isFunctionContext) {
              continue;
            }
          }
        }

        // Clean the table identifier by removing quotes/brackets
        let cleanTableName: string;

        // Remove quotes and brackets but preserve the content and dots
        cleanTableName = tableIdentifier
          .replace(/\[([^\]]+)\]/g, '$1')  // [name] -> name
          .replace(/"([^"]+)"/g, '$1')     // "name" -> name
          .replace(/`([^`]+)`/g, '$1');    // `name` -> name

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
   * Remove SQL comments and string literals from the query string (simplified)
   */
  private static removeCommentsAndStrings(sql: string): string {
    let result = '';
    let i = 0;

    while (i < sql.length) {
      const char = sql[i];
      const nextChar = sql[i + 1];

      // Handle single-line comments (-- comment)
      if (char === '-' && nextChar === '-') {
        while (i < sql.length && sql[i] !== '\n') {
          i++;
        }
        continue;
      }

      // Handle multi-line comments (/* comment */)
      if (char === '/' && nextChar === '*') {
        i += 2; // Skip /*
        while (i < sql.length - 1) {
          if (sql[i] === '*' && sql[i + 1] === '/') {
            i += 2; // Skip */
            break;
          }
          i++;
        }
        continue;
      }

      // Handle single-quoted strings ('string') - always treat as string literals
      if (char === "'") {
        i++; // Skip opening quote
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
        result += ' '; // Replace with space
        continue;
      }

      // Handle double-quoted strings/identifiers - simplified logic
      if (char === '"') {
        // Simple heuristic: if preceded by =, !=, <, >, it's likely a string literal
        const beforeQuote = result.slice(-10);
        const isStringLiteral = /[=!<>]\s*$/.test(beforeQuote);

        if (isStringLiteral) {
          // Treat as string literal, remove it
          i++; // Skip opening quote
          while (i < sql.length) {
            if (sql[i] === '"') {
              i++; // Skip closing quote
              break;
            }
            i++;
          }
          result += ' '; // Replace with space
        } else {
          // Treat as identifier, preserve it
          result += char;
          i++;
        }
        continue;
      }

      // Regular character, add to result
      result += char;
      i++;
    }

    return result.replace(/\s+/g, ' ').trim();
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

export { SqlTableExtractor, TableExtractionOptions };

