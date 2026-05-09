import { useEffect, useState } from "react";
import { getAccount, getTimeline } from "../api/accounts";
import type { AccountDetail, TimelineEvent } from "../types";

export function useAccount(id: string | undefined) {
  const [account, setAccount] = useState<AccountDetail | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    Promise.all([getAccount(id), getTimeline(id)])
      .then(([acc, tl]) => {
        setAccount(acc);
        setEvents(tl.events);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  return { account, events, loading, error };
}
