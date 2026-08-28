// Where the test database lives.
//
// This used to be hardcoded to `postgresql://danieljeznach@localhost:5432/
// renovate_connect_test` — one developer's macOS username, against a Postgres
// running on that developer's own machine. The suite only ran there, and only
// for as long as the database stayed local.
//
// Resolution order:
//   1. TEST_DATABASE_URL — an explicit override always wins.
//   2. DATABASE_URL (process env first, then api/.env), with "_test" appended
//      to the database name. The suite follows the dev database wherever it
//      is — a local Postgres, a container, a hosted instance — with nothing
//      machine-specific written down.
//
// The suffix is not cosmetic: globalSetup runs `prisma db push
// --accept-data-loss`, so pointing the suite at the dev database itself would
// wipe it.

const fs = require('fs');
const path = require('path');

const ENV_FILE = path.join(__dirname, '..', '.env');

// Minimal .env reader. We can't require('dotenv') — it's only present as a
// transitive dependency of prisma — and this runs before anything constructs a
// PrismaClient, which is what would otherwise load api/.env for us.
function fromEnvFile(key) {
  let text;
  try {
    text = fs.readFileSync(ENV_FILE, 'utf8');
  } catch {
    return undefined;
  }
  const line = text.split('\n').find((l) => l.trimStart().startsWith(`${key}=`));
  if (!line) return undefined;
  const value = line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
  return value || undefined;
}

function databaseNameOf(url) {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}

// Swap the database name, preserving user, host, port and any query string
// (?sslmode=require and friends matter for hosted Postgres).
function withDatabaseName(url, name) {
  const u = new URL(url);
  u.pathname = `/${encodeURIComponent(name)}`;
  return u.toString();
}

function testDatabaseUrl() {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;

  const dev = process.env.DATABASE_URL || fromEnvFile('DATABASE_URL');
  if (!dev) {
    throw new Error(
      'No database configured for the test suite. Set DATABASE_URL in api/.env ' +
      '(the tests use the same server with a "_test" database), or set ' +
      'TEST_DATABASE_URL to point them somewhere else entirely.'
    );
  }

  const name = databaseNameOf(dev);
  if (!name) {
    throw new Error(`DATABASE_URL has no database name: ${dev.replace(/\/\/[^@]*@/, '//***@')}`);
  }
  return withDatabaseName(dev, name.endsWith('_test') ? name : `${name}_test`);
}

module.exports = { testDatabaseUrl, databaseNameOf, withDatabaseName };
