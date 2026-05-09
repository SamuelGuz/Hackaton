import type { ReactNode } from "react";
import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import AccountDetail from "./pages/AccountDetail";
import ClosedLoop from "./pages/ClosedLoop";
import Upload from "./pages/Upload";
import { ToastProvider } from "./components/Toast";
import { DataProvider } from "./context/DataContext";
import { I18nProvider, useI18n } from "./context/I18nContext";

function LangToggle() {
  const { lang, setLang } = useI18n();
  return (
    <button
      onClick={() => setLang(lang === "es" ? "en" : "es")}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-700 hover:border-slate-500 bg-slate-800/60 hover:bg-slate-700/80 transition-colors text-xs font-semibold text-slate-300 hover:text-white"
      title={lang === "es" ? "Switch to English" : "Cambiar a español"}
    >
      <span className="text-base leading-none">{lang === "es" ? "🇬🇧" : "🇦🇷"}</span>
      {lang === "es" ? "EN" : "ES"}
    </button>
  );
}

function Layout({ children }: { children: ReactNode }) {
  const { t } = useI18n();

  const navClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
      isActive
        ? "bg-slate-800 text-white"
        : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
    }`;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-slate-950/80 backdrop-blur border-b border-slate-800/80 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center gap-8">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-gradient-to-br from-indigo-500 to-fuchsia-500 flex items-center justify-center text-white font-bold text-sm">
              C
            </div>
            <span className="text-white font-semibold text-[15px] tracking-tight">
              Churn Oracle
            </span>
          </div>
          <nav className="flex gap-1 flex-1">
            <NavLink to="/" end className={navClass}>{t("nav.dashboard")}</NavLink>
            <NavLink to="/closed-loop" className={navClass}>{t("nav.closedLoop")}</NavLink>
            <NavLink to="/upload" className={navClass}>{t("nav.import")}</NavLink>
          </nav>
          <LangToggle />
        </div>
      </header>
      <main className="flex-1 px-6 py-8">{children}</main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <I18nProvider>
        <DataProvider>
          <ToastProvider>
            <Layout>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/accounts/:id" element={<AccountDetail />} />
                <Route path="/closed-loop" element={<ClosedLoop />} />
                <Route path="/upload" element={<Upload />} />
              </Routes>
            </Layout>
          </ToastProvider>
        </DataProvider>
      </I18nProvider>
    </BrowserRouter>
  );
}
