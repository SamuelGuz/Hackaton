import { useCallback, useEffect, useMemo, useState } from "react";
import { getInterventions, type InterventionFilters } from "../api/interventions";
import type { Intervention } from "../types";

export interface InterventionStats {
  total: number;
  pending: number;
  success: number;
  successRate: number;
}

export function useInterventions(filters: InterventionFilters = {}) {
  const [interventions, setInterventions] = useState<Intervention[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  // Serializo los filtros para evitar re-fetches por cambios de referencia.
  const filterKey = JSON.stringify(filters);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getInterventions(filters)
      .then((res) => {
        if (cancelled) return;
        setInterventions(res.interventions);
        setTotal(res.total);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, nonce]);

  const stats: InterventionStats = useMemo(() => {
    const success = interventions.filter((i) => i.outcome === "success").length;
    const pending = interventions.filter((i) => i.status === "pending_approval").length;
    const resolved = interventions.filter((i) => i.outcome !== null);
    const successRate = resolved.length > 0
      ? (resolved.filter((i) => i.outcome === "success" || i.outcome === "partial").length / resolved.length) * 100
      : 0;
    return { total: interventions.length, pending, success, successRate };
  }, [interventions]);

  return { interventions, total, stats, loading, error, refetch };
}
