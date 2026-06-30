/**
 * Database initialization and connection module
 * 
 * Sets up SQLite database with WAL mode for better concurrency
 * and runs migrations on startup.
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = process.env.DB_PATH || '/app/data/tier-ranking.db';

let db;

/**
 * Initialize database connection and run migrations
 */
export function initDatabase() {
  console.log(`Initializing database at ${DB_PATH}`);
  
  db = new Database(DB_PATH);
  
  // Enable WAL mode for better concurrency
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  
  // Run migrations
  runMigrations();
  
  console.log('Database initialized successfully');
}

/**
 * Run all migration files in order
 */
function runMigrations() {
  const migrationFile = join(__dirname, 'migrations', '001-initial-schema.sql');
  const migrationSQL = readFileSync(migrationFile, 'utf-8');
  
  db.exec(migrationSQL);
  console.log('Migrations completed');
}

/**
 * Get database instance
 * @returns {Database} SQLite database instance
 */
export function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

/**
 * Close database connection
 */
export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
    console.log('Database connection closed');
  }
}
