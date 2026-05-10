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

export function useAccounts(
  filter: AccountFilter,
  search: string,
  accountNumber: string = "all",
) {
  const { customAccounts } = useDataContext();
  const [all, setAll] = useState<AccountSummary[]>([]);
  /** Cuentas que coinciden con el filtro de estado (segunda query al API cuando filter !== "all"). */
  const [accountsForStatusFilter, setAccountsForStatusFilter] = useState<AccountSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  const [fetchNonce, setFetchNonce] = useState(0);

  const refetch = useCallback(() => {
    setFetchNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (customAccounts) {
      setAll(customAccounts);
      setLoading(false);
      setError(null);
      setLastFetchedAt(new Date());
      return;
    }

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

  // Segunda query: solo Nº de cuenta del subset que cumple el estado (evita listar 150 cuando hay 3 críticos).
  useEffect(() => {
    if (customAccounts) {
      setAccountsForStatusFilter([]);
      return;
    }

    if (filter === "all") {
      setAccountsForStatusFilter([]);
      return;
    }

    const ac = new AbortController();

    getAccounts(filter)
      .then((res) => {
        if (ac.signal.aborted) return;
        setAccountsForStatusFilter(res.accounts);
      })
      .catch((e: Error) => {
        if (ac.signal.aborted || e.name === "AbortError") return;
        setAccountsForStatusFilter([]);
      });

    return () => ac.abort();
  }, [filter, customAccounts]);

  const filtered = useMemo(() => {
    let list = all;
    if (filter !== "all") list = list.filter((a) => a.healthStatus === filter);
    if (accountNumber !== "all") {
      list = list.filter((a) => (a.accountNumber ?? "") === accountNumber);
    }
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
  }, [all, filter, search, accountNumber]);

  const accountNumbers = useMemo(() => {
    let source: AccountSummary[];
    if (customAccounts) {
      source =
        filter === "all"
          ? customAccounts
          : customAccounts.filter((a) => a.healthStatus === filter);
    } else if (filter === "all") {
      source = all;
    } else {
      // Respuesta del GET filtrado; si aún no llegó o falló, mismo subset desde la carga completa (sin parpadear el dropdown vacío).
      source =
        accountsForStatusFilter.length > 0
          ? accountsForStatusFilter
          : all.filter((a) => a.healthStatus === filter);
    }

    const seen = new Set<string>();
    for (const a of source) {
      const n = (a.accountNumber ?? "").trim();
      if (n) seen.add(n);
    }
    return Array.from(seen).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
    );
  }, [all, customAccounts, filter, accountsForStatusFilter]);

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

  return { accounts: filtered, accountNumbers, stats, loading, error, lastFetchedAt, refetch };
}
