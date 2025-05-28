# SQL Tables Parser

CLI tool to parse SQL queries and extract table names using a regex-based approach that handles CTEs, joins, schema notation, quoted identifiers, and string literals.

## Features

- **Table Extraction**: Finds tables from FROM, JOIN, UPDATE, DELETE statements
- **CTE Filtering**: Distinguishes between real tables and Common Table Expressions
- **Schema Support**: Handles `schema.table` notation
- **Quoted Identifiers**: Supports backticks, double quotes, and square brackets with spaces
- **String Literal Handling**: Properly ignores SQL keywords inside string literals
- **Comment Removal**: Strips single-line and multi-line SQL comments
- **Function Detection**: Excludes table-valued functions (e.g., `generate_series()`, `UNNEST()`)
- **Configurable Keywords**: Support for custom SQL keywords and database-specific keywords
- **Database-Specific Support**: Pre-configured keywords for PostgreSQL, MySQL, SQL Server, Oracle, BigQuery, Snowflake, and SQLite
- **Special Identifiers**: Handles temp tables (`#table`, `##table`), table variables (`@table`)
- **File Input**: Read SQL from files
- **Known Tables**: Filter results using a known tables list (e.g., from Metabase)

## Setup

```bash
# Install dependencies
pnpm install

# Build the project
pnpm build

# Run tests
pnpm test

# Run in development mode
pnpm dev help
```

## Usage

### Basic Parsing

```bash
# Parse a simple query
sql-parser parse "SELECT * FROM users JOIN orders ON users.id = orders.user_id"

# Parse with verbose output
sql-parser parse "SELECT * FROM products" --verbose
```

### File Input

```bash
# Parse from file
sql-parser parse query.sql --file

# Parse from file with verbose output
sql-parser parse complex-query.sql --file --verbose
```

### Custom Keywords

```bash
# Use custom keywords directly
sql-parser parse "MERGE INTO target USING source" --keywords "MERGE INTO,USING"

# Use database-specific keywords
sql-parser parse "SELECT * FROM users CROSS APPLY permissions" --database sqlserver

# Add additional keywords to defaults
sql-parser parse "COPY INTO users FROM @stage" --custom-keywords "COPY INTO"
```

### View Available Keywords

```bash
# Show all available keywords
sql-parser keywords

# Show keywords for a specific database
sql-parser keywords --database postgresql
```

### CTE Filtering

```bash
# Filter CTEs using known tables
sql-parser parse "WITH temp AS (SELECT * FROM users) SELECT * FROM temp JOIN orders" \
  --known-tables users,orders --filter-ctes

# This will show:
# - All tables: [users, temp, orders]
# - Real tables: [users, orders]
# - Filtered CTEs: [temp]
```

### Test Cases

```bash
# Run built-in test cases
sql-parser test

# Run unit tests
pnpm test
```

## Examples

### Simple Query
```sql
SELECT * FROM users
```
**Output**: `users`

### JOIN with Aliases
```sql
SELECT u.name, p.title
FROM users u
INNER JOIN posts p ON u.id = p.user_id
```
**Output**: `users, posts`

### Quoted Identifiers with Spaces
```sql
SELECT * FROM "user table" JOIN `order-table` ON "user table".id = `order-table`.user_id
```
**Output**: `user table, order-table`

### Schema Notation
```sql
SELECT * FROM public.users JOIN blog.posts ON users.id = posts.user_id
```
**Output**: `public.users, blog.posts`

### Multi-Part Identifiers
```sql
SELECT * FROM [MyDatabase].[dbo].[Users] u
JOIN "public"."orders" o ON u.id = o.user_id
```
**Output**: `MyDatabase.dbo.Users, public.orders`

### String Literals (Ignored)
```sql
SELECT * FROM users
WHERE description = 'This user likes to JOIN groups and FROM time to time UPDATE their profile'
```
**Output**: `users` (keywords in strings are ignored)

### Database-Specific Keywords
```sql
-- SQL Server
SELECT * FROM users CROSS APPLY get_permissions(users.id)
```
**With** `--database sqlserver`: `users, get_permissions`
**Without**: `users` (CROSS APPLY not recognized)

### Custom Keywords
```sql
-- Custom SQL dialect
MERGE INTO target_table
USING source_table ON target_table.id = source_table.id
```
**With** `--keywords "MERGE INTO,USING"`: `target_table, source_table`

### CTE with Filtering
```sql
WITH active_users AS (
  SELECT * FROM users WHERE active = true
)
SELECT * FROM active_users
JOIN orders ON active_users.id = orders.user_id
```
**Without filtering**: `users, active_users, orders`
**With filtering** (`--known-tables users,orders --filter-ctes`):
- Real tables: `users, orders`
- CTEs: `active_users`

