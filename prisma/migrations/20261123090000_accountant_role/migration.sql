-- A new web role: the Accountant (branch scope, Fee Management). Alone in its migration: PostgreSQL
-- cannot use a new enum value in the transaction that adds it.
ALTER TYPE "Role" ADD VALUE 'ACCOUNTANT';
