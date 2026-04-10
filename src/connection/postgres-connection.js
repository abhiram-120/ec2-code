const Sequelize = require('sequelize');

let postgresSequelizeInstance = null;

function initPostgresSequelizeFromEnv() {
  // Keep credentials out of source control: use env vars instead.
  // Expected env vars:
  // - POSTGRES_HOST
  // - POSTGRES_PORT
  // - POSTGRES_DB
  // - POSTGRES_USER
  // - POSTGRES_PASSWORD
  const host = process.env.POSTGRES_HOST;
  const port = process.env.POSTGRES_PORT ? Number(process.env.POSTGRES_PORT) : 5432;
  const database = process.env.POSTGRES_DB;
  const username = process.env.POSTGRES_USER;
  const password = process.env.POSTGRES_PASSWORD || '';

  if (!host || !database || !username) return null;

  postgresSequelizeInstance = new Sequelize(database, username, password, {
    host,
    port,
    dialect: 'postgres',
    pool: { max: 5, min: 0, idle: 1000 },
    logging: false,
  });

  return postgresSequelizeInstance;
}

async function postgresConnection() {
  try {
    if (!postgresSequelizeInstance) initPostgresSequelizeFromEnv();
    if (!postgresSequelizeInstance) {
      console.log('[postgres] env vars missing. Skipping Postgres connection.');
      return { skipped: true };
    }

    await postgresSequelizeInstance.authenticate();
    // Lightweight query to confirm query path works.
    await postgresSequelizeInstance.query('SELECT 1 AS ok');

    console.log('[postgres] Connection established');
    return { ok: true };
  } catch (err) {
    // Don't crash the whole app if Postgres isn't required yet.
    console.log('[postgres] Connection error:', err.message || err);
    return { ok: false, error: err };
  }
}

function getPostgresSequelize() {
  if (!postgresSequelizeInstance) initPostgresSequelizeFromEnv();
  return postgresSequelizeInstance;
}

module.exports = { postgresConnection, getPostgresSequelize };

