#!/usr/bin/env node

import chalk from 'chalk';
import { Command } from 'commander';
import { readFileSync } from 'fs';
import ora from 'ora';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { SqlTableExtractor } from './parser.js';
import { defaultSqlKeywords, getKeywordsForDatabase } from './sql-keywords-config.js';

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
  .option('-k, --known-tables <tables>', 'Comma-separated list of known table names for CTE filtering')
  .option('--filter-ctes', 'Filter out CTEs using known tables')
  .option('--keywords <keywords>', 'Comma-separated list of SQL keywords to look for (overrides defaults)')
  .option('--database <type>', 'Database type for keywords: postgresql, mysql, sqlserver, oracle, bigquery, snowflake, sqlite')
  .option('--custom-keywords <keywords>', 'Additional keywords to include (comma-separated)')
  .action(async (queryOrPath: string, options: {
    file?: boolean;
    verbose?: boolean;
    knownTables?: string;
    filterCtes?: boolean;
    keywords?: string;
    database?: string;
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

      // Parse known tables if provided
      let knownTables: Set<string> | undefined;
      if (options.knownTables) {
        knownTables = new Set(
          options.knownTables.split(',').map(t => t.trim()).filter(t => t.length > 0)
        );
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
        databaseType: options.database as any,
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
          console.log(chalk.dim('\nKnown tables:'), Array.from(knownTables).join(', '));
        }

        if (keywords || options.database || customKeywords) {
          console.log(chalk.dim('\nKeywords used:'));
          if (keywords) {
            console.log(chalk.dim('  Direct:'), keywords.join(', '));
          } else if (options.database) {
            const dbKeywords = getKeywordsForDatabase(options.database as any);
            console.log(chalk.dim(`  Database (${options.database}):`), dbKeywords.join(', '));
          } else {
            console.log(chalk.dim('  Default:'), defaultSqlKeywords.default.join(', '));
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
  .command('test')
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

    const knownTables = new Set(['users', 'posts', 'orders', 'public.users', 'blog.posts', 'user table', 'order table']);

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
  });

program
  .command('keywords')
  .description('Show available SQL keywords by database type')
  .option('-d, --database <type>', 'Show keywords for specific database')
  .action((options: { database?: string }) => {
    console.log(chalk.blue.bold('\n📋 SQL Keywords Configuration\n'));

    if (options.database) {
      // Show keywords for specific database
      const dbType = options.database.toLowerCase();
      if (dbType in defaultSqlKeywords.databaseSpecific) {
        const keywords = getKeywordsForDatabase(dbType as any);
        console.log(chalk.yellow(`Keywords for ${dbType}:`));
        console.log(chalk.dim('\nDefault keywords:'));
        defaultSqlKeywords.default.forEach(k => console.log(`  - ${k}`));

        const dbSpecific = defaultSqlKeywords.databaseSpecific[dbType as keyof typeof defaultSqlKeywords.databaseSpecific];
        if (dbSpecific.length > 0) {
          console.log(chalk.dim('\nDatabase-specific keywords:'));
          dbSpecific.forEach(k => console.log(`  - ${k}`));
        }

        console.log(chalk.dim(`\nTotal: ${keywords.length} keywords`));
      } else {
        console.log(chalk.red(`Unknown database type: ${options.database}`));
        console.log(chalk.dim('Available types: postgresql, mysql, sqlserver, oracle, bigquery, snowflake, sqlite'));
      }
    } else {
      // Show all keywords organized by category
      console.log(chalk.yellow('Default keywords (common across all databases):'));
      defaultSqlKeywords.default.forEach(k => console.log(`  - ${k}`));

      console.log(chalk.yellow('\nDatabase-specific keywords:'));
      Object.entries(defaultSqlKeywords.databaseSpecific).forEach(([db, keywords]) => {
        if (keywords.length > 0) {
          console.log(chalk.cyan(`\n${db}:`));
          keywords.forEach(k => console.log(`  - ${k}`));
        }
      });
    }

    console.log(chalk.dim('\nUse --database <type> to see keywords for a specific database'));
    console.log(chalk.dim('Use --keywords to override with custom keywords when parsing'));
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
    console.log('  sql-parser parse "WITH cte AS (...) SELECT * FROM cte" --known-tables users,orders --filter-ctes');
    console.log('  sql-parser parse "MERGE INTO users" --database sqlserver');
    console.log('  sql-parser keywords --database postgresql\n');

    console.log(chalk.yellow('Commands:'));
    console.log('  parse <query>  Parse SQL query and extract table names');
    console.log('  test           Run test cases to demonstrate the parser');
    console.log('  keywords       Show available SQL keywords by database type');
    console.log('  help           Show this help message\n');

    console.log(chalk.yellow('Options:'));
    console.log('  -f, --file                    Read SQL from file');
    console.log('  -v, --verbose                 Show verbose output');
    console.log('  -k, --known-tables <tables>   Comma-separated known table names');
    console.log('  --filter-ctes                 Filter out CTEs using known tables');
    console.log('  --keywords <keywords>         Comma-separated list of SQL keywords to look for');
    console.log('  --database <type>             Database type for keywords');
    console.log('  --custom-keywords <keywords>  Additional keywords to include');
    console.log('  --version                     Show version number\n');

    console.log(chalk.dim('Examples:'));
    console.log(chalk.dim('  sql-parser parse "SELECT u.name FROM users u JOIN orders o ON u.id = o.user_id"'));
    console.log(chalk.dim('  sql-parser parse complex-query.sql --file --verbose'));
    console.log(chalk.dim('  sql-parser parse "WITH temp AS (...) SELECT * FROM temp" --known-tables users --filter-ctes'));
    console.log(chalk.dim('  sql-parser parse "MERGE INTO users USING source" --keywords "MERGE INTO,USING"'));
    console.log(chalk.dim('  sql-parser keywords --database postgresql'));
    console.log(chalk.dim('  sql-parser test'));
  });

// Show help by default if no command provided
if (process.argv.length <= 2) {
  program.help();
} else {
  program.parse();
}

// Export for programmatic usage
export { SqlTableExtractor } from './parser.js';
export { createCustomKeywordsConfig, defaultSqlKeywords, getKeywordsForDatabase } from './sql-keywords-config.js';
export type { SqlKeywordsConfig } from './sql-keywords-config.js';

