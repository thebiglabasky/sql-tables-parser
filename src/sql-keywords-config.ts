export interface SqlKeywordsConfig {
  /** Default keywords that are common across all SQL dialects */
  default: string[];

  /** Database-specific keywords organized by database type */
  databaseSpecific: {
    postgresql: string[];
    mysql: string[];
    sqlserver: string[];
    oracle: string[];
    bigquery: string[];
    snowflake: string[];
    sqlite: string[];
  };

  /** All keywords merged (computed) */
  all?: string[];
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

  databaseSpecific: {
    postgresql: [
      'LATERAL JOIN',
      'RETURNING'
    ],

    mysql: [
      'STRAIGHT_JOIN',
      'REPLACE INTO'
    ],

    sqlserver: [
      'CROSS APPLY',
      'OUTER APPLY',
      'MERGE INTO',
      'OUTPUT'
    ],

    oracle: [
      'CONNECT BY',
      'MERGE INTO',
      'MODEL'
    ],

    bigquery: [
      'MERGE INTO'
    ],

    snowflake: [
      'LATERAL FLATTEN',
      'MERGE INTO',
      'COPY INTO'
    ],

    sqlite: [
      'REPLACE INTO'
    ]
  }
};

/**
 * Get all keywords for a specific database type
 */
export function getKeywordsForDatabase(
  databaseType?: keyof SqlKeywordsConfig['databaseSpecific'],
  config: SqlKeywordsConfig = defaultSqlKeywords
): string[] {
  const keywords = [...config.default];

  if (databaseType && config.databaseSpecific[databaseType]) {
    keywords.push(...config.databaseSpecific[databaseType]);
  }

  // Remove duplicates
  return Array.from(new Set(keywords));
}

/**
 * Create a custom keywords configuration
 */
export function createCustomKeywordsConfig(
  customKeywords: string[],
  baseConfig: SqlKeywordsConfig = defaultSqlKeywords
): SqlKeywordsConfig {
  return {
    ...baseConfig,
    default: [...baseConfig.default, ...customKeywords]
  };
}
