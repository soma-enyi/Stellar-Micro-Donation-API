/**
 * Migration: Add deleted_at column to users table
 * Issue #682: Missing deleted_at column causes cleanup job to crash
 */

const Database = require('../utils/database');

async function up() {
  try {
    // Check if column already exists
    const columns = await Database.all(
      "PRAGMA table_info(users)"
    );
    
    const hasDeletedAt = columns.some(col => col.name === 'deleted_at');
    
    if (!hasDeletedAt) {
      await Database.run(
        `ALTER TABLE users ADD COLUMN deleted_at DATETIME DEFAULT NULL`
      );
      console.log('✓ Added deleted_at column to users table');
    } else {
      console.log('✓ deleted_at column already exists on users table');
    }
  } catch (error) {
    console.error('✗ Migration failed:', error.message);
    throw error;
  }
}

async function down() {
  try {
    // SQLite doesn't support DROP COLUMN easily, so we skip rollback
    console.log('⚠ Rollback not supported for this migration (SQLite limitation)');
  } catch (error) {
    console.error('✗ Rollback failed:', error.message);
    throw error;
  }
}

module.exports = { up, down };
