/**
 * Limpia la data de Supabase dejando solo el último trade y sus registros relacionados
 */
import 'dotenv/config';
import { getSupabase } from '../src/storage/supabase-client.js';

async function main() {
  const sb = getSupabase();

  // 1. Obtener el último trade
  const { data: lastTrade } = await sb
    .from('trades')
    .select('id, ai_decision_id')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!lastTrade) {
    console.log('No hay trades');
    return;
  }

  // 2. Obtener el ai_decision y signal relacionados
  const { data: decision } = await sb
    .from('ai_decisions')
    .select('id, signal_id')
    .eq('id', lastTrade.ai_decision_id)
    .single();

  const keepTradeId = lastTrade.id;
  const keepDecisionId = decision?.id;
  const keepSignalId = decision?.signal_id;

  console.log('Conservando:', { keepTradeId, keepDecisionId, keepSignalId });

  // 3. Borrar trades excepto el último
  const { count: deletedTrades } = await sb
    .from('trades')
    .delete({ count: 'exact' })
    .neq('id', keepTradeId);
  console.log(`Trades eliminados: ${deletedTrades}`);

  // 4. Borrar ai_decisions excepto la relacionada
  if (keepDecisionId) {
    const { count: deletedDecisions } = await sb
      .from('ai_decisions')
      .delete({ count: 'exact' })
      .neq('id', keepDecisionId);
    console.log(`AI decisions eliminadas: ${deletedDecisions}`);
  }

  // 5. Borrar signals excepto la relacionada
  if (keepSignalId) {
    const { count: deletedSignals } = await sb
      .from('signals')
      .delete({ count: 'exact' })
      .neq('id', keepSignalId);
    console.log(`Signals eliminadas: ${deletedSignals}`);
  }

  // 6. Borrar circuit breaker events
  const { count: deletedCb } = await sb
    .from('circuit_breaker_events')
    .delete({ count: 'exact' })
    .gte('id', '00000000-0000-0000-0000-000000000000');
  console.log(`Circuit breaker events eliminados: ${deletedCb}`);

  console.log('Limpieza completada');
}

main().catch(console.error);
