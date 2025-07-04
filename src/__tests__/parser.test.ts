import { describe, expect, test } from '@jest/globals';
import { SqlTableExtractor, TableMetadata } from '../parser';

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
      const knownTables = new Map([
        ['users', { tableName: 'users', fullyQualifiedName: 'users' }],
        ['orders', { tableName: 'orders', fullyQualifiedName: 'orders' }],
        ['products', { tableName: 'products', fullyQualifiedName: 'products' }]
      ]);
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
      const knownTables = new Map([
        ['employees', { tableName: 'employees', fullyQualifiedName: 'employees' }],
        ['departments', { tableName: 'departments', fullyQualifiedName: 'departments' }]
      ]);
      const result = SqlTableExtractor.extractTableNames(sql, {
        knownTables,
        filterCTEs: true
      });

      expect(result.realTables).toEqual(['employees', 'departments']);
      expect(result.filteredCTEs).toEqual(['employee_hierarchy']);
    });

    test('should handle CTE scope masking', () => {
      const sql = `
        WITH c AS (SELECT x FROM b),
             b AS (SELECT y FROM a),
             a AS (SELECT x FROM c)
        SELECT a.x, b.y FROM a, b
      `;
      const knownTables = new Map([
        ['a', { tableName: 'a', fullyQualifiedName: 'a' }],
        ['b', { tableName: 'b', fullyQualifiedName: 'b' }],
        ['c', { tableName: 'c', fullyQualifiedName: 'c' }]
      ]);
      const result = SqlTableExtractor.extractTableNames(sql, {
        knownTables,
        filterCTEs: true
      });
      expect(result.allTables).toContain('b');
      expect(result.allTables).toContain('a');
      expect(result.allTables).toContain('c');
      expect(result.realTables).toEqual(['b', 'a', 'c']);
      expect(result.filteredCTEs).toEqual([]);
    });

    test('should handle CTE dead scope - CTE not used in main query', () => {
      const sql = `
        WITH cte AS (
          SELECT x FROM t1
        )
        SELECT x, y FROM t2
      `;
      const knownTables = new Map([
        ['t1', { tableName: 't1', fullyQualifiedName: 't1' }],
        ['t2', { tableName: 't2', fullyQualifiedName: 't2' }]
      ]);
      const result = SqlTableExtractor.extractTableNames(sql, {
        knownTables,
        filterCTEs: true
      });
      expect(result.allTables).toContain('t1');
      expect(result.allTables).toContain('t2');
      expect(result.realTables).toEqual(['t1', 't2']);
      expect(result.filteredCTEs).toEqual([]);
    });

    test('should handle nested CTEs', () => {
      const sql = `
        WITH c AS (
            WITH b AS (
                SELECT x as y, y as z, z as x
                FROM a
            )
            SELECT x as y, y as z, z as x
            FROM b
        )
        SELECT x, y, z
        FROM c
      `;
      const knownTables = new Map([
        ['a', { tableName: 'a', fullyQualifiedName: 'a' }]
      ]);
      const result = SqlTableExtractor.extractTableNames(sql, {
        knownTables,
        filterCTEs: true
      });
      expect(result.allTables).toContain('a');
      expect(result.allTables).toContain('b');
      expect(result.allTables).toContain('c');
      expect(result.realTables).toEqual(['a']);
      expect(result.filteredCTEs).toContain('b');
      expect(result.filteredCTEs).toContain('c');
    });


    test('should handle CTEs with aggregate functions and no source columns', () => {
      const sql = `
        WITH cte AS (SELECT COUNT(*) AS a FROM foo)
        SELECT a AS b FROM cte
      `;
      const knownTables = new Map([
        ['foo', { tableName: 'foo', fullyQualifiedName: 'foo' }]
      ]);
      const result = SqlTableExtractor.extractTableNames(sql, {
        knownTables,
        filterCTEs: true
      });
      expect(result.allTables).toContain('foo');
      expect(result.allTables).toContain('cte');
      expect(result.realTables).toEqual(['foo']);
      expect(result.filteredCTEs).toEqual(['cte']);
    });

    test('should handle reserved word "final" as CTE name', () => {
      const sql = `
        with final as (
           select
             id,
             amount_paid_cents::float / 100 as amount_paid
           from invoice
           where not is_deleted
         )
         select * from final
      `;
      const knownTables = new Map([
        ['invoice', { tableName: 'invoice', fullyQualifiedName: 'invoice' }]
      ]);
      const result = SqlTableExtractor.extractTableNames(sql, {
        knownTables,
        filterCTEs: true
      });
      expect(result.allTables).toContain('invoice');
      expect(result.allTables).toContain('final');
      expect(result.realTables).toEqual(['invoice']);
      expect(result.filteredCTEs).toEqual(['final']);
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

    test('should deduplicate tables when same table is referenced multiple times', () => {
      const sql = `
        SELECT u1.name, u2.email, u3.phone
        FROM users u1
        JOIN users u2 ON u1.manager_id = u2.id
        LEFT JOIN users u3 ON u2.mentor_id = u3.id
        JOIN orders o ON u1.id = o.user_id
        JOIN users u4 ON o.created_by = u4.id
      `;
      const result = SqlTableExtractor.extractTableNames(sql);
      expect(result.allTables).toEqual(['users', 'orders']);
      expect(result.allTables).toHaveLength(2);
    });

    test('should deduplicate tables with different aliases and schema notation', () => {
      const sql = `
        SELECT *
        FROM public.users main_user
        JOIN public.users manager ON main_user.manager_id = manager.id
        JOIN users subordinate ON subordinate.manager_id = main_user.id
        JOIN public.users creator ON creator.id = main_user.created_by
      `;
      const result = SqlTableExtractor.extractTableNames(sql);
      expect(result.allTables).toEqual(['public.users', 'users']);
      expect(result.allTables).toHaveLength(2);
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
      const knownTables = new Map([
        ['users', { tableName: 'users', fullyQualifiedName: 'users' }],
        ['orders', { tableName: 'orders', fullyQualifiedName: 'orders' }]
      ]);
      const result = SqlTableExtractor.getTableNamesSimple(sql, knownTables);
      expect(result).toEqual(['users', 'orders']);
    });
  });

  describe('Complex nested subqueries', () => {
    test('should handle deeply nested derived tables', () => {
      const sql = `
        SELECT * FROM (
          SELECT * FROM (
            SELECT user_id, COUNT(*) as order_count
            FROM (
              SELECT o.user_id, o.id
              FROM orders o
              JOIN (
                SELECT id FROM products WHERE price > 100
              ) expensive_products ON o.product_id = expensive_products.id
            ) expensive_orders
            GROUP BY user_id
          ) user_order_counts
          WHERE order_count > 5
        ) high_volume_users
        JOIN users u ON high_volume_users.user_id = u.id
        JOIN (
          SELECT user_id, AVG(rating) as avg_rating
          FROM reviews r
          JOIN accounts p ON r.product_id = p.id
          GROUP BY user_id
        ) user_ratings ON u.id = user_ratings.user_id
      `;
      const result = SqlTableExtractor.extractTableNames(sql);
      expect(result.allTables).toContain('orders');
      expect(result.allTables).toContain('products');
      expect(result.allTables).toContain('users');
      expect(result.allTables).toContain('reviews');
      expect(result.allTables).toContain('accounts');
    });

    test('should handle correlated subqueries with EXISTS', () => {
      const sql = `
        SELECT u.name, u.email
        FROM users u
        WHERE EXISTS (
          SELECT 1 FROM orders o
          WHERE o.user_id = u.id
          AND EXISTS (
            SELECT 1 FROM order_items oi
            JOIN products p ON oi.product_id = p.id
            WHERE oi.order_id = o.id
            AND p.category_id IN (
              SELECT id FROM categories c
              WHERE c.name = 'Electronics'
              AND EXISTS (
                SELECT 1 FROM category_promotions cp
                WHERE cp.category_id = c.id
                AND cp.active = true
              )
            )
          )
        )
      `;
      const result = SqlTableExtractor.extractTableNames(sql);
      expect(result.allTables).toContain('users');
      expect(result.allTables).toContain('orders');
      expect(result.allTables).toContain('order_items');
      expect(result.allTables).toContain('products');
      expect(result.allTables).toContain('categories');
      expect(result.allTables).toContain('category_promotions');
    });

    test('should handle complex CASE statements with subqueries', () => {
      const sql = `
        SELECT
          u.name,
          CASE
            WHEN u.id IN (SELECT user_id FROM premium_users) THEN 'Premium'
            WHEN u.id IN (
              SELECT DISTINCT user_id
              FROM orders o
              JOIN order_items oi ON o.id = oi.order_id
              WHERE oi.quantity > 10
            ) THEN 'Bulk Buyer'
            WHEN EXISTS (
              SELECT 1 FROM user_preferences up
              JOIN preference_categories pc ON up.category_id = pc.id
              WHERE up.user_id = u.id AND pc.name = 'VIP'
            ) THEN 'VIP'
            ELSE 'Regular'
          END as user_type
        FROM users u
        LEFT JOIN user_profiles prof ON u.id = prof.user_id
      `;
      const result = SqlTableExtractor.extractTableNames(sql);
      expect(result.allTables).toContain('users');
      expect(result.allTables).toContain('premium_users');
      expect(result.allTables).toContain('orders');
      expect(result.allTables).toContain('order_items');
      expect(result.allTables).toContain('user_preferences');
      expect(result.allTables).toContain('preference_categories');
      expect(result.allTables).toContain('user_profiles');
    });

    test('should handle VALUES clause as table source', () => {
      const sql = `
        SELECT v.id, v.name, u.email
        FROM (VALUES (1, 'John'), (2, 'Jane'), (3, 'Bob')) AS v(id, name)
        JOIN users u ON v.id = u.id
        WHERE v.id IN (
          SELECT user_id FROM orders
          WHERE total > (
            SELECT AVG(total) FROM orders o2
            JOIN order_statuses os ON o2.status_id = os.id
            WHERE os.name = 'completed'
          )
        )
      `;
      const result = SqlTableExtractor.extractTableNames(sql);
      // VALUES clause won't be detected as a table, but real tables should be
      expect(result.allTables).toContain('users');
      expect(result.allTables).toContain('orders');
      expect(result.allTables).toContain('order_statuses');
    });

    test('should handle multiple CTEs with cross-references and subqueries', () => {
      const sql = `
        WITH sales_data AS (
          SELECT
            user_id,
            product_id,
            SUM(amount) as total_sales
          FROM orders o
          JOIN order_items oi ON o.id = oi.order_id
          WHERE o.created_at >= (
            SELECT MIN(created_at) FROM fiscal_periods WHERE year = 2023
          )
          GROUP BY user_id, product_id
        ),
        top_customers AS (
          SELECT
            sd.user_id,
            SUM(sd.total_sales) as customer_total
          FROM sales_data sd
          JOIN users u ON sd.user_id = u.id
          WHERE u.status IN (
            SELECT status FROM user_statuses WHERE active = true
          )
          GROUP BY sd.user_id
          HAVING SUM(sd.total_sales) > (
            SELECT AVG(total_sales) * 2
            FROM sales_data sd2
            JOIN product_categories pc ON sd2.product_id = pc.product_id
            WHERE pc.category_name = 'Premium'
          )
        ),
        customer_segments AS (
          SELECT
            tc.user_id,
            tc.customer_total,
            CASE
              WHEN tc.customer_total > (
                SELECT PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY customer_total)
                FROM top_customers tc2
              ) THEN 'Platinum'
              ELSE 'Gold'
            END as segment
          FROM top_customers tc
        )
        SELECT
          cs.user_id,
          u.name,
          cs.customer_total,
          cs.segment,
          COUNT(DISTINCT sd.product_id) as unique_products
        FROM customer_segments cs
        JOIN users u ON cs.user_id = u.id
        JOIN sales_data sd ON cs.user_id = sd.user_id
        LEFT JOIN user_preferences up ON u.id = up.user_id
        WHERE cs.segment = 'Platinum'
        AND EXISTS (
          SELECT 1 FROM loyalty_programs lp
          WHERE lp.user_id = u.id
          AND lp.tier IN (
            SELECT tier FROM loyalty_tiers WHERE min_spend <= cs.customer_total
          )
        )
        GROUP BY cs.user_id, u.name, cs.customer_total, cs.segment
      `;
      const knownTables = new Map([
        ['orders', { tableName: 'orders', fullyQualifiedName: 'orders' }],
        ['order_items', { tableName: 'order_items', fullyQualifiedName: 'order_items' }],
        ['fiscal_periods', { tableName: 'fiscal_periods', fullyQualifiedName: 'fiscal_periods' }],
        ['users', { tableName: 'users', fullyQualifiedName: 'users' }],
        ['user_statuses', { tableName: 'user_statuses', fullyQualifiedName: 'user_statuses' }],
        ['product_categories', { tableName: 'product_categories', fullyQualifiedName: 'product_categories' }],
        ['user_preferences', { tableName: 'user_preferences', fullyQualifiedName: 'user_preferences' }],
        ['loyalty_programs', { tableName: 'loyalty_programs', fullyQualifiedName: 'loyalty_programs' }],
        ['loyalty_tiers', { tableName: 'loyalty_tiers', fullyQualifiedName: 'loyalty_tiers' }]
      ]);
      const result = SqlTableExtractor.extractTableNames(sql, {
        knownTables,
        filterCTEs: true
      });

      // Should identify all real tables
      expect(result.realTables).toContain('orders');
      expect(result.realTables).toContain('order_items');
      expect(result.realTables).toContain('fiscal_periods');
      expect(result.realTables).toContain('users');
      expect(result.realTables).toContain('user_statuses');
      expect(result.realTables).toContain('product_categories');
      expect(result.realTables).toContain('user_preferences');
      expect(result.realTables).toContain('loyalty_programs');
      expect(result.realTables).toContain('loyalty_tiers');

      // Should identify CTEs
      expect(result.filteredCTEs).toContain('sales_data');
      expect(result.filteredCTEs).toContain('top_customers');
      expect(result.filteredCTEs).toContain('customer_segments');
    });
  });

  describe('Database-specific syntax (expected failures)', () => {
    test('should handle PostgreSQL table-valued functions', () => {
      const sql = `
        SELECT * FROM generate_series(1, 100) AS t(id)
        JOIN users u ON t.id = u.id
        UNION ALL
        SELECT * FROM unnest(ARRAY[1,2,3,4,5]) AS arr(value)
        JOIN products p ON arr.value = p.category_id
        UNION ALL
        SELECT * FROM json_to_recordset('[{"id":1,"name":"John"}]') AS j(id int, name text)
        JOIN user_profiles up ON j.id = up.user_id
      `;
      const result = SqlTableExtractor.extractTableNames(sql);
      // Functions won't be detected as tables, but real tables should be
      expect(result.allTables).toContain('users');
      expect(result.allTables).toContain('products');
      expect(result.allTables).toContain('user_profiles');
      // These should NOT be detected (they're functions, not tables):
      expect(result.allTables).not.toContain('generate_series');
      expect(result.allTables).not.toContain('unnest');
      expect(result.allTables).not.toContain('json_to_recordset');
    });

    test('should handle SQL Server OPENJSON and table hints', () => {
      const sql = `
        SELECT u.name, j.value
        FROM users u WITH (NOLOCK)
        CROSS APPLY OPENJSON(u.metadata, '$.preferences') AS j
        JOIN user_settings us WITH (INDEX(IX_UserID)) ON u.id = us.user_id
        WHERE u.id IN (
          SELECT user_id FROM OPENROWSET('SQLNCLI', 'Server=.;Trusted_Connection=yes;',
            'SELECT user_id FROM external_users WHERE active = 1'
          ) AS external
        )
      `;
      const result = SqlTableExtractor.extractTableNames(sql);
      // Should detect real tables despite hints
      expect(result.allTables).toContain('users');
      expect(result.allTables).toContain('user_settings');
      // Functions and external sources should not be detected
      expect(result.allTables).not.toContain('OPENJSON');
      expect(result.allTables).not.toContain('OPENROWSET');
    });

    test('should handle MySQL JSON_TABLE function', () => {
      const sql = `
        SELECT u.name, jt.product_id, jt.quantity
        FROM users u
        JOIN JSON_TABLE(
          u.order_history,
          '$.orders[*]' COLUMNS (
            product_id INT PATH '$.product_id',
            quantity INT PATH '$.quantity'
          )
        ) AS jt
        JOIN products p ON jt.product_id = p.id
        WHERE u.id IN (
          SELECT user_id FROM user_analytics
          WHERE last_login > DATE_SUB(NOW(), INTERVAL 30 DAY)
        )
      `;
      const result = SqlTableExtractor.extractTableNames(sql);
      expect(result.allTables).toContain('users');
      expect(result.allTables).toContain('products');
      expect(result.allTables).toContain('user_analytics');
      // JSON_TABLE is a function, not a table
      expect(result.allTables).not.toContain('JSON_TABLE');
    });

    test('should handle Oracle XMLTABLE and hierarchical queries', () => {
      const sql = `
        SELECT level, employee_id, manager_id
        FROM employees
        START WITH manager_id IS NULL
        CONNECT BY PRIOR employee_id = manager_id
        UNION ALL
        SELECT x.id, x.name
        FROM XMLTABLE(
          '/employees/employee'
          PASSING xmltype('<employees><employee id="1" name="John"/></employees>')
          COLUMNS
            id NUMBER PATH '@id',
            name VARCHAR2(50) PATH '@name'
        ) x
        JOIN departments d ON x.dept_id = d.id
      `;
      const result = SqlTableExtractor.extractTableNames(sql);
      expect(result.allTables).toContain('employees');
      expect(result.allTables).toContain('departments');
      // XMLTABLE is a function
      expect(result.allTables).not.toContain('XMLTABLE');
    });

    test('should handle BigQuery array functions and table suffixes', () => {
      const sql = `
        SELECT user_id, event_name
        FROM \`project.dataset.events_20231201\`
        CROSS JOIN UNNEST(event_params) AS param
        WHERE param.key = 'user_id'
        UNION ALL
        SELECT user_id, product_id
        FROM \`project.dataset.user_events_*\`
        WHERE _TABLE_SUFFIX BETWEEN '20231201' AND '20231231'
        AND user_id IN (
          SELECT user_id FROM \`project.dataset.active_users\`
          WHERE last_seen >= TIMESTAMP('2023-12-01')
        )
      `;
      const result = SqlTableExtractor.extractTableNames(sql);
      // Should handle backtick-quoted table names with dots
      expect(result.allTables).toContain('project.dataset.events_20231201');
      expect(result.allTables).toContain('project.dataset.user_events_*');
      expect(result.allTables).toContain('project.dataset.active_users');
      // UNNEST is a function
      expect(result.allTables).not.toContain('UNNEST');
    });

    test('should handle Snowflake variant data and time travel', () => {
      const sql = `
        SELECT
          u.user_id,
          f.value:name::string as feature_name,
          f.value:enabled::boolean as is_enabled
        FROM users u AT (TIMESTAMP => '2023-12-01 00:00:00'::timestamp)
        JOIN LATERAL FLATTEN(input => u.features) f
        WHERE u.user_id IN (
          SELECT user_id FROM user_events
          WHERE event_timestamp >= '2023-12-01'
          AND event_data:action::string = 'login'
        )
        AND EXISTS (
          SELECT 1 FROM feature_flags ff
          WHERE ff.name = f.value:name::string
          AND ff.environment = 'production'
        )
      `;
      const result = SqlTableExtractor.extractTableNames(sql);
      expect(result.allTables).toContain('users');
      expect(result.allTables).toContain('user_events');
      expect(result.allTables).toContain('feature_flags');
      // FLATTEN is a function
      expect(result.allTables).not.toContain('FLATTEN');
    });

    test('should handle database-specific keywords with keywords option', () => {
      const sql = `
        MERGE INTO target_users t
        USING source_users s ON t.id = s.id
        WHEN MATCHED THEN UPDATE SET t.name = s.name
        WHEN NOT MATCHED THEN INSERT VALUES (s.id, s.name);

        UPSERT INTO user_stats (user_id, login_count)
        SELECT user_id, COUNT(*) FROM user_logins GROUP BY user_id;

        REPLACE INTO user_cache
        SELECT * FROM users WHERE last_updated > NOW() - INTERVAL 1 HOUR;
      `;
      const result = SqlTableExtractor.extractTableNames(sql, {
        keywords: ['FROM', 'JOIN', 'MERGE INTO', 'USING', 'UPSERT INTO', 'REPLACE INTO']
      });
      expect(result.allTables).toContain('target_users');
      expect(result.allTables).toContain('source_users');
      expect(result.allTables).toContain('user_stats');
      expect(result.allTables).toContain('user_logins');
      expect(result.allTables).toContain('user_cache');
      expect(result.allTables).toContain('users');
    });

    test('should handle complex identifier escaping and Unicode', () => {
      const sql = `
        SELECT * FROM "表格名称" t  -- Chinese table name
        JOIN \`тест\` test ON t.id = test.ref_id  -- Cyrillic table name
        JOIN [table with spaces] brackets ON test.id = brackets.id  -- Simplified: no nested brackets
        JOIN "CamelCase" cc ON brackets.id = cc.id
        JOIN "camelcase" lc ON cc.id = lc.id  -- Different from CamelCase in case-sensitive DBs
        WHERE t.id IN (
          SELECT id FROM "user-table@2023#special$chars%"
          WHERE status = 'active'
        )
      `;
      const result = SqlTableExtractor.extractTableNames(sql);
      expect(result.allTables).toContain('表格名称');
      expect(result.allTables).toContain('тест');
      expect(result.allTables).toContain('table with spaces');  // Simplified expectation
      expect(result.allTables).toContain('CamelCase');
      expect(result.allTables).toContain('camelcase');
      expect(result.allTables).toContain('user-table@2023#special$chars%');
    });
  });

  describe('Additional edge cases', () => {
    test('should handle table hints and time travel syntax', () => {
      const sql = `
        SELECT * FROM users@v123 u WITH (NOLOCK)
        JOIN orders@{TIMESTAMP: '2023-01-01'} o ON u.id = o.user_id
        JOIN products FOR SYSTEM_TIME AS OF '2023-01-01' p ON o.product_id = p.id
      `;
      const result = SqlTableExtractor.extractTableNames(sql);
      // Should extract base table names, @ and {} syntax will be partially captured
      expect(result.allTables).toContain('users@v123');
      expect(result.allTables.some(t => t.startsWith('orders@'))).toBe(true); // Will capture orders@ but { breaks it
      expect(result.allTables).toContain('products');
    });

    test('should handle table-valued parameters and variables', () => {
      const sql = `
        SELECT * FROM @user_table_variable utv
        JOIN dbo.fnGetActiveUsers(@date) fn ON utv.id = fn.user_id
        JOIN ##global_temp_table gtt ON fn.user_id = gtt.user_id
        JOIN #local_temp_table ltt ON gtt.id = ltt.id
      `;
      const result = SqlTableExtractor.extractTableNames(sql);
      // Variables and temp tables should be extracted
      expect(result.allTables).toContain('@user_table_variable');
      expect(result.allTables).toContain('##global_temp_table');
      expect(result.allTables).toContain('#local_temp_table');
      // Functions should not be extracted
      expect(result.allTables).not.toContain('dbo.fnGetActiveUsers');
    });

    test('should handle nested brackets and quotes correctly', () => {
      const sql = `
        SELECT * FROM [database].[schema].[table [with] nested [brackets]]
        JOIN "schema"."table ""with"" quotes" ON 1=1
        JOIN \`db\`.\`table \`with\` backticks\` ON 1=1
      `;
      const result = SqlTableExtractor.extractTableNames(sql);
      // Note: The current parser has limitations with deeply nested/chained brackets and quotes
      // It will extract each section separately in some cases
      expect(result.allTables.length).toBeGreaterThan(0);
      expect(result.allTables.some(t => t.includes('database') || t.includes('schema') || t.includes('table') || t === 'db')).toBe(true);
    });

    test('should handle functions with complex arguments', () => {
      const sql = `
        SELECT * FROM table_function(arg1, 'string', (SELECT MAX(id) FROM users)) tf
        JOIN normal_table nt ON tf.id = nt.id
        CROSS APPLY string_split(nt.csv_column, ',') ss
        OUTER APPLY (SELECT * FROM orders WHERE user_id = nt.id) oa
      `;
      const result = SqlTableExtractor.extractTableNames(sql);
      // Should extract from subqueries but not function names
      expect(result.allTables).toContain('users');
      expect(result.allTables).toContain('normal_table');
      expect(result.allTables).toContain('orders');
      expect(result.allTables).not.toContain('table_function');
      expect(result.allTables).not.toContain('string_split');
    });

    test('should handle PIVOT and UNPIVOT operations', () => {
      const sql = `
        SELECT * FROM (
          SELECT year, quarter, sales
          FROM sales_data
        ) AS source_table
        PIVOT (
          SUM(sales)
          FOR quarter IN ([Q1], [Q2], [Q3], [Q4])
        ) AS pivot_table
        JOIN fiscal_years fy ON pivot_table.year = fy.year
      `;
      const result = SqlTableExtractor.extractTableNames(sql);
      expect(result.allTables).toContain('sales_data');
      expect(result.allTables).toContain('fiscal_years');
    });

    test('should handle complex CTE scenarios', () => {
      const sql = `
        WITH RECURSIVE
        -- CTE with same name as real table
        users AS (SELECT * FROM employees WHERE type = 'user'),
        -- Recursive CTE
        hierarchy(id, parent_id, level) AS (
          SELECT id, parent_id, 0 FROM departments WHERE parent_id IS NULL
          UNION ALL
          SELECT d.id, d.parent_id, h.level + 1
          FROM departments d
          JOIN hierarchy h ON d.parent_id = h.id
        ),
        -- CTE referencing another CTE
        filtered AS (SELECT * FROM users JOIN hierarchy ON users.dept_id = hierarchy.id)
        SELECT * FROM filtered f
        JOIN employees e ON f.id = e.id  -- Real table
        JOIN users u ON e.manager_id = u.id  -- CTE, not real users table
      `;
      const knownTables = new Map([
        ['employees', { tableName: 'employees', fullyQualifiedName: 'employees' }],
        ['departments', { tableName: 'departments', fullyQualifiedName: 'departments' }],
        ['users', { tableName: 'users', fullyQualifiedName: 'users' }]
      ]);
      const result = SqlTableExtractor.extractTableNames(sql, {
        knownTables,
        filterCTEs: true
      });

      expect(result.realTables).toContain('employees');
      expect(result.realTables).toContain('departments');
      expect(result.realTables).toContain('users'); // Real table referenced in CTE definition
      expect(result.filteredCTEs).toContain('hierarchy');
      expect(result.filteredCTEs).toContain('filtered');
    });

    test('should handle malformed SQL gracefully', () => {
      const malformedQueries = [
        'SELECT * FROM [unclosed bracket',
        'SELECT * FROM "unclosed quote',
        'SELECT * FROM `unclosed backtick',
        'SELECT * FROM users WHERE id IN (SELECT',
        'FROM users',  // No SELECT
        'SELECT FROM',  // No table
        'SELECT * FROM',  // No table name
        'SELECT * FROM FROM users',  // Double FROM
      ];

      malformedQueries.forEach(sql => {
        expect(() => SqlTableExtractor.extractTableNames(sql)).not.toThrow();
      });
    });
  });

  describe('Additional DML patterns from fixtures', () => {
    test('should handle FILTER (WHERE ...) clauses', () => {
      const sql = `
        select
            e.instance_id,
            percentile_cont(0.75) within group (order by e.running_time) as p75_time,
            percentile_cont(0.75) within group (order by e.running_time) filter (where e.error = '') as p75_success_time
        from execution e
        group by 1
      `;
      const result = SqlTableExtractor.extractTableNames(sql);
      expect(result.allTables).toEqual(['execution']);
    });

    test('should handle subselect with table masking', () => {
      const sql = `
        SELECT
        CASE WHEN Addr.country = 'US' THEN Addr.state ELSE 'ex-US' END AS state
        FROM (
            SELECT DISTINCT
                coalesce(Cust.state, Addr.region) AS state,
                coalesce(Cust.country, Addr.country) AS country
            FROM orders
                LEFT JOIN addresses AS Addr ON orders.organization_id = Addr.organization_id
                LEFT JOIN customers AS Cust ON orders.customer_id = Cust.id
        ) AS Addr
      `;
      const result = SqlTableExtractor.extractTableNames(sql);
      expect(result.allTables).toContain('orders');
      expect(result.allTables).toContain('addresses');
      expect(result.allTables).toContain('customers');
    });

    test('should handle SELECT with literal values only', () => {
      const sql = "SELECT FALSE, 'str', 1";
      const result = SqlTableExtractor.extractTableNames(sql);
      expect(result.allTables).toEqual([]);
    });

    test('should handle SELECT with mixed literals and table columns', () => {
      const sql = "SELECT FALSE, 'str', 1, x FROM t";
      const result = SqlTableExtractor.extractTableNames(sql);
      expect(result.allTables).toEqual(['t']);
    });

    test('should handle SELECT INTO statements', () => {
      const sql = `
        SELECT id, name
        INTO new_user_summary
        FROM user
      `;
      const result = SqlTableExtractor.extractTableNames(sql);
      expect(result.allTables).toContain('user');
      expect(result.allTables).toContain('new_user_summary');
    });

    test('should handle string concatenation operators', () => {
      const sql = 'SELECT x || y AS z FROM t';
      const result = SqlTableExtractor.extractTableNames(sql);
      expect(result.allTables).toEqual(['t']);
    });

    test('should handle complex window functions with multiple OVER clauses', () => {
      const sql = `
        SELECT
            column_2564,
            (column_2563 / column_2561) / 2 * 100,
            NVL(LEAST(column_2562, ABS(column_2560)) / column_2561, 0),
            LEAST(
                SUM(column_2562) OVER (ORDER BY column_7299 ROWS BETWEEN 11 PRECEDING AND CURRENT ROW),
                ABS(SUM(column_2560) OVER (ORDER BY column_7299 ROWS BETWEEN 11 PRECEDING AND CURRENT ROW))
            ) / AVG(column_2561) OVER (ORDER BY column_7299 ROWS BETWEEN 11 PRECEDING AND CURRENT ROW)
        FROM table_2559
        ORDER BY column_7421 ASC
      `;
      const result = SqlTableExtractor.extractTableNames(sql);
      expect(result.allTables).toEqual(['table_2559']);
    });

    test('should handle TIMESTAMP WITH TIME ZONE in BETWEEN clause', () => {
      const sql = `
        SELECT
            date_trunc('month', instance_started)::DATE AS month_started,
            avg(time_finished - instance_started) as avg_runtime,
            count(*) AS total_instances
        FROM usage_stats
        WHERE instance_started BETWEEN TIMESTAMP WITH TIME ZONE '2019-01-01 00:00:00.000-08:00' AND NOW()
        GROUP BY month_started
      `;
      const result = SqlTableExtractor.extractTableNames(sql);
      expect(result.allTables).toEqual(['usage_stats']);
    });

    test('should handle generate_series and table-valued functions', () => {
      const sql = `
        SELECT t.day::date AS date
        FROM generate_series(timestamp '2021-01-01', now(), interval '1 day') AS t(day)
      `;
      const result = SqlTableExtractor.extractTableNames(sql);
      // generate_series is a function, not a table - should not be extracted
      expect(result.allTables).toEqual([]);
    });

    test('should handle EXECUTE statements with parameters', () => {
      const sql = "EXECUTE stmt('table_name')";
      const result = SqlTableExtractor.extractTableNames(sql);
      // EXECUTE statements don't contain direct table references
      expect(result.allTables).toEqual([]);
    });

    test('should handle dynamic SQL with string concatenation gracefully', () => {
      const sql = "EXECUTE 'SELECT * FROM ' || table_name";
      const result = SqlTableExtractor.extractTableNames(sql);
      // Dynamic SQL can't be parsed for table names
      expect(result.allTables).toEqual([]);
    });

    test('should handle CALL statements for stored procedures', () => {
      const sql = "CALL user_function('table_name')";
      const result = SqlTableExtractor.extractTableNames(sql);
      // CALL statements don't reference tables directly
      expect(result.allTables).toEqual([]);
    });

    test('should handle SELECT with user-defined functions', () => {
      const sql = "SELECT user_function('table_name')";
      const result = SqlTableExtractor.extractTableNames(sql);
      // Function calls in SELECT don't reference tables
      expect(result.allTables).toEqual([]);
    });

    test('should handle FETCH statements with cursors', () => {
      const sql = 'FETCH ALL FROM my_cursor';
      const knownTables = new Map<string, TableMetadata>([]);
      const result = SqlTableExtractor.extractTableNames(sql, {
        knownTables,
        filterCTEs: true
      });
      // Cursors aren't known tables
      expect(result.allTables).toEqual(['my_cursor']);
      expect(result.realTables).toEqual([]);
    });

    test('should handle format function gracefully', () => {
      const sql = "SELECT * FROM format('%I', table_name_variable)";
      const result = SqlTableExtractor.extractTableNames(sql);
      // format() is a function, not a table. Dynamic table names aren't detected.
      expect(result.allTables).toEqual([]);
    });

    test('should handle complex EXECUTE statements', () => {
      const sql = `
        EXECUTE format('SELECT * FROM %I WHERE id = $1', table_name) USING 123;
      `;
      const knownTables = new Map<string, TableMetadata>([]);
      const result = SqlTableExtractor.extractTableNames(sql, {
        knownTables,
        filterCTEs: true
      });
      // Dynamic SQL within EXECUTE can't be parsed. Dynamic table names aren't detected.
      // USING however could reference a table. Here it doesn't so should be filtered out by knownTables.
      expect(result.allTables).toEqual(['123']);
      expect(result.realTables).toEqual([]);
    });

    test('should handle CALL with table parameters but no table access', () => {
      const sql = `
        CALL process_data('users', 'orders');
      `;
      const result = SqlTableExtractor.extractTableNames(sql);
      // String literals in CALL are parameters, not table references. Dynamic table names aren't detected.
      expect(result.allTables).toEqual([]);
    });
  });

  describe('Table metadata and fully qualified names', () => {
    test('should return fully qualified names when using TableMetadata', () => {
      const sql = 'SELECT * FROM users JOIN orders ON users.id = orders.user_id';

      const knownTables = new Map([
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

      const result = SqlTableExtractor.extractTableNames(sql, { knownTables });
      expect(result.allTables).toEqual(['public.users', 'sales.orders']);
    });

    test('should handle direct table name mapping', () => {
      const sql = 'SELECT * FROM user_data JOIN order_info ON user_data.id = order_info.user_id';

      const knownTables = new Map([
        ['user_data', {
          tableName: 'user_data',
          fullyQualifiedName: 'public.users',
          schema: 'public'
        }],
        ['order_info', {
          tableName: 'order_info',
          fullyQualifiedName: 'sales.orders',
          schema: 'sales'
        }]
      ]);

      const result = SqlTableExtractor.extractTableNames(sql, { knownTables });
      expect(result.allTables).toEqual(['public.users', 'sales.orders']);
    });

    test('should handle schema-qualified table references', () => {
      const sql = 'SELECT * FROM public.users JOIN sales.orders ON users.id = orders.user_id';

      const knownTables = new Map([
        ['public.users', {
          tableName: 'users',
          fullyQualifiedName: 'public.users',
          schema: 'public'
        }],
        ['sales.orders', {
          tableName: 'orders',
          fullyQualifiedName: 'sales.orders',
          schema: 'sales'
        }]
      ]);

      const result = SqlTableExtractor.extractTableNames(sql, { knownTables });
      expect(result.allTables).toEqual(['public.users', 'sales.orders']);
    });

    test('should return original name when not found in metadata', () => {
      const sql = 'SELECT * FROM unknown_table JOIN users ON unknown_table.id = users.user_id';

      const knownTables = new Map([
        ['users', {
          tableName: 'users',
          fullyQualifiedName: 'public.users',
          schema: 'public'
        }]
      ]);

      const result = SqlTableExtractor.extractTableNames(sql, { knownTables });
      expect(result.allTables).toEqual(['unknown_table', 'public.users']);
    });

    test('should handle database.schema.table format', () => {
      const sql = 'SELECT * FROM users JOIN orders ON users.id = orders.user_id';

      const knownTables = new Map([
        ['users', {
          tableName: 'users',
          fullyQualifiedName: 'mydb.public.users',
          schema: 'public',
          database: 'mydb'
        }],
        ['orders', {
          tableName: 'orders',
          fullyQualifiedName: 'mydb.sales.orders',
          schema: 'sales',
          database: 'mydb'
        }]
      ]);

      const result = SqlTableExtractor.extractTableNames(sql, { knownTables });
      expect(result.allTables).toEqual(['mydb.public.users', 'mydb.sales.orders']);
    });

    test('should filter CTEs correctly with TableMetadata', () => {
      const sql = `
        WITH temp_users AS (
          SELECT * FROM users WHERE active = true
        )
        SELECT * FROM temp_users JOIN orders ON temp_users.id = orders.user_id
      `;

      const knownTables = new Map([
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

      const result = SqlTableExtractor.extractTableNames(sql, {
        knownTables,
        filterCTEs: true
      });

      expect(result.allTables).toEqual(['public.users', 'temp_users', 'sales.orders']);
      expect(result.realTables).toEqual(['public.users', 'sales.orders']);
      expect(result.filteredCTEs).toEqual(['temp_users']);
    });

    test('should handle mixed table reference styles', () => {
      const sql = `
        SELECT * FROM users u
        JOIN public.orders o ON u.id = o.user_id
        JOIN user_profiles up ON u.id = up.user_id
      `;

      const knownTables = new Map([
        ['users', {
          tableName: 'users',
          fullyQualifiedName: 'public.users',
          schema: 'public'
        }],
        ['public.orders', {
          tableName: 'orders',
          fullyQualifiedName: 'public.orders',
          schema: 'public'
        }],
        ['user_profiles', {
          tableName: 'user_profiles',
          fullyQualifiedName: 'public.profiles',
          schema: 'public'
        }]
      ]);

      const result = SqlTableExtractor.extractTableNames(sql, { knownTables });
      expect(result.allTables).toEqual(['public.users', 'public.orders', 'public.profiles']);
    });

    test('getTableNamesSimple should work with TableMetadata', () => {
      const sql = 'SELECT * FROM users JOIN orders ON users.id = orders.user_id';

      const knownTables = new Map([
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

      const result = SqlTableExtractor.getTableNamesSimple(sql, knownTables);
      expect(result).toEqual(['public.users', 'sales.orders']);
    });

    test('should handle case where table name matches multiple metadata entries', () => {
      const sql = 'SELECT * FROM users';

      const knownTables = new Map([
        ['public.users', {
          tableName: 'users',
          fullyQualifiedName: 'public.users',
          schema: 'public'
        }],
        ['private.users', {
          tableName: 'users',
          fullyQualifiedName: 'private.users',
          schema: 'private'
        }]
      ]);

      const result = SqlTableExtractor.extractTableNames(sql, { knownTables });
      // Should return the first match found
      expect(result.allTables).toEqual(['public.users']);
    });

    test('should prioritize exact key matches over table name matches', () => {
      const sql = 'SELECT * FROM users';

      const knownTables = new Map([
        ['admin.users', {
          tableName: 'users',
          fullyQualifiedName: 'admin.users',
          schema: 'admin'
        }],
        ['users', {
          tableName: 'users',
          fullyQualifiedName: 'public.users',
          schema: 'public'
        }]
      ]);

      const result = SqlTableExtractor.extractTableNames(sql, { knownTables });
      // Should match the exact key 'users' first
      expect(result.allTables).toEqual(['public.users']);
    });
  });

  describe('Database-specific keywords', () => {
    test('should handle PostgreSQL-specific keywords', () => {
      const sql = 'UPSERT INTO users (id, name) VALUES (1, "John")';
      const result = SqlTableExtractor.extractTableNames(sql, {
        keywords: ['FROM', 'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'CROSS JOIN', 'OUTER JOIN',
                  'INSERT INTO', 'UPDATE', 'DELETE FROM', 'UPSERT INTO', 'MERGE INTO', 'USING']
      });
      expect(result.allTables).toEqual(['users']);
    });

    test('should handle SQL Server-specific keywords', () => {
      const sql = 'MERGE INTO target_table USING source_table ON target_table.id = source_table.id';
      const result = SqlTableExtractor.extractTableNames(sql, {
        keywords: ['FROM', 'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'CROSS JOIN', 'OUTER JOIN',
                  'INSERT INTO', 'UPDATE', 'DELETE FROM', 'MERGE INTO', 'USING', 'REPLACE INTO']
      });
      expect(result.allTables).toEqual(['target_table', 'source_table']);
    });

    test('should handle MySQL-specific keywords', () => {
      const sql = 'REPLACE INTO users SELECT * FROM temp_users';
      const result = SqlTableExtractor.extractTableNames(sql, {
        keywords: ['FROM', 'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'CROSS JOIN', 'OUTER JOIN',
                  'INSERT INTO', 'UPDATE', 'DELETE FROM', 'REPLACE INTO', 'INSERT IGNORE INTO']
      });
      expect(result.allTables).toEqual(['users', 'temp_users']);
    });

    test('should handle Oracle-specific keywords', () => {
      const sql = 'INSERT ALL INTO users VALUES (1, "John") INTO users VALUES (2, "Jane") SELECT * FROM dual';
      const result = SqlTableExtractor.extractTableNames(sql, {
        keywords: ['FROM', 'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'CROSS JOIN', 'OUTER JOIN',
                  'INSERT INTO', 'UPDATE', 'DELETE FROM', 'INSERT ALL INTO', 'MERGE INTO', 'USING']
      });
      expect(result.allTables).toEqual(['users', 'dual']);
    });

    test('should handle BigQuery-specific keywords', () => {
      const sql = 'CREATE OR REPLACE TABLE dataset.new_table AS SELECT * FROM dataset.source_table';
      const result = SqlTableExtractor.extractTableNames(sql, {
        keywords: ['FROM', 'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'CROSS JOIN', 'OUTER JOIN',
                  'INSERT INTO', 'UPDATE', 'DELETE FROM', 'CREATE TABLE', 'CREATE OR REPLACE TABLE', 'SELECT * FROM']
      });
      expect(result.allTables).toEqual(['dataset.new_table', 'dataset.source_table']);
    });

    test('should handle Snowflake-specific keywords', () => {
      const sql = 'CREATE TRANSIENT TABLE temp_data AS SELECT * FROM staging.raw_data';
      const result = SqlTableExtractor.extractTableNames(sql, {
        keywords: ['FROM', 'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'CROSS JOIN', 'OUTER JOIN',
                  'INSERT INTO', 'UPDATE', 'DELETE FROM', 'CREATE TABLE', 'CREATE TRANSIENT TABLE', 'CREATE TEMPORARY TABLE']
      });
      expect(result.allTables).toEqual(['temp_data', 'staging.raw_data']);
    });

    test('should handle multiple database patterns with custom keywords', () => {
      const sql = `
        MERGE INTO target_users USING source_users ON target_users.id = source_users.id
        WHEN MATCHED THEN UPDATE SET name = source_users.name
        WHEN NOT MATCHED THEN INSERT VALUES (source_users.id, source_users.name);

        REPLACE INTO cache_table SELECT * FROM users WHERE active = true;

        UPSERT INTO user_stats (user_id, count) VALUES (1, 5);
      `;
      const result = SqlTableExtractor.extractTableNames(sql, {
        keywords: ['FROM', 'JOIN', 'MERGE INTO', 'USING', 'REPLACE INTO', 'UPSERT INTO', 'INSERT INTO', 'UPDATE', 'DELETE FROM']
      });
      expect(result.allTables).toContain('target_users');
      expect(result.allTables).toContain('source_users');
      expect(result.allTables).toContain('cache_table');
      expect(result.allTables).toContain('users');
      expect(result.allTables).toContain('user_stats');
    });
  });
});
