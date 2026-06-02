const { execSync } = require('child_process');

// Create the test database (ignore "already exists") and sync the schema once
// before the whole suite runs.
module.exports = async () => {
  const url =
    process.env.TEST_DATABASE_URL ||
    'postgresql://danieljeznach@localhost:5432/renovate_connect_test';

  try {
    execSync('createdb renovate_connect_test', { stdio: 'ignore' });
  } catch {
    // Database already exists — fine.
  }

  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
};
