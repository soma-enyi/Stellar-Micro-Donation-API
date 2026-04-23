/**
 * Migration: Add missing columns to recurring_donations table
 * Issue #683: Missing columns cause scheduler to crash on startup
 * 
 * Adds:
 * - customIntervalDays: Support for custom interval scheduling
 * - maxExecutions: Cap on total executions
 * - webhookUrl: Webhook notification on completion
 * - failureCount: Track consecutive failures
 * - lastExecutionDate: Track last execution time
 */

const Database = require('../utils/database');

async function up() {
  try {
    const columns = await Database.all(
      "PRAGMA table_info(recurring_donations)"
    );
    
    const columnNames = columns.map(col => col.name);
    const missingColumns = [
      'customIntervalDays',
      'maxExecutions',
      'webhookUrl',
      'failureCount',
      'lastExecutionDate'
    ].filter(col => !columnNames.includes(col));

    for (const col of missingColumns) {
      let columnDef = '';
      switch (col) {
        case 'customIntervalDays':
          columnDef = 'INTEGER DEFAULT NULL';
          break;
        case 'maxExecutions':
          columnDef = 'INTEGER DEFAULT NULL';
          break;
        case 'webhookUrl':
          columnDef = 'TEXT DEFAULT NULL';
          break;
        case 'failureCount':
          columnDef = 'INTEGER DEFAULT 0';
          break;
        case 'lastExecutionDate':
          columnDef = 'DATETIME DEFAULT NULL';
          break;
      }

      await Database.run(
        `ALTER TABLE recurring_donations ADD COLUMN ${col} ${columnDef}`
      );
      console.log(`✓ Added ${col} column to recurring_donations table`);
    }

    if (missingColumns.length === 0) {
      console.log('✓ All required columns already exist on recurring_donations table');
    }
  } catch (error) {
    console.error('✗ Migration failed:', error.message);
    throw error;
  }
}

async function down() {
  try {
    console.log('⚠ Rollback not supported for this migration (SQLite limitation)');
  } catch (error) {
    console.error('✗ Rollback failed:', error.message);
    throw error;
  }
}

module.exports = { up, down };
