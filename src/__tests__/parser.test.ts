import { describe, expect, test } from '@jest/globals';
import { SqlTableExtractor } from '../parser';

describe('SqlTableExtractor', () => {
  describe('Basic functionality', () => {
    test('should extract simple table from SELECT', () => {
      const result = SqlTableExtractor.extractTableNames('SELECT * FROM users');
      expect(result.allTables).toEqual(['users']);
      expect(result.realTables).toEqual(['users']);
      expect(result.filteredCTEs).toEqual([]);
    });

    test('should extract multiple tables from JOINs', () => {
      const sql = 'SELECT * FROM users u JOIN orders o ON u.id = o.user_id';
      const result = SqlTableExtractor.extractTableNames(sql);
      expect(result.allTables).toEqual(['users', 'orders']);
    });

    test('should handle schema notation', () => {
      const sql = 'SELECT * FROM public.users JOIN blog.posts ON users.id = posts.user_id';
      const result = SqlTableExtractor.extractTableNames(sql);
      expect(result.allTables).toEqual(['public.users', 'blog.posts']);
    });
  });

  describe('Comment handling', () => {
    test('should remove single-line comments', () => {
      const sql = `
        SELECT * FROM users -- This is a comment
        JOIN orders ON users.id = orders.user_id -- Another comment
      `;
      const result = SqlTableExtractor.extractTableNames(sql);
      expect(result.allTables).toEqual(['users', 'orders']);
    });

    test('should remove multi-line comments', () => {
      const sql = `
        SELECT * FROM /* comment */ users
        JOIN /* another
               multi-line comment */ orders
        ON users.id = orders.user_id
      `;
      const result = SqlTableExtractor.extractTableNames(sql);
      expect(result.allTables).toEqual(['users', 'orders']);
    });

    test('should handle nested comments', () => {
      const sql = `
        SELECT * FROM users /* outer /* inner */ comment */
        JOIN orders ON users.id = orders.user_id
      `;
      const result = SqlTableExtractor.extractTableNames(sql);
      expect(result.allTables).toEqual(['users', 'orders']);
    });
  });

  describe('Quoted identifiers', () => {
    test('should handle backtick quoted tables', () => {
      const sql = 'SELECT * FROM `user table` JOIN `order-table` ON `user table`.id = `order-table`.user_id';
      const result = SqlTableExtractor.extractTableNames(sql);
      expect(result.allTables).toEqual(['user table', 'order-table']);
    });

    test('should handle double quoted tables', () => {
      const sql = 'SELECT * FROM "user table" JOIN "order table" ON "user table".id = "order table".user_id';
      const result = SqlTableExtractor.extractTableNames(sql);
      expect(result.allTables).toEqual(['user table', 'order table']);
    });

    test('should handle square bracket quoted tables', () => {
      const sql = 'SELECT * FROM [user table] JOIN [order table] ON [user table].id = [order table].user_id';
      const result = SqlTableExtractor.extractTableNames(sql);
      expect(result.allTables).toEqual(['user table', 'order table']);
    });

    test('should handle mixed quote types', () => {
      const sql = 'SELECT * FROM `users` JOIN "orders" CROSS JOIN [products] ON users.id = orders.user_id';
      const result = SqlTableExtractor.extractTableNames(sql);
      expect(result.allTables).toEqual(['users', 'orders', 'products']);
    });
  });

  describe('JOIN variations', () => {
    test('should handle all JOIN types', () => {
      const sql = `
        SELECT * FROM users u
        INNER JOIN orders o ON u.id = o.user_id
        LEFT JOIN profiles p ON u.id = p.user_id
        RIGHT JOIN addresses a ON u.id = a.user_id
        FULL JOIN payments pay ON o.id = pay.order_id
        CROSS JOIN products prod
        OUTER JOIN reviews r ON u.id = r.user_id
      `;
      const result = SqlTableExtractor.extractTableNames(sql);
      expect(result.allTables).toEqual([
        'users', 'orders', 'profiles', 'addresses', 'payments', 'products', 'reviews'
      ]);
    });

    test('should handle JOIN with complex ON conditions', () => {
      const sql = `
        SELECT * FROM users u
        JOIN orders o ON u.id = o.user_id AND u.active = true
        JOIN products p ON o.product_id = p.id AND p.available = true
      `;
      const result = SqlTableExtractor.extractTableNames(sql);
      expect(result.allTables).toEqual(['users', 'orders', 'products']);
    });
  });

  describe('CTE handling', () => {
    test('should identify CTEs vs real tables', () => {
      const sql = `
        WITH active_users AS (
          SELECT * FROM users WHERE active = true
        ),
        user_orders AS (
          SELECT * FROM orders WHERE user_id IN (SELECT id FROM active_users)
        )
        SELECT * FROM user_orders uo
        JOIN products p ON uo.product_id = p.id
      `;
      const knownTables = new Set(['users', 'orders', 'products']);
      const result = SqlTableExtractor.extractTableNames(sql, {
        knownTables,
        filterCTEs: true
      });

      expect(result.allTables).toEqual(['users', 'orders', 'active_users', 'user_orders', 'products']);
      expect(result.realTables).toEqual(['users', 'orders', 'products']);
      expect(result.filteredCTEs).toEqual(['active_users', 'user_orders']);
    });

    test('should handle recursive CTEs', () => {
      const sql = `
        WITH RECURSIVE employee_hierarchy AS (
          SELECT id, name, manager_id, 1 as level
          FROM employees
          WHERE manager_id IS NULL

          UNION ALL

          SELECT e.id, e.name, e.manager_id, eh.level + 1
          FROM employees e
          JOIN employee_hierarchy eh ON e.manager_id = eh.id
        )
        SELECT * FROM employee_hierarchy
        JOIN departments d ON employee_hierarchy.dept_id = d.id
      `;
      const knownTables = new Set(['employees', 'departments']);
      const result = SqlTableExtractor.extractTableNames(sql, {
        knownTables,
        filterCTEs: true
      });

      expect(result.realTables).toEqual(['employees', 'departments']);
      expect(result.filteredCTEs).toEqual(['employee_hierarchy']);
    });
  });

  describe('Esoteric and edge cases', () => {
    test('should handle UPDATE statements', () => {
      const sql = 'UPDATE users SET name = "John" WHERE id = 1';
      const result = SqlTableExtractor.extractTableNames(sql);
      expect(result.allTables).toEqual(['users']);
    });

    test('should handle DELETE statements', () => {
      const sql = 'DELETE FROM users WHERE inactive = true';
      const result = SqlTableExtractor.extractTableNames(sql);
      expect(result.allTables).toEqual(['users']);
    });

    test('should handle INSERT INTO statements', () => {
      const sql = 'INSERT INTO users (name, email) VALUES ("John", "john@example.com")';
      const result = SqlTableExtractor.extractTableNames(sql);
      expect(result.allTables).toEqual(['users']);
    });

    test('should handle subqueries in FROM clause', () => {
      const sql = `
        SELECT * FROM (
          SELECT user_id, COUNT(*) as order_count
          FROM orders
          GROUP BY user_id
        ) subquery
        JOIN users ON subquery.user_id = users.id
      `;
      const result = SqlTableExtractor.extractTableNames(sql);
      expect(result.allTables).toEqual(['orders', 'users']);
    });

    test('should handle UNION queries', () => {
      const sql = `
        SELECT name FROM users WHERE active = true
        UNION
        SELECT name FROM archived_users WHERE archived_date > '2023-01-01'
        UNION ALL
        SELECT name FROM temp_users
      `;
      const result = SqlTableExtractor.extractTableNames(sql);
      expect(result.allTables).toEqual(['users', 'archived_users', 'temp_users']);
    });

    test('should handle window functions with OVER clause', () => {
      const sql = `
        SELECT
          user_id,
          order_date,
          ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY order_date) as row_num
        FROM orders o
        JOIN users u ON o.user_id = u.id
      `;
      const result = SqlTableExtractor.extractTableNames(sql);
      expect(result.allTables).toEqual(['orders', 'users']);
    });

    test('should handle complex nested queries', () => {
      const sql = `
        SELECT u.name,
               (SELECT COUNT(*) FROM orders WHERE user_id = u.id) as order_count,
               (SELECT AVG(rating) FROM reviews r JOIN products p ON r.product_id = p.id WHERE r.user_id = u.id) as avg_rating
        FROM users u
        WHERE u.id IN (
          SELECT DISTINCT user_id
          FROM purchases pur
          JOIN payment_methods pm ON pur.payment_method_id = pm.id
          WHERE pm.type = 'credit_card'
        )
      `;
      const result = SqlTableExtractor.extractTableNames(sql);
      expect(result.allTables).toEqual(['orders', 'reviews', 'products', 'users', 'purchases', 'payment_methods']);
    });

    test('should handle table names with numbers and underscores', () => {
      const sql = `
        SELECT * FROM user_data_2023 ud
        JOIN order_history_v2 oh ON ud.user_id = oh.user_id
        JOIN product_catalog_temp pct ON oh.product_id = pct.id
      `;
      const result = SqlTableExtractor.extractTableNames(sql);
      expect(result.allTables).toEqual(['user_data_2023', 'order_history_v2', 'product_catalog_temp']);
    });

    test('should handle very long table names', () => {
      const sql = `
        SELECT * FROM this_is_a_very_long_table_name_that_someone_might_actually_use_in_production
        JOIN another_extremely_long_table_name_with_lots_of_descriptive_words ON
        this_is_a_very_long_table_name_that_someone_might_actually_use_in_production.id =
        another_extremely_long_table_name_with_lots_of_descriptive_words.ref_id
      `;
      const result = SqlTableExtractor.extractTableNames(sql);
      expect(result.allTables).toEqual([
        'this_is_a_very_long_table_name_that_someone_might_actually_use_in_production',
        'another_extremely_long_table_name_with_lots_of_descriptive_words'
      ]);
    });

    test('should handle case insensitive keywords', () => {
      const sql = `
        select * from users u
        inner join orders o on u.id = o.user_id
        left join products p on o.product_id = p.id
      `;
      const result = SqlTableExtractor.extractTableNames(sql);
      expect(result.allTables).toEqual(['users', 'orders', 'products']);
    });

    test('should handle mixed case keywords', () => {
      const sql = `
        Select * From users u
        Inner Join orders o On u.id = o.user_id
        LEFT join products p ON o.product_id = p.id
      `;
      const result = SqlTableExtractor.extractTableNames(sql);
      expect(result.allTables).toEqual(['users', 'orders', 'products']);
    });

    test('should handle tables with special characters in quotes', () => {
      const sql = `
        SELECT * FROM "user-table@2023" ut
        JOIN "order#table$special" ots ON ut.id = ots.user_id
        JOIN \`product/table%weird\` ptw ON ots.product_id = ptw.id
      `;
      const result = SqlTableExtractor.extractTableNames(sql);
      expect(result.allTables).toEqual(['user-table@2023', 'order#table$special', 'product/table%weird']);
    });

    test('should handle empty and whitespace-only queries', () => {
      expect(SqlTableExtractor.extractTableNames('').allTables).toEqual([]);
      expect(SqlTableExtractor.extractTableNames('   ').allTables).toEqual([]);
      expect(SqlTableExtractor.extractTableNames('\n\t  \n').allTables).toEqual([]);
    });

    test('should handle queries with only comments', () => {
      const sql = `
        -- This is just a comment
        /* And this is a multi-line comment
           with multiple lines */
        -- Another comment
      `;
      const result = SqlTableExtractor.extractTableNames(sql);
      expect(result.allTables).toEqual([]);
    });

    test('should handle malformed SQL gracefully', () => {
      const sql = 'SELECT * FROM users WHERE'; // Incomplete query
      const result = SqlTableExtractor.extractTableNames(sql);
      expect(result.allTables).toEqual(['users']);
    });

    test('should handle SQL with string literals containing keywords', () => {
      const sql = `
        SELECT * FROM users
        WHERE description = 'This user likes to JOIN groups and FROM time to time UPDATE their profile'
        AND notes != "DELETE this user FROM the system"
      `;
      const result = SqlTableExtractor.extractTableNames(sql);
      expect(result.allTables).toEqual(['users']);
    });
  });

  describe('Custom keywords', () => {
    test('should handle custom keywords', () => {
      const sql = 'MERGE INTO users USING temp_users ON users.id = temp_users.id';
      const result = SqlTableExtractor.extractTableNames(sql, {
        customKeywords: ['MERGE INTO', 'USING']
      });
      expect(result.allTables).toEqual(['users', 'temp_users']);
    });
  });

  describe('Performance edge cases', () => {
    test('should handle very large queries', () => {
      // Generate a query with many JOINs
      const tables = Array.from({ length: 100 }, (_, i) => `table_${i}`);
      const joins = tables.slice(1).map((table, i) =>
        `JOIN ${table} ON table_0.id = ${table}.ref_id`
      ).join(' ');
      const sql = `SELECT * FROM table_0 ${joins}`;

      const result = SqlTableExtractor.extractTableNames(sql);
      expect(result.allTables).toEqual(tables);
    });

    test('should handle deeply nested subqueries', () => {
      const sql = `
        SELECT * FROM users WHERE id IN (
          SELECT user_id FROM orders WHERE id IN (
            SELECT order_id FROM order_items WHERE product_id IN (
              SELECT id FROM products WHERE category_id IN (
                SELECT id FROM categories WHERE parent_id IN (
                  SELECT id FROM category_hierarchy WHERE level = 1
                )
              )
            )
          )
        )
      `;
      const result = SqlTableExtractor.extractTableNames(sql);
      expect(result.allTables).toEqual([
        'users', 'orders', 'order_items', 'products', 'categories', 'category_hierarchy'
      ]);
    });
  });

  describe('getTableNamesSimple helper', () => {
    test('should return simple array of table names', () => {
      const sql = 'SELECT * FROM users JOIN orders ON users.id = orders.user_id';
      const result = SqlTableExtractor.getTableNamesSimple(sql);
      expect(result).toEqual(['users', 'orders']);
    });

    test('should filter CTEs when known tables provided', () => {
      const sql = `
        WITH temp AS (SELECT * FROM users)
        SELECT * FROM temp JOIN orders ON temp.id = orders.user_id
      `;
      const knownTables = new Set(['users', 'orders']);
      const result = SqlTableExtractor.getTableNamesSimple(sql, knownTables);
      expect(result).toEqual(['users', 'orders']);
    });
  });
});
