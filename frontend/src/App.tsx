import type { ReactNode } from "react";
import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import AccountDetail from "./pages/AccountDetail";
import ClosedLoop from "./pages/ClosedLoop";
import { ToastProvider } from "./components/Toast";

function Placeholder({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-center h-64 text-slate-500 text-sm">
      {title} — próximamente
    </div>
  );
}

function Layout({ children }: { children: ReactNode }) {
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
          <nav className="flex gap-1">
            <NavLink to="/" end className={navClass}>Dashboard</NavLink>
            <NavLink to="/closed-loop" className={navClass}>Closed-Loop</NavLink>
            <NavLink to="/upload" className={navClass}>Importar datos</NavLink>
          </nav>
        </div>
      </header>
      <main className="flex-1 px-6 py-8">{children}</main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <Layout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/accounts/:id" element={<AccountDetail />} />
            <Route path="/closed-loop" element={<ClosedLoop />} />
            <Route path="/upload" element={<Placeholder title="Importar datos" />} />
          </Routes>
        </Layout>
      </ToastProvider>
    </BrowserRouter>
  );
}
