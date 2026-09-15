const { execSync } = require('child_process');
const { PrismaClient } = require('@prisma/client');
const { testDatabaseUrl, databaseNameOf, withDatabaseName } = require('./testDatabaseUrl');

// Create the test database if it isn't there, then sync the schema once before
// the whole suite runs.
//
// The creation step used to shell out to `createdb renovate_connect_test`,
// which silently assumed a Postgres running on this machine with the current
// OS user as a superuser. We instead connect to the server's own maintenance
// database and issue CREATE DATABASE, so this works against a container or a
// hosted instance just as well as a local one.
async function ensureDatabase(url) {
  const name = databaseNameOf(url);
  // "postgres" exists on every Postgres server and is never the target here.
  const admin = new PrismaClient({
    datasources: { db: { url: withDatabaseName(url, 'postgres') } },
  });

  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
  } catch (err) {
    // Already exists is the normal case on every run after the first. Anything
    // else (no permission to create databases, as on some managed tiers) is
    // worth saying out loud, but isn't fatal — db push below is the real test,
    // and a pre-provisioned database will sail straight through it.
    if (!/already exists/i.test(err.message)) {
      console.warn(
        `[test setup] could not create database "${name}": ${err.message.split('\n').pop()}\n` +
        '[test setup] continuing — create it yourself, or set TEST_DATABASE_URL.'
      );
    }
  } finally {
    await admin.$disconnect();
  }
}

module.exports = async () => {
  const url = testDatabaseUrl();

  await ensureDatabase(url);

  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
};