### Table-Valued Functions (Excluded)
```sql
SELECT * FROM generate_series(1, 100) AS t(id)
JOIN users u ON t.id = u.id
```
**Output**: `users` (functions like `generate_series` are excluded)

### Temp Tables and Variables
```sql
SELECT * FROM @user_table_variable utv
JOIN ##global_temp_table gtt ON utv.id = gtt.user_id
JOIN #local_temp_table ltt ON gtt.id = ltt.id
```
**Output**: `@user_table_variable, ##global_temp_table, #local_temp_table`

## Keywords Configuration

The parser comes with a default set of SQL keywords that work across most databases:

### Default Keywords
- Basic: `FROM`, `JOIN`, `INNER JOIN`, `LEFT JOIN`, `RIGHT JOIN`, `FULL JOIN`, `CROSS JOIN`, `OUTER JOIN`
- DML: `INTO`, `UPDATE`, `DELETE FROM`, `INSERT INTO`, `REPLACE INTO`, `UPSERT INTO`, `MERGE INTO`, `USING`

### Database-Specific Keywords
- **PostgreSQL**: `LATERAL JOIN`, `RETURNING`
- **MySQL**: `STRAIGHT_JOIN`, `REPLACE INTO`
- **SQL Server**: `CROSS APPLY`, `OUTER APPLY`, `MERGE INTO`, `OUTPUT`
- **Oracle**: `CONNECT BY`, `MERGE INTO`, `MODEL`
- **BigQuery**: `MERGE INTO`
- **Snowflake**: `LATERAL FLATTEN`, `MERGE INTO`, `COPY INTO`
- **SQLite**: `REPLACE INTO`

You can override these defaults using the `--keywords` option or extend them with `--custom-keywords`.

## Testing

The parser includes comprehensive test coverage with 57 tests:

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Generate coverage report
pnpm test:coverage
```

**Test Categories:**
- Basic functionality (simple SELECT, JOINs, schema notation)
- Comment handling (single-line, multi-line, nested)
- Quoted identifiers (backticks, double quotes, square brackets)
- JOIN variations (INNER, LEFT, RIGHT, FULL, CROSS, OUTER)
- CTE handling (basic and recursive CTEs)
- Edge cases (UPDATE, DELETE, INSERT, subqueries, UNION, deduplication)
- String literals containing SQL keywords
- Database-specific syntax (PostgreSQL, MySQL, SQL Server, Oracle, BigQuery, Snowflake)
- Function detection (table-valued functions are excluded)
- Complex nested subqueries
- Temp tables and table variables
- Malformed SQL handling
- Performance tests (large queries, deeply nested subqueries)

## Development

```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm dev

# Build for production
pnpm build

# Clean build artifacts
pnpm clean

# Run tests
pnpm test
```

## CLI Options

| Option | Description |
|--------|-------------|
| `-f, --file` | Read SQL from file instead of argument |
| `-v, --verbose` | Show verbose output including cleaned query |
| `-k, --known-tables <tables>` | Comma-separated list of known table names |
| `--filter-ctes` | Filter out CTEs using known tables list |
| `--keywords <keywords>` | Comma-separated list of SQL keywords (overrides defaults) |
| `--database <type>` | Use keywords for specific database type |
| `--custom-keywords <keywords>` | Additional keywords to include with defaults |
| `--version` | Show version number |

## Algorithm

The parser uses a simplified regex-based approach that:

1. **Removes comments and string literals**:
   - Single-line comments (`-- comment`)
   - Multi-line comments (`/* comment */`)
   - String literals (`'string'` and context-aware `"string"`)

2. **Identifies SQL keywords**: Uses configurable keywords based on database type or custom input

3. **Extracts table names** after keywords, handling:
   - Multi-part identifiers: `[database].[schema].[table]`, `"schema"."table"`, `database.schema.table`
   - Quoted identifiers with spaces: `` `user table` ``, `"user table"`, `[user table]`
   - Temp tables and variables: `#temp`, `##global_temp`, `@variable`
   - Aliases are automatically removed from unquoted identifiers

4. **Filters functions**: Excludes table-valued functions like `generate_series()` in FROM/JOIN contexts

5. **Filters CTEs** when known tables provided

6. **Handles edge cases**:
   - Nested subqueries
   - Window functions
   - UNION queries
   - Database-specific keywords (MERGE INTO, USING, CROSS APPLY, etc.)
   - Unicode identifiers
   - Malformed SQL

## Known Limitations

- **Nested quotes/brackets**: Does not support table names with nested quotes or brackets (e.g., `[table [with] brackets]`)
- **Complex quoted identifiers**: Simplified handling of escaped quotes within quoted identifiers
- **Dynamic SQL**: Cannot parse table names from dynamic SQL strings
- **External data sources**: Special syntax like `OPENROWSET` may be partially captured

The parser prioritizes common, practical use cases over esoteric edge cases, providing reliable parsing for the vast majority of real-world SQL queries.
