/**
 * Ejecuta migraciones SQL contra Supabase via fetch directo al endpoint SQL
 * Uso: npx tsx src/storage/run-migrations.ts
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function runMigrations() {
  logger.info('Ejecutando migraciones via Supabase SQL endpoint...');

  const sqlPath = resolve(__dirname, 'migrations', '001_initial_schema.sql');
  const sql = readFileSync(sqlPath, 'utf-8');

  // Supabase expone un endpoint SQL en /rest/v1/rpc
  // Pero para DDL necesitamos el endpoint de management o usar pg directamente
  // La alternativa más simple: crear una función SQL helper primero via fetch

  const supabaseUrl = env.SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

  // Split SQL into individual statements for execution
  const statements = sql
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('--'));

  // First, create the exec_sql function if it doesn't exist
  const createFnSql = `
    CREATE OR REPLACE FUNCTION exec_sql(query text) RETURNS void AS $$
    BEGIN
      EXECUTE query;
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER;
  `;

  // Try via PostgREST rpc after creating function via raw SQL
  // Use the Supabase SQL endpoint (available with service role key)
  const sqlEndpoint = `${supabaseUrl}/rest/v1/rpc/exec_sql`;

  // First attempt: try to create the helper function via a direct approach
  // We'll try each statement individually via a simple rpc call pattern
  logger.info(`Total statements: ${statements.length}`);

  // Try creating the function first
  const fnRes = await fetch(sqlEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({ query: createFnSql }),
  });

  if (!fnRes.ok) {
    // Function doesn't exist yet - we need to use Supabase Dashboard
    // But let's try the alternative: Supabase has a /pg endpoint for service role
    logger.info('exec_sql no existe, intentando via pg/query endpoint...');

    // Try the Supabase query endpoint (undocumented but works with service role)
    const pgRes = await fetch(`${supabaseUrl}/pg/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ query: createFnSql }),
    });

    if (!pgRes.ok) {
      logger.warn('No se pudo crear exec_sql via pg/query. Ejecutando SQL directamente...');

      // Last resort: execute all SQL as one batch
      const batchRes = await fetch(`${supabaseUrl}/pg/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ query: sql }),
      });

      if (!batchRes.ok) {
        const errText = await batchRes.text();
        logger.error(`pg/query falló: ${batchRes.status} ${errText}`);
        logger.info('');
        logger.info('═══════════════════════════════════════════════════');
        logger.info('  Ejecuta el SQL manualmente en Supabase Dashboard:');
        logger.info('  1. Ve a https://supabase.com/dashboard');
        logger.info('  2. Selecciona tu proyecto');
        logger.info('  3. Ve a SQL Editor');
        logger.info('  4. Pega el contenido de:');
        logger.info('     src/storage/migrations/001_initial_schema.sql');
        logger.info('  5. Click "Run"');
        logger.info('═══════════════════════════════════════════════════');
        return;
      }

      const result = await batchRes.json();
      logger.info({ result }, 'Migración batch ejecutada exitosamente');
      return;
    }

    logger.info('exec_sql creada via pg/query');
  }

  // Now execute each statement via exec_sql
  let executed = 0;
  let errors = 0;

  for (const statement of statements) {
    const preview = statement.substring(0, 60).replace(/\n/g, ' ');
    try {
      const res = await fetch(sqlEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ query: statement }),
      });

      if (res.ok || res.status === 204) {
        logger.info({ preview }, 'OK');
        executed++;
      } else {
        const errText = await res.text();
        logger.warn({ preview, error: errText }, 'Error');
        errors++;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ preview, error: msg }, 'Error');
      errors++;
    }
  }

  logger.info({ executed, errors, total: statements.length }, 'Migraciones completadas');
}

runMigrations().catch((err: unknown) => {
  logger.error(err, 'Error fatal en migraciones');
  process.exit(1);
});
