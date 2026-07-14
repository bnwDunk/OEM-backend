SET @customers_customer_code_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'customers'
    AND COLUMN_NAME = 'customer_code'
);

SET @add_customers_customer_code = IF(
  @customers_customer_code_exists = 0,
  'ALTER TABLE customers ADD COLUMN customer_code VARCHAR(20) NULL DEFAULT NULL AFTER id',
  'SELECT 1'
);

PREPARE add_customers_customer_code_stmt FROM @add_customers_customer_code;
EXECUTE add_customers_customer_code_stmt;
DEALLOCATE PREPARE add_customers_customer_code_stmt;

UPDATE customers
INNER JOIN (
  SELECT
    missing.id,
    CONCAT(missing.prefix, LPAD(COALESCE(existing.max_suffix, 0) + missing.row_number, 4, '0')) AS generated_code
  FROM (
    SELECT
      ordered_rows.id,
      ordered_rows.prefix,
      ROW_NUMBER() OVER (
        PARTITION BY ordered_rows.prefix
        ORDER BY ordered_rows.created_at ASC, ordered_rows.id ASC
      ) AS row_number
    FROM (
      SELECT
        id,
        created_at,
        CONCAT('OEM', DATE_FORMAT(COALESCE(created_at, NOW()), '%y%m')) AS prefix
      FROM customers
      WHERE customer_code IS NULL
         OR customer_code = ''
    ) AS ordered_rows
  ) AS missing
  LEFT JOIN (
    SELECT
      SUBSTRING(customer_code, 1, 7) AS prefix,
      MAX(CAST(SUBSTRING(customer_code, 8) AS UNSIGNED)) AS max_suffix
    FROM customers
    WHERE customer_code REGEXP '^OEM[0-9]{8}$'
    GROUP BY SUBSTRING(customer_code, 1, 7)
  ) AS existing
    ON existing.prefix = missing.prefix
) AS generated
  ON generated.id = customers.id
SET customers.customer_code = generated.generated_code
WHERE customers.customer_code IS NULL
   OR customers.customer_code = '';

SET @customers_customer_code_unique_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'customers'
    AND INDEX_NAME = 'customers_customer_code_unique'
);

SET @add_customers_customer_code_unique = IF(
  @customers_customer_code_unique_exists = 0,
  'ALTER TABLE customers ADD UNIQUE KEY customers_customer_code_unique (customer_code)',
  'SELECT 1'
);

PREPARE add_customers_customer_code_unique_stmt FROM @add_customers_customer_code_unique;
EXECUTE add_customers_customer_code_unique_stmt;
DEALLOCATE PREPARE add_customers_customer_code_unique_stmt;
