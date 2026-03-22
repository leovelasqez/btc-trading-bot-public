import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { BotState } from '../lib/types';

export function useBotState() {
  const [state, setState] = useState<BotState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Initial fetch
    supabase
      .from('bot_state')
      .select('*')
      .eq('id', 1)
      .single()
      .then(({ data }) => {
        if (data) setState(data as BotState);
        setLoading(false);
      });

    // Realtime subscription
    const channel = supabase
      .channel('bot_state_changes')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'bot_state' },
        (payload) => {
          setState(payload.new as BotState);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return { state, loading };
}
