/**
 * Review Trades — Pipeline de análisis completo de trades
 *
 * Uso: npx tsx scripts/review-trades.ts [fecha]
 *   npx tsx scripts/review-trades.ts              → hoy
 *   npx tsx scripts/review-trades.ts 2026-03-16   → fecha específica
 *
 * Consulta:
 *   1. Decisiones AI (Supabase) — señales, confidence, modelo, razonamiento
 *   2. Trades registrados (Supabase) — entry, SL/TP, estado, PnL
 *   3. Ajustes de posición (Supabase) — cambios de SL/TP por gestión AI
 *   4. Órdenes en Binance — todas las órdenes del día (entry, SL/TP triggered)
 *   5. Fills/Trades en Binance — ejecuciones reales con comisiones
 *   6. Income — PnL realizado, comisiones, funding fees
 *
 * NO forma parte del flujo del bot. Solo se ejecuta manualmente.
 */
import 'dotenv/config';
import { getExchange } from '../src/exchange/binance.js';
import { getSupabase } from '../src/storage/supabase-client.js';
import { SYMBOL } from '../src/config/constants.js';

// Fecha del argumento o hoy
const dateArg = process.argv[2];
const targetDate = dateArg ?? new Date().toISOString().slice(0, 10);
const dateStart = `${targetDate}T00:00:00`;
const dateEnd = `${targetDate}T23:59:59`;

