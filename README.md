# SQL Tables Parser

A TypeScript library and CLI tool for parsing SQL queries and extracting table names with support for CTEs, complex joins, and various SQL dialects.

## Features

- Extract table names from complex SQL queries
- Handle CTEs (Common Table Expressions) with proper scoping
- Support for various SQL dialects (PostgreSQL, MySQL, SQL Server, etc.)
- Filter CTEs using known table definitions
- Handle quoted identifiers and schema notation
- Comprehensive test coverage
- CLI tool for quick parsing

## Installation

```bash
npm install sql-tables-parser
```

## CLI Usage

### Basic parsing
```bash
sql-parser parse "SELECT * FROM users JOIN orders ON users.id = orders.user_id"
```

### Parse from file
```bash
sql-parser parse query.sql --file
```

### CTE filtering with known tables
```bash
sql-parser parse "WITH temp AS (SELECT * FROM users) SELECT * FROM temp" --known-tables tables.json --filter-ctes
```

### Known Tables JSON Format

Create a JSON file to define your known tables with full metadata:

```json
{
  "users": {
    "tableName": "users",
    "fullyQualifiedName": "public.users",
    "schema": "public",
    "database": "myapp"
  },
  "orders": {
    "tableName": "orders",
    "fullyQualifiedName": "sales.orders",
    "schema": "sales",
    "database": "myapp"
  },
  "user_profiles": {
    "tableName": "user_profiles",
    "fullyQualifiedName": "public.user_profiles",
    "schema": "public"
  }
}
```

The JSON keys can be:
- Simple table names: `"users"`
- Schema-qualified names: `"public.users"`
- Names with spaces (for quoted identifiers): `"user table"`

Each table definition requires:
- `tableName`: The base table name
- `fullyQualifiedName`: The complete name as it should appear in results
- `schema`: (optional) Schema name
- `database`: (optional) Database name

### Other CLI options
```bash
# Custom SQL keywords
sql-parser parse "MERGE INTO users USING source" --keywords "MERGE INTO,USING"

# Verbose output
sql-parser parse "SELECT * FROM products" --verbose

# Show available keywords
sql-parser keywords

# Run demo
sql-parser demo
```

## Library Usage

```typescript
import { SqlTableExtractor, TableMetadata } from 'sql-tables-parser';

// Basic usage
const result = SqlTableExtractor.extractTableNames('SELECT * FROM users JOIN orders ON users.id = orders.user_id');
console.log(result.allTables); // ['users', 'orders']

// With known tables for CTE filtering
const knownTables = new Map<string, TableMetadata>([
  ['users', {
    tableName: 'users',
    fullyQualifiedName: 'public.users',
    schema: 'public'
  }],
  ['orders', {
    tableName: 'orders',
    fullyQualifiedName: 'sales.orders',
    schema: 'sales'
  }]
]);

const sql = `
  WITH temp_users AS (SELECT * FROM users WHERE active = true)
  SELECT * FROM temp_users JOIN orders ON temp_users.id = orders.user_id
`;

const result = SqlTableExtractor.extractTableNames(sql, {
  knownTables,
  filterCTEs: true
});

console.log(result.allTables);     // ['public.users', 'temp_users', 'sales.orders']
console.log(result.realTables);   // ['public.users', 'sales.orders']
console.log(result.filteredCTEs); // ['temp_users']
```

## API Reference

### `SqlTableExtractor.extractTableNames(sql, options?)`

Extracts table names from a SQL query.

**Parameters:**
- `sql`: The SQL query string
- `options`: Optional configuration object
  - `knownTables`: Map of known table metadata
  - `filterCTEs`: Whether to filter CTEs using known tables
  - `keywords`: Custom SQL keywords to look for
  - `customKeywords`: Additional keywords beyond defaults

**Returns:**
- `allTables`: All table names found
- `realTables`: Only real tables (when filtering CTEs)
- `filteredCTEs`: CTEs that were filtered out

### `SqlTableExtractor.getTableNamesSimple(sql, knownTables?)`

Simple helper that returns just an array of table names.

## Supported SQL Features

- SELECT, INSERT, UPDATE, DELETE statements
- All JOIN types (INNER, LEFT, RIGHT, FULL, CROSS, OUTER)
- CTEs with RECURSIVE support
- Subqueries and derived tables
- UNION/UNION ALL
- Window functions
- Quoted identifiers (backticks, double quotes, square brackets)
- Schema notation (schema.table)
- Database notation (database.schema.table)
- Comments (single-line and multi-line)

## License

MIT
