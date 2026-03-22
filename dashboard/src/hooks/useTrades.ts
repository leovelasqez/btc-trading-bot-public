import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { TradeFull } from '../lib/types';

export function useTrades(limit = 50) {
  const [trades, setTrades] = useState<TradeFull[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('trades_full')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)
      .then(({ data }) => {
        if (data) setTrades(data as TradeFull[]);
        setLoading(false);
      });

    // Realtime on trades table
    const channel = supabase
      .channel('trades_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trades' },
        async () => {
          // Refetch from view on any change
          const { data } = await supabase
            .from('trades_full')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(limit);
          if (data) setTrades(data as TradeFull[]);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [limit]);

  return { trades, loading };
}
