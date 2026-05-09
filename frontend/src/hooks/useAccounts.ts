import { useEffect, useMemo, useState } from "react";
import { getAccounts, type AccountFilter } from "../api/accounts";
import { useDataContext } from "../context/DataContext";
import type { AccountSummary } from "../types";

export interface AccountStats {
  total: number;
  atRisk: number;
  expansion: number;
  arrAtRisk: number;
}

export function useAccounts(filter: AccountFilter, search: string) {
  const { customAccounts } = useDataContext();
  const [all, setAll] = useState<AccountSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Si hay data importada por el usuario, la usamos directamente.
    if (customAccounts) {
      setAll(customAccounts);
      setLoading(false);
      setError(null);
      return;
    }

    // Si no, fallback a la API (mock o real).
    setLoading(true);
    setError(null);
    getAccounts("all")
      .then((res) => setAll(res.accounts))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [customAccounts]);

  const filtered = useMemo(() => {
    let list = all;
    if (filter === "at_risk") list = list.filter((a) => a.churnRiskScore >= 60);
    if (filter === "expansion") list = list.filter((a) => a.expansionScore >= 60);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.industry.toLowerCase().includes(q) ||
          a.csm.name.toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => b.churnRiskScore - a.churnRiskScore);
  }, [all, filter, search]);

  const stats: AccountStats = useMemo(() => {
    const atRisk = all.filter((a) => a.churnRiskScore >= 60);
    const expansion = all.filter((a) => a.expansionScore >= 60);
    return {
      total: all.length,
      atRisk: atRisk.length,
      expansion: expansion.length,
      arrAtRisk: atRisk.reduce((s, a) => s + a.arrUsd, 0),
    };
  }, [all]);

  return { accounts: filtered, stats, loading, error };
}
