#!/usr/bin/env node
//
// One-off repair: strip the hostname out of locally-served upload URLs that
// were written to the database before storage.js started persisting
// root-relative paths.
//
// Rows used to be saved as e.g.
//   http://Daniels-MacBook-Air-204.local:3000/uploads/ff07….jpg
// which is a dead link from any other machine or network. This rewrites them to
//   /uploads/ff07….jpg
// which app.js expands per-request (middleware/absoluteUploadUrls.js).
//
// Only hosts that can never be a real CDN are touched: http:// of any host, and
// https:// only for localhost / *.local / raw IPv4. S3 and CDN URLs are left
// alone. Handles both text and text[] columns, discovered from the live schema
// rather than hardcoded, so new URL-bearing columns are covered automatically.
//
//   node scripts/relativize-upload-urls.js          # dry run, prints changes
//   node scripts/relativize-upload-urls.js --apply  # writes

const { PrismaClient } = require('@prisma/client');

const db = new PrismaClient();
const APPLY = process.argv.includes('--apply');

// Postgres POSIX regex for "an upload URL whose host is definitely not a CDN".
const LOCAL_UPLOAD_RE =
  '^(http://[^/]+|https://(localhost|[^/]*\\.local|([0-9]{1,3}\\.){3}[0-9]{1,3})(:[0-9]+)?)/uploads/';

async function textColumns() {
  return db.$queryRawUnsafe(`
    SELECT table_name, column_name, data_type, udt_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND (data_type IN ('text', 'character varying')
           OR (data_type = 'ARRAY' AND udt_name IN ('_text', '_varchar')))
    ORDER BY table_name, column_name
  `);
}

async function main() {
  let total = 0;

  for (const col of await textColumns()) {
    const t = `"${col.table_name}"`;
    const c = `"${col.column_name}"`;
    const isArray = col.data_type === 'ARRAY';

    // Match rows containing at least one offending value.
    const where = isArray
      ? `EXISTS (SELECT 1 FROM unnest(${c}) v WHERE v ~ '${LOCAL_UPLOAD_RE}')`
      : `${c} ~ '${LOCAL_UPLOAD_RE}'`;

    let rows;
    try {
      rows = await db.$queryRawUnsafe(`SELECT ${c} AS val FROM ${t} WHERE ${where} LIMIT 20`);
    } catch {
      continue; // table without the column visible to us, view, etc.
    }
    if (rows.length === 0) continue;

    for (const r of rows) {
      const vals = isArray ? r.val : [r.val];
      for (const v of vals) {
        if (typeof v === 'string' && v.includes('/uploads/')) {
          console.log(`  ${col.table_name}.${col.column_name}: ${v}`);
        }
      }
    }

    // The replacement keeps everything from "/uploads/" onward.
    const expr = isArray
      ? `(SELECT array_agg(regexp_replace(v, '${LOCAL_UPLOAD_RE}', '/uploads/')) FROM unnest(${c}) v)`
      : `regexp_replace(${c}, '${LOCAL_UPLOAD_RE}', '/uploads/')`;

    if (APPLY) {
      const n = await db.$executeRawUnsafe(`UPDATE ${t} SET ${c} = ${expr} WHERE ${where}`);
      console.log(`${col.table_name}.${col.column_name}: rewrote ${n} row(s)`);
      total += n;
    } else {
      const [{ c: n }] = await db.$queryRawUnsafe(`SELECT count(*)::int c FROM ${t} WHERE ${where}`);
      console.log(`${col.table_name}.${col.column_name}: ${n} row(s) would change`);
      total += n;
    }
  }

  console.log(
    total === 0
      ? 'Nothing to do — no host-qualified upload URLs in the database.'
      : APPLY
        ? `Done. ${total} row(s) rewritten.`
        : `${total} row(s) would change. Re-run with --apply to write.`
  );
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => db.$disconnect());
