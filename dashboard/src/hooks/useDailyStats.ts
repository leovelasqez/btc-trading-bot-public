import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { DailyStats } from '../lib/types';

export function useDailyStats(days = 30) {
  const [stats, setStats] = useState<DailyStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('daily_stats')
      .select('*')
      .order('trade_date', { ascending: false })
      .limit(days)
      .then(({ data }) => {
        if (data) setStats((data as DailyStats[]).reverse());
        setLoading(false);
      });
  }, [days]);

  return { stats, loading };
}
