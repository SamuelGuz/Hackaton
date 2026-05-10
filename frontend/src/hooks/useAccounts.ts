import { useCallback, useEffect, useMemo, useState } from "react";
import { getAccounts, type AccountFilter } from "../api/accounts";
import { useDataContext } from "../context/DataContext";
import type { AccountSummary } from "../types";

export interface AccountStats {
  total: number;
  critical: number;
  atRisk: number;
  stable: number;
  healthy: number;
  expansion: number;
  arrAtRisk: number;
}

export function useAccounts(filter: AccountFilter, search: string) {
  const { customAccounts } = useDataContext();
  const [all, setAll] = useState<AccountSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  const [fetchNonce, setFetchNonce] = useState(0);

  const refetch = useCallback(() => {
    setFetchNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    // Si hay data importada por el usuario, la usamos directamente.
    if (customAccounts) {
      setAll(customAccounts);
      setLoading(false);
      setError(null);
      setLastFetchedAt(new Date());
      return;
    }

    // Si no, fallback a la API (mock o real).
    setLoading(true);
    setError(null);
    getAccounts("all")
      .then((res) => {
        setAll(res.accounts);
        setLastFetchedAt(new Date());
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [customAccounts, fetchNonce]);

  const filtered = useMemo(() => {
    let list = all;
    if (filter !== "all") list = list.filter((a) => a.healthStatus === filter);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.industry.toLowerCase().includes(q) ||
          a.csm.name.toLowerCase().includes(q) ||
          (a.accountNumber ?? "").toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => b.churnRiskScore - a.churnRiskScore);
  }, [all, filter, search]);

  const stats: AccountStats = useMemo(() => {
    const critical  = all.filter((a) => a.healthStatus === "critical");
    const atRisk    = all.filter((a) => a.healthStatus === "at_risk");
    const stable    = all.filter((a) => a.healthStatus === "stable");
    const healthy   = all.filter((a) => a.healthStatus === "healthy");
    const expansion = all.filter((a) => a.healthStatus === "expanding");
    const arrAtRisk = [...critical, ...atRisk].reduce((s, a) => s + a.arrUsd, 0);
    return {
      total: all.length,
      critical: critical.length,
      atRisk: atRisk.length,
      stable: stable.length,
      healthy: healthy.length,
      expansion: expansion.length,
      arrAtRisk,
    };
  }, [all]);

  return { accounts: filtered, stats, loading, error, lastFetchedAt, refetch };
}
