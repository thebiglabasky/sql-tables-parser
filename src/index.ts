#!/usr/bin/env node

import chalk from 'chalk';
import { Command } from 'commander';
import { readFileSync } from 'fs';
import ora from 'ora';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { SqlTableExtractor, TableMetadata } from './parser.js';
import { defaultSqlKeywords, getAllKeywords } from './sql-keywords-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read package.json for version
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '../package.json'), 'utf-8')
);

const program = new Command();

program
  .name('sql-parser')
  .description('CLI tool to parse SQL queries and extract table names')
  .version(packageJson.version);

program
  .command('parse')
  .description('Parse SQL query and extract table names')
  .argument('<query>', 'SQL query to parse (or file path if using --file)')
  .option('-f, --file', 'Read SQL from file instead of argument')
  .option('-v, --verbose', 'Show verbose output')
  .option('-t, --known-tables <file>', 'Path to JSON file containing known table definitions')
  .option('--filter-ctes', 'Filter out CTEs using known tables')
  .option('--keywords <keywords>', 'Comma-separated list of SQL keywords to look for (overrides defaults)')
  .option('--custom-keywords <keywords>', 'Additional keywords to include (comma-separated)')
  .action(async (queryOrPath: string, options: {
    file?: boolean;
    verbose?: boolean;
    knownTables?: string;
    filterCtes?: boolean;
    keywords?: string;
    customKeywords?: string;
  }) => {
    const spinner = ora('Parsing SQL query...').start();

    try {
      // Get SQL content
      let sql: string;
      if (options.file) {
        try {
          sql = readFileSync(queryOrPath, 'utf-8');
          if (options.verbose) {
            spinner.text = `Reading SQL from file: ${queryOrPath}`;
          }
        } catch (error) {
          spinner.fail(`Failed to read file: ${queryOrPath}`);
          console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
          process.exit(1);
        }
      } else {
        sql = queryOrPath;
      }

      // Parse known tables from JSON file if provided
      let knownTables: Map<string, TableMetadata> | undefined;
      if (options.knownTables) {
        try {
          const tablesJson = readFileSync(options.knownTables, 'utf-8');
          const tablesData = JSON.parse(tablesJson);

          if (typeof tablesData !== 'object' || tablesData === null) {
            throw new Error('JSON file must contain an object');
          }

          knownTables = new Map();
          for (const [key, value] of Object.entries(tablesData)) {
            if (typeof value === 'object' && value !== null) {
              const metadata = value as any;
              if (typeof metadata.tableName === 'string' && typeof metadata.fullyQualifiedName === 'string') {
                knownTables.set(key, {
                  tableName: metadata.tableName,
                  fullyQualifiedName: metadata.fullyQualifiedName,
                  schema: metadata.schema,
                  database: metadata.database
                });
              } else {
                console.warn(chalk.yellow(`Warning: Invalid table metadata for key "${key}" - skipping`));
              }
            } else {
              console.warn(chalk.yellow(`Warning: Invalid table metadata for key "${key}" - skipping`));
            }
          }

          if (options.verbose) {
            console.log(chalk.dim(`Loaded ${knownTables.size} known tables from ${options.knownTables}`));
          }
        } catch (error) {
          spinner.fail(`Failed to read known tables file: ${options.knownTables}`);
          console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
          process.exit(1);
        }
      }

      // Parse keywords if provided
      let keywords: string[] | undefined;
      if (options.keywords) {
        keywords = options.keywords.split(',').map(k => k.trim()).filter(k => k.length > 0);
      }

      // Parse custom keywords if provided
      let customKeywords: string[] | undefined;
      if (options.customKeywords) {
        customKeywords = options.customKeywords.split(',').map(k => k.trim()).filter(k => k.length > 0);
      }

      // Extract table names
      const result = SqlTableExtractor.extractTableNames(sql, {
        knownTables,
        filterCTEs: options.filterCtes && !!knownTables,
        keywords,
        customKeywords
      });

      spinner.succeed('SQL query parsed successfully');

      // Display results
      if (result.allTables.length === 0) {
        console.log(chalk.yellow('\nNo tables found in the query'));
        return;
      }

      console.log(chalk.green(`\nTables found (${result.allTables.length}):`));
      result.allTables.forEach(table => {
        console.log(chalk.yellow(`- ${table}`));
      });

      // Show filtered results if CTE filtering was enabled
      if (options.filterCtes && knownTables) {
        if (result.realTables.length > 0) {
          console.log(chalk.green(`\nReal tables (${result.realTables.length}):`));
          result.realTables.forEach(table => {
            console.log(chalk.cyan(`- ${table}`));
          });
        }

        if (result.filteredCTEs.length > 0) {
          console.log(chalk.magenta(`\nFiltered CTEs (${result.filteredCTEs.length}):`));
          result.filteredCTEs.forEach(table => {
            console.log(chalk.dim(`- ${table}`));
          });
        }
      }

      if (options.verbose) {
        console.log(chalk.dim('\nQuery analyzed:'));
        console.log(chalk.dim(sql.replace(/\s+/g, ' ').trim()));

        if (knownTables) {
          console.log(chalk.dim('\nKnown tables loaded:'), knownTables.size);
          for (const [key, metadata] of knownTables) {
            console.log(chalk.dim(`  ${key} -> ${metadata.fullyQualifiedName}`));
          }
        }

        if (keywords || customKeywords) {
          console.log(chalk.dim('\nKeywords used:'));
          if (keywords) {
            console.log(chalk.dim('  Direct:'), keywords.join(', '));
          }
          if (customKeywords) {
            console.log(chalk.dim('  Custom:'), customKeywords.join(', '));
          }
        }
      }
    } catch (error) {
      spinner.fail('Failed to parse SQL query');
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command('demo')
  .description('Run test cases to demonstrate the parser')
  .action(() => {
    console.log(chalk.blue.bold('\n🧪 SQL Parser Test Cases\n'));

    const testQueries = [
      {
        name: 'Simple SELECT',
        sql: 'SELECT * FROM users'
      },
      {
        name: 'JOIN with aliases',
        sql: 'SELECT u.name, p.title FROM users u INNER JOIN posts p ON u.id = p.user_id'
      },
      {
        name: 'Schema notation',
        sql: 'SELECT * FROM public.users JOIN blog.posts ON users.id = posts.user_id'
      },
      {
        name: 'CTE example',
        sql: `WITH active_users AS (
          SELECT * FROM users WHERE active = true
        )
        SELECT * FROM active_users
        JOIN orders ON active_users.id = orders.user_id`
      },
      {
        name: 'Quoted identifiers',
        sql: 'SELECT * FROM "user table" JOIN [order table] ON "user table".id = [order table].user_id'
      }
    ];

    // Example table metadata structure
    const knownTables = new Map([
      ['users', {
        tableName: 'users',
        fullyQualifiedName: 'public.users',
        schema: 'public',
        database: 'myapp'
      }],
      ['posts', {
        tableName: 'posts',
        fullyQualifiedName: 'blog.posts',
        schema: 'blog',
        database: 'myapp'
      }],
      ['orders', {
        tableName: 'orders',
        fullyQualifiedName: 'sales.orders',
        schema: 'sales',
        database: 'myapp'
      }],
      ['public.users', {
        tableName: 'users',
        fullyQualifiedName: 'public.users',
        schema: 'public',
        database: 'myapp'
      }],
      ['blog.posts', {
        tableName: 'posts',
        fullyQualifiedName: 'blog.posts',
        schema: 'blog',
        database: 'myapp'
      }],
      ['user table', {
        tableName: 'user table',
        fullyQualifiedName: 'public.user_table',
        schema: 'public'
      }],
      ['order table', {
        tableName: 'order table',
        fullyQualifiedName: 'sales.order_table',
        schema: 'sales'
      }]
    ]);

    console.log(chalk.dim('Using example table metadata structure:\n'));

    testQueries.forEach((test, index) => {
      console.log(chalk.yellow(`${index + 1}. ${test.name}`));
      console.log(chalk.dim(`   SQL: ${test.sql.replace(/\s+/g, ' ').trim()}`));

      const result = SqlTableExtractor.extractTableNames(test.sql, {
        knownTables,
        filterCTEs: true
      });

      console.log(chalk.green(`   All: [${result.allTables.join(', ')}]`));
      console.log(chalk.cyan(`   Real: [${result.realTables.join(', ')}]`));
      if (result.filteredCTEs.length > 0) {
        console.log(chalk.magenta(`   CTEs: [${result.filteredCTEs.join(', ')}]`));
      }
      console.log();
    });

    console.log(chalk.dim('To use your own table definitions, create a JSON file like example-tables.json'));
    console.log(chalk.dim('and use: sql-parser parse "query" --known-tables your-tables.json --filter-ctes'));
  });

program
  .command('keywords')
  .description('Show available SQL keywords')
  .action(() => {
    console.log(chalk.blue.bold('\n📋 SQL Keywords Configuration\n'));

    console.log(chalk.yellow('Default keywords (commonly used):'));
    defaultSqlKeywords.default.forEach(k => console.log(`  - ${k}`));

    console.log(chalk.yellow('\nAll available keywords:'));
    const allKeywords = getAllKeywords();
    const extendedKeywords = allKeywords.filter(k => !defaultSqlKeywords.default.includes(k));

    if (extendedKeywords.length > 0) {
      console.log(chalk.cyan('\nAdditional keywords from various databases:'));
      extendedKeywords.forEach(k => console.log(`  - ${k}`));
    }

    console.log(chalk.dim(`\nTotal available: ${allKeywords.length} keywords`));
    console.log(chalk.dim('Use --keywords to specify which keywords to use when parsing'));
    console.log(chalk.dim('Use --custom-keywords to add additional keywords beyond the defaults'));
  });

program
  .command('help')
  .description('Show help information')
  .action(() => {
    console.log(chalk.blue.bold('\n🔍 SQL Tables Parser\n'));
    console.log(chalk.white('A CLI tool to parse SQL queries and extract table names.\n'));

    console.log(chalk.yellow('Usage:'));
    console.log('  sql-parser parse "SELECT * FROM users JOIN orders ON users.id = orders.user_id"');
    console.log('  sql-parser parse query.sql --file');
    console.log('  sql-parser parse "SELECT * FROM products" --verbose');
    console.log('  sql-parser parse "WITH cte AS (...) SELECT * FROM cte" --known-tables tables.json --filter-ctes');
    console.log('  sql-parser parse "MERGE INTO users" --keywords "MERGE INTO,USING"');
    console.log('  sql-parser keywords\n');

    console.log(chalk.yellow('Commands:'));
    console.log('  parse <query>  Parse SQL query and extract table names');
    console.log('  demo           Run test cases to demonstrate the parser');
    console.log('  keywords       Show available SQL keywords by database type');
    console.log('  help           Show this help message\n');

    console.log(chalk.yellow('Options:'));
    console.log('  -f, --file                    Read SQL from file');
    console.log('  -v, --verbose                 Show verbose output');
    console.log('  -t, --known-tables <file>     Path to JSON file containing known table definitions');
    console.log('  --filter-ctes                 Filter out CTEs using known tables');
    console.log('  --keywords <keywords>         Comma-separated list of SQL keywords to look for');
    console.log('  --custom-keywords <keywords>  Additional keywords to include');
    console.log('  --version                     Show version number\n');

    console.log(chalk.dim('Examples:'));
    console.log(chalk.dim('  sql-parser parse "SELECT u.name FROM users u JOIN orders o ON u.id = o.user_id"'));
    console.log(chalk.dim('  sql-parser parse complex-query.sql --file --verbose'));
    console.log(chalk.dim('  sql-parser parse "WITH temp AS (...) SELECT * FROM temp" --known-tables my-tables.json --filter-ctes'));
    console.log(chalk.dim('  sql-parser parse "MERGE INTO users USING source" --keywords "MERGE INTO,USING"'));
    console.log(chalk.dim('  sql-parser keywords'));
    console.log(chalk.dim('  sql-parser demo'));

    console.log(chalk.yellow('\nJSON file format for known tables:'));
    console.log(chalk.dim('  {'));
    console.log(chalk.dim('    "users": {'));
    console.log(chalk.dim('      "tableName": "users",'));
    console.log(chalk.dim('      "fullyQualifiedName": "public.users",'));
    console.log(chalk.dim('      "schema": "public",'));
    console.log(chalk.dim('      "database": "mydb"'));
    console.log(chalk.dim('    },'));
    console.log(chalk.dim('    "orders": {'));
    console.log(chalk.dim('      "tableName": "orders",'));
    console.log(chalk.dim('      "fullyQualifiedName": "sales.orders",'));
    console.log(chalk.dim('      "schema": "sales"'));
    console.log(chalk.dim('    }'));
    console.log(chalk.dim('  }'));
  });

// Show help by default if no command provided
if (process.argv.length <= 2) {
  program.help();
} else {
  program.parse();
}

// Export the main parser and types for library usage
export { SqlTableExtractor, TableExtractionOptions, TableExtractionResult, TableMetadata } from './parser.js';
export { defaultSqlKeywords, getAllKeywords } from './sql-keywords-config.js';
export type { SqlKeywordsConfig } from './sql-keywords-config.js';

