import { useEffect, useMemo, useState } from "react";
import { getPlaybooks, getFeaturedEvolution, type FeaturedEvolution } from "../api/playbooks";
import type { Playbook } from "../types";

export interface PlaybookStats {
  total: number;
  totalUses: number;
  totalSuccesses: number;
  avgSuccessRate: number;
  versionsLearned: number;
}

export function usePlaybooks() {
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [featured, setFeatured] = useState<FeaturedEvolution | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([getPlaybooks(), getFeaturedEvolution()])
      .then(([res, evo]) => {
        setPlaybooks(res.playbooks);
        setFeatured(evo);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const stats: PlaybookStats = useMemo(() => {
    const active = playbooks.filter((p) => !p.supersededBy);
    const totalUses = playbooks.reduce((s, p) => s + p.timesUsed, 0);
    const totalSuccesses = playbooks.reduce((s, p) => s + p.timesSucceeded, 0);
    return {
      total: active.length,
      totalUses,
      totalSuccesses,
      avgSuccessRate: totalUses ? totalSuccesses / totalUses : 0,
      versionsLearned: playbooks.reduce((s, p) => s + p.version, 0),
    };
  }, [playbooks]);

  return { playbooks, featured, stats, loading, error };
}
