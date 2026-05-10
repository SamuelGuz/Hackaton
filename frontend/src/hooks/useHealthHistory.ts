import { useEffect, useState } from "react";
import { getAccountHealthHistory } from "../api/accounts";
import type { AccountHealthHistoryItem } from "../types";

export function useHealthHistory(accountId: string | undefined, enabled: boolean) {
  const [items, setItems] = useState<AccountHealthHistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accountId || !enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getAccountHealthHistory(accountId, { limit: 200 })
      .then((res) => {
        if (cancelled) return;
        setItems(res.items);
        setTotal(res.total);
      })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [accountId, enabled]);

  return { items, total, loading, error };
}
