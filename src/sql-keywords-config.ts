export interface SqlKeywordsConfig {
  /** Default keywords that are common across all SQL dialects */
  default: string[];
  /** All available keywords that users can choose from */
  all: string[];
}

export const defaultSqlKeywords: SqlKeywordsConfig = {
  default: [
    // Basic table references
    'FROM',
    'JOIN',
    'INNER JOIN',
    'LEFT JOIN',
    'RIGHT JOIN',
    'FULL JOIN',
    'CROSS JOIN',
    'OUTER JOIN',

    // DML operations
    'INTO',
    'UPDATE',
    'DELETE FROM',
    'INSERT INTO',
    'REPLACE INTO',
    'UPSERT INTO',
    'MERGE INTO',
    'USING'
  ],

  all: [
    // Basic table references
    'FROM',
    'JOIN',
    'INNER JOIN',
    'LEFT JOIN',
    'RIGHT JOIN',
    'FULL JOIN',
    'CROSS JOIN',
    'OUTER JOIN',

    // DML operations
    'INTO',
    'UPDATE',
    'DELETE FROM',
    'INSERT INTO',
    'REPLACE INTO',
    'UPSERT INTO',
    'MERGE INTO',
    'USING',

    // Extended keywords from various databases
    'LATERAL JOIN',
    'RETURNING',
    'STRAIGHT_JOIN',
    'CROSS APPLY',
    'OUTER APPLY',
    'OUTPUT',
    'CONNECT BY',
    'MODEL',
    'LATERAL FLATTEN',
    'COPY INTO',
    'CREATE TABLE',
    'CREATE OR REPLACE TABLE',
    'CREATE TRANSIENT TABLE',
    'CREATE TEMPORARY TABLE',
    'INSERT ALL INTO',
    'INSERT IGNORE INTO',
    'SELECT * FROM'
  ]
};

/**
 * Get all available keywords
 */
export function getAllKeywords(config: SqlKeywordsConfig = defaultSqlKeywords): string[] {
  return [...config.all];
}

/**
 * Create a custom keywords configuration
 */
export function createCustomKeywordsConfig(
  customKeywords: string[],
  baseConfig: SqlKeywordsConfig = defaultSqlKeywords
): SqlKeywordsConfig {
  return {
    default: [...baseConfig.default, ...customKeywords],
    all: [...baseConfig.all, ...customKeywords]
  };
}