async function main() {
  const exchange = getExchange();
  const supabase = getSupabase();

  console.log(`\n══════════════════════════════════════`);
  console.log(`  REVIEW TRADES — ${targetDate}`);
  console.log(`══════════════════════════════════════\n`);

  // ─── 1. Decisiones AI ───
  console.log('━━━ 1. DECISIONES AI (Supabase) ━━━\n');
  const { data: decisions, error: decErr } = await supabase
    .from('ai_decisions')
    .select('*')
    .gte('created_at', dateStart)
    .lte('created_at', dateEnd)
    .order('created_at', { ascending: true });

  if (decErr) {
    console.log('Error:', decErr.message);
  } else if (decisions && decisions.length > 0) {
    let accepted = 0;
    let rejected = 0;
    let failures = 0;

    for (const d of decisions) {
      if (d.accepted) accepted++;
      else if (d.rejection_reason === 'api_failure') failures++;
      else rejected++;

      const signal = d.ai_signal === 'WAIT' ? '⏸️' : d.ai_signal === 'LONG' ? '🟢' : '🔴';
      console.log(`${signal} ${d.ai_signal} | Conf: ${d.confidence}% | ${d.accepted ? '✅ Aceptada' : `❌ ${d.rejection_reason}`} | ${d.model_used ?? 'N/A'} | ${new Date(d.created_at as string).toISOString().slice(11, 19)} UTC`);

      if (d.ai_signal !== 'WAIT' && d.accepted) {
        console.log(`   Entry: $${d.suggested_entry} | SL: $${d.suggested_stop_loss} | TP: $${d.suggested_take_profit}`);
      }
      if (d.reasoning && d.rejection_reason !== 'api_failure') {
        console.log(`   📝 ${(d.reasoning as string).slice(0, 150)}...`);
      }
    }

    console.log(`\n   Resumen: ${decisions.length} decisiones | ${accepted} aceptadas | ${rejected} rechazadas | ${failures} fallos API\n`);
  } else {
    console.log('(sin decisiones AI)\n');
  }

  // ─── 2. Trades Supabase ───
  console.log('━━━ 2. TRADES REGISTRADOS (Supabase) ━━━\n');
  const { data: trades, error: trErr } = await supabase
    .from('trades')
    .select('*')
    .gte('created_at', dateStart)
    .lte('created_at', dateEnd)
    .order('created_at', { ascending: true });

  if (trErr) {
    console.log('Error:', trErr.message);
  } else if (trades && trades.length > 0) {
    for (const t of trades) {
      const sideEmoji = t.side === 'LONG' ? '🟢' : '🔴';
      console.log(`${sideEmoji} ${t.side} | Entry: $${t.entry_price} | Qty: ${t.quantity} BTC | Size: $${t.position_size_usdt} | ${t.leverage}x | ${t.execution_mode}`);
      console.log(`   SL: $${t.stop_loss_price} | TP: $${t.take_profit_price ?? 'N/A'} | Estado: ${t.status}`);
      console.log(`   Binance Order: ${t.binance_order_id ?? 'N/A'} | SL Order: ${t.sl_order_id ?? 'N/A'} | TP Order: ${t.tp_order_id ?? 'N/A'}`);
      if (t.status === 'closed') {
        const pnlEmoji = Number(t.pnl_usdt) >= 0 ? '🟢' : '🔴';
        console.log(`   ${pnlEmoji} Exit: $${t.exit_price} | PnL: $${t.pnl_usdt} (${t.pnl_percentage}%) | Reason: ${t.exit_reason}`);
      }
      console.log(`   Abierto: ${new Date(t.created_at as string).toISOString().slice(11, 19)} UTC`);
      console.log('');
    }
  } else {
    console.log('(sin trades)\n');
  }

  // ─── 3. Ajustes de posición ───
  console.log('━━━ 3. AJUSTES DE POSICIÓN (Supabase) ━━━\n');
  const { data: adjustments, error: adjErr } = await supabase
    .from('position_adjustments')
    .select('*')
    .gte('created_at', dateStart)
    .lte('created_at', dateEnd)
    .order('created_at', { ascending: true });

  if (adjErr) {
    console.log('Error:', adjErr.message);
  } else if (adjustments && adjustments.length > 0) {
    for (const a of adjustments) {
      console.log(`🔄 ${a.adjustment_type} | Conf: ${a.ai_confidence}% | ${a.model_used ?? 'N/A'} | ${a.executed ? '✅ Ejecutado' : '❌ No ejecutado'}`);
      console.log(`   BTC: $${a.btc_price} | PnL: $${a.unrealized_pnl} | Breakeven: $${a.net_breakeven}`);
      if (a.new_sl !== null) console.log(`   SL: $${a.previous_sl} → $${a.new_sl}`);
      if (a.new_tp !== null) console.log(`   TP: $${a.previous_tp ?? 'N/A'} → $${a.new_tp}`);
      if (a.execution_error) console.log(`   ⚠️ Error: ${a.execution_error}`);
      console.log(`   📝 ${(a.ai_reasoning as string)?.slice(0, 150) ?? 'N/A'}...`);
      console.log(`   ${new Date(a.created_at as string).toISOString().slice(11, 19)} UTC`);
      console.log('');
    }
  } else {
    console.log('(sin ajustes)\n');
  }

  // ─── 4. Órdenes Binance ───
  console.log('━━━ 4. ÓRDENES BINANCE ━━━\n');
  const since = new Date(`${targetDate}T00:00:00Z`).getTime();
  const allOrders = await exchange.fetchOrders(SYMBOL, since, 50);
  for (const o of allOrders) {
    const typeLabel = o.type?.toUpperCase() ?? 'UNKNOWN';
    const stopLabel = o.stopPrice ? ` | Trigger: $${o.stopPrice}` : '';
    const statusEmoji = o.status === 'closed' ? '✅' : o.status === 'canceled' ? '❌' : '⏳';
    console.log(`${statusEmoji} ${typeLabel} ${o.side?.toUpperCase()} | Fill: $${o.average ?? o.price ?? 'N/A'}${stopLabel} | Qty: ${o.filled ?? o.amount} | ${o.datetime?.slice(11, 19) ?? ''} UTC`);
  }
  console.log('');

  // ─── 5. Fills/Trades Binance ───
  console.log('━━━ 5. FILLS/TRADES BINANCE ━━━\n');
  const myTrades = await exchange.fetchMyTrades(SYMBOL, since, 50);
  let totalCommissions = 0;
  for (const t of myTrades) {
    const fee = Number(t.fee?.cost ?? 0);
    totalCommissions += fee;
    console.log(`${t.side?.toUpperCase()} ${t.amount} BTC @ $${t.price} | Cost: $${t.cost} | Fee: $${fee.toFixed(4)} | ${t.datetime?.slice(11, 19) ?? ''} UTC`);
  }
  console.log(`\n   Total comisiones: $${totalCommissions.toFixed(4)}\n`);

  // ─── 6. Income (PnL, comisiones, funding) ───
  console.log('━━━ 6. INCOME (PnL + Comisiones + Funding) ━━━\n');
  const rawSymbol = SYMBOL.replace('/', '').replace(':USDT', '');
  try {
    const incomeTypes = ['REALIZED_PNL', 'COMMISSION', 'FUNDING_FEE'];
    const totals: Record<string, number> = {};

    for (const incomeType of incomeTypes) {
      const income = await exchange.fapiPrivateGetIncome({
        symbol: rawSymbol,
        incomeType,
        startTime: since,
        endTime: since + 86400000,
        limit: 50,
      });
      const entries = income as Array<Record<string, string>>;
      let subtotal = 0;

      if (entries.length > 0) {
        console.log(`── ${incomeType} ──`);
        for (const entry of entries) {
          const amount = Number(entry.income);
          subtotal += amount;
          const time = new Date(Number(entry.time)).toISOString().slice(11, 19);
          console.log(`   ${time} UTC | $${amount >= 0 ? '+' : ''}${amount}`);
        }
        console.log(`   Subtotal: $${subtotal >= 0 ? '+' : ''}${subtotal.toFixed(4)}\n`);
      }
      totals[incomeType] = subtotal;
    }

    const pnlBruto = totals['REALIZED_PNL'] ?? 0;
    const comisiones = totals['COMMISSION'] ?? 0;
    const funding = totals['FUNDING_FEE'] ?? 0;
    const neto = pnlBruto + comisiones + funding;

    console.log('━━━ RESUMEN DEL DÍA ━━━\n');
    console.log(`   PnL bruto:    $${pnlBruto >= 0 ? '+' : ''}${pnlBruto.toFixed(4)}`);
    console.log(`   Comisiones:   $${comisiones.toFixed(4)}`);
    console.log(`   Funding:      $${funding >= 0 ? '+' : ''}${funding.toFixed(4)}`);
    console.log(`   ─────────────────────`);
    console.log(`   PnL NETO:     $${neto >= 0 ? '+' : ''}${neto.toFixed(4)}`);
    console.log('');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.log(`Error obteniendo income: ${msg}\n`);
  }
}

main().catch(console.error);
