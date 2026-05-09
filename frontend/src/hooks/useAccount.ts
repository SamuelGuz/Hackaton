import { useEffect, useState } from "react";
import { getAccount, getTimeline } from "../api/accounts";
import { useDataContext } from "../context/DataContext";
import type { AccountDetail, AccountSummary, TimelineEvent } from "../types";

function summaryToDetail(s: AccountSummary): AccountDetail {
  return {
    id: s.id,
    name: s.name,
    industry: s.industry,
    size: s.size,
    geography: "latam",
    plan: s.plan,
    arrUsd: s.arrUsd,
    seatsPurchased: 0,
    seatsActive: 0,
    signupDate: new Date(Date.now() - 365 * 86400 * 1000).toISOString(),
    contractRenewalDate: s.contractRenewalDate,
    champion: {
      name: s.championName,
      email:        s.contact?.email        ?? "—",
      phone:        s.contact?.phone        ?? "—",
      slackContact: s.contact?.slackContact ?? "—",
      role: "—",
      changedRecently: false,
    },
    csmAssigned: s.csmAssigned,
    lastQbrDate: null,
    health: {
      status: s.healthStatus,
      churnRiskScore: s.churnRiskScore,
      topSignals: [],
      predictedChurnReason: "Sin análisis disponible · conectá el backend para ver el razonamiento del agente.",
      crystalBallReasoning: "Esta cuenta proviene de tu archivo importado. El razonamiento detallado se generará cuando el backend de agentes esté conectado.",
      expansionScore: s.expansionScore,
      readyToExpand: s.expansionScore >= 60,
    },
  };
}

export function useAccount(id: string | undefined) {
  const { customAccounts } = useDataContext();
  const [account, setAccount] = useState<AccountDetail | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;

    // Si la cuenta viene de un Excel importado, no hay backend que la conozca:
    // armamos el detalle desde el summary y dejamos el timeline vacío.
    if (customAccounts) {
      const match = customAccounts.find((a) => a.id === id);
      if (match) {
        setAccount(summaryToDetail(match));
        setEvents([]);
        setLoading(false);
        setError(null);
        return;
      }
    }

    setLoading(true);
    setError(null);
    Promise.all([getAccount(id), getTimeline(id)])
      .then(([acc, tl]) => {
        setAccount(acc);
        setEvents(tl.events);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id, customAccounts]);

  return { account, events, loading, error };
}
