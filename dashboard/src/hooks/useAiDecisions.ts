import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { AiDecision } from '../lib/types';

export function useAiDecisions(limit = 50) {
  const [decisions, setDecisions] = useState<AiDecision[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('ai_decisions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)
      .then(({ data }) => {
        if (data) setDecisions(data as AiDecision[]);
        setLoading(false);
      });

    const channel = supabase
      .channel('ai_decisions_changes')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'ai_decisions' },
        (payload) => {
          setDecisions((prev) => [payload.new as AiDecision, ...prev].slice(0, limit));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [limit]);

  return { decisions, loading };
}
