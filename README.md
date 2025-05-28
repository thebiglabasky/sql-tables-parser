# SQL Tables Parser

CLI tool to parse SQL queries and extract table names using a regex-based approach that handles CTEs, joins, schema notation, quoted identifiers, and string literals.

## Features

- **Table Extraction**: Finds tables from FROM, JOIN, UPDATE, DELETE statements
- **CTE Filtering**: Distinguishes between real tables and Common Table Expressions
- **Schema Support**: Handles `schema.table` notation
- **Quoted Identifiers**: Supports backticks, double quotes, and square brackets with spaces
- **String Literal Handling**: Properly ignores SQL keywords inside string literals
- **Comment Removal**: Strips single-line and multi-line SQL comments
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

### String Literals (Ignored)
```sql
SELECT * FROM users
WHERE description = 'This user likes to JOIN groups and FROM time to time UPDATE their profile'
```
**Output**: `users` (keywords in strings are ignored)

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

## Testing

The parser includes comprehensive test coverage:

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
| `--version` | Show version number |

## Algorithm

The parser uses a sophisticated regex-based approach that:

1. **Removes comments and string literals**:
   - Single-line comments (`-- comment`)
   - Multi-line comments (`/* comment */`)
   - String literals (`'string'` and context-aware `"string"`)

2. **Identifies SQL keywords**: FROM, JOIN variants, UPDATE, DELETE FROM, etc.

3. **Extracts table names** after keywords, handling:
   - Quoted identifiers with spaces: `` `user table` ``, `"user table"`, `[user table]`
   - Schema notation: `schema.table`
   - Aliases: `table alias` (preserves quoted names, removes aliases from unquoted)

4. **Filters CTEs** when known tables provided

5. **Handles edge cases**:
   - Nested subqueries
   - Window functions
   - UNION queries
   - Custom keywords
   - Malformed SQL
