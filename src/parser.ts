import { defaultSqlKeywords } from './sql-keywords-config.js';

export interface TableMetadata {
  /** The table's short name (without schema) */
  tableName: string;
  /** The fully qualified name (schema.table or database.schema.table) */
  fullyQualifiedName: string;
  /** Schema name if applicable */
  schema?: string;
  /** Database name if applicable */
  database?: string;
}

export interface TableExtractionResult {
  /** All tables found in the query (fully qualified when available) */
  allTables: string[];
  /** Tables that exist in the known tables set (fully qualified when available) */
  realTables: string[];
  /** CTE tables that were filtered out */
  filteredCTEs: string[];
}

interface TableExtractionOptions {
  /** Map of known real table metadata from Metabase's table index */
  knownTables?: Map<string, TableMetadata>;
  /** Whether to filter out CTE tables using the known tables set */
  filterCTEs?: boolean;
  /** Custom keywords that might precede table names */
  customKeywords?: string[];
  /** Direct list of keywords to use (overrides defaults if provided) */
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
    const { knownTables, filterCTEs = false, customKeywords = [], keywords } = options;

    // Step 1: Clean the SQL by removing comments and string literals
    const cleanSql = this.removeCommentsAndStrings(sql);

    // Step 2: Build the keyword list
    let allKeywords: string[];

    if (keywords && keywords.length > 0) {
      // Use provided keywords directly
      allKeywords = keywords;
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

        // Resolve to fully qualified name if possible
        const resolvedName = this.resolveTableName(cleanTableName, knownTables);
        extractedTables.add(resolvedName);
      }
    }

    const allTables = Array.from(extractedTables);

    // Step 4: Filter CTEs if requested and known tables are provided
    if (filterCTEs && knownTables) {
      const realTables = allTables.filter(table => {
        return this.isKnownTable(table, knownTables);
      });

      const filteredCTEs = allTables.filter(table => {
        return !this.isKnownTable(table, knownTables);
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
   * Resolve a table name to its fully qualified version if available in known tables
   */
  private static resolveTableName(
    tableName: string,
    knownTables?: Map<string, TableMetadata>
  ): string {
    if (!knownTables) {
      return tableName;
    }

    // First, try exact match with the provided name
    if (knownTables.has(tableName)) {
      return knownTables.get(tableName)!.fullyQualifiedName;
    }

    // Try to find by table name without schema
    const tableWithoutSchema = tableName.includes('.') ? tableName.split('.').pop()! : tableName;

    for (const [key, metadata] of knownTables) {
      // Check exact match
      if (key === tableName) {
        return metadata.fullyQualifiedName;
      }

      // Check table name match
      if (metadata.tableName === tableWithoutSchema) {
        return metadata.fullyQualifiedName;
      }

      // Check if the provided name is already the fully qualified name
      if (metadata.fullyQualifiedName === tableName) {
        return metadata.fullyQualifiedName;
      }
    }

    return tableName;
  }

  /**
   * Check if a table is known (exists in the known tables collection)
   */
  private static isKnownTable(
    tableName: string,
    knownTables: Map<string, TableMetadata>
  ): boolean {
    // Check if table exists by key, table name, or fully qualified name
    const tableWithoutSchema = tableName.includes('.') ? tableName.split('.').pop()! : tableName;

    for (const [key, metadata] of knownTables) {
      if (key === tableName ||
          metadata.tableName === tableWithoutSchema ||
          metadata.fullyQualifiedName === tableName) {
        return true;
      }
    }

    return false;
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
  static getTableNamesSimple(sql: string, knownTables?: Map<string, TableMetadata>): string[] {
    const result = this.extractTableNames(sql, {
      knownTables,
      filterCTEs: !!knownTables
    });
    return knownTables ? result.realTables : result.allTables;
  }
}

export { SqlTableExtractor, TableExtractionOptions };

