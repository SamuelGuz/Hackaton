import { useState, type ReactNode } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import Dashboard from "./pages/Dashboard";
import AccountDetail from "./pages/AccountDetail";
import ClosedLoop from "./pages/ClosedLoop";
import Interventions from "./pages/Interventions";
import Upload from "./pages/Upload";
import { ToastProvider } from "./components/Toast";
import { DataProvider } from "./context/DataContext";
import { I18nProvider } from "./context/I18nContext";
import Navbar from "./components/Navbar";
import SplashScreen from "./components/SplashScreen";

function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 px-6 py-8">{children}</main>
    </div>
  );
}

export default function App() {
  const [showSplash, setShowSplash] = useState(true);

  return (
    <>
      <AnimatePresence>
        {showSplash && <SplashScreen onDone={() => setShowSplash(false)} />}
      </AnimatePresence>
      <BrowserRouter>
      <I18nProvider>
        <DataProvider>
          <ToastProvider>
            <Layout>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/accounts/:id" element={<AccountDetail />} />
                <Route path="/interventions" element={<Interventions />} />
                <Route path="/closed-loop" element={<ClosedLoop />} />
                <Route path="/upload" element={<Upload />} />
              </Routes>
            </Layout>
          </ToastProvider>
        </DataProvider>
      </I18nProvider>
    </BrowserRouter>
    </>
  );
}
