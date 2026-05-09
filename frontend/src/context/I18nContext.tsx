import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { translate, type Lang } from "../i18n/translations";

interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  /** Traduce un key. Si no existe, usa defaultValue o el key como fallback. */
  t: (key: string, vars?: Record<string, string | number>, defaultValue?: string) => string;
}

const Ctx = createContext<I18nCtx | null>(null);

export function useI18n(): I18nCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useI18n must be used inside <I18nProvider>");
  return v;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      const stored = localStorage.getItem("churn-oracle:lang");
      return stored === "en" || stored === "es" ? stored : "es";
    } catch {
      return "es";
    }
  });

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem("churn-oracle:lang", l); } catch { /* noop */ }
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>, defaultValue?: string) =>
      translate(key, lang, vars, defaultValue),
    [lang]
  );

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}
