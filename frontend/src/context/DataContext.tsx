import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { AccountSummary } from "../types";

const STORAGE_KEY = "churn-oracle:imported-accounts";

interface DataCtx {
  customAccounts: AccountSummary[] | null;
  importedAt: string | null;
  setCustomAccounts: (accounts: AccountSummary[]) => void;
  reset: () => void;
}

const Ctx = createContext<DataCtx | null>(null);

export function useDataContext(): DataCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDataContext must be used inside <DataProvider>");
  return v;
}

interface Stored {
  accounts: AccountSummary[];
  importedAt: string;
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [customAccounts, setCustomAccountsState] = useState<AccountSummary[] | null>(null);
  const [importedAt, setImportedAt] = useState<string | null>(null);

  // Cargar del localStorage al montar
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Stored;
      if (Array.isArray(parsed.accounts) && parsed.accounts.length > 0) {
        setCustomAccountsState(parsed.accounts);
        setImportedAt(parsed.importedAt);
      }
    } catch {
      // localStorage corrupto → ignorar y usar mocks
    }
  }, []);

  const setCustomAccounts = (accounts: AccountSummary[]) => {
    const now = new Date().toISOString();
    setCustomAccountsState(accounts);
    setImportedAt(now);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ accounts, importedAt: now }));
    } catch {
      // quota excedida o navegador en modo privado
    }
  };

  const reset = () => {
    setCustomAccountsState(null);
    setImportedAt(null);
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
  };

  return (
    <Ctx.Provider value={{ customAccounts, importedAt, setCustomAccounts, reset }}>
      {children}
    </Ctx.Provider>
  );
}
