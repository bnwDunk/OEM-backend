USE oem_app;

SET @customers_due_date_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'customers'
    AND COLUMN_NAME = 'due_date'
);

SET @add_customers_due_date = IF(
  @customers_due_date_exists = 0,
  'ALTER TABLE customers ADD COLUMN due_date DATE NULL DEFAULT NULL AFTER volume',
  'SELECT 1'
);

PREPARE add_customers_due_date_stmt FROM @add_customers_due_date;
EXECUTE add_customers_due_date_stmt;
DEALLOCATE PREPARE add_customers_due_date_stmt;

SET @customers_salesperson_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'customers'
    AND COLUMN_NAME = 'salesperson'
);

SET @add_customers_salesperson = IF(
  @customers_salesperson_exists = 0,
  'ALTER TABLE customers ADD COLUMN salesperson VARCHAR(190) NULL DEFAULT NULL AFTER due_date',
  'SELECT 1'
);

PREPARE add_customers_salesperson_stmt FROM @add_customers_salesperson;
EXECUTE add_customers_salesperson_stmt;
DEALLOCATE PREPARE add_customers_salesperson_stmt;
