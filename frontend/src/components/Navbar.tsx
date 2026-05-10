import { useState, useEffect } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useI18n } from "../context/I18nContext";

/* ─── Icons ───────────────────────────────────────────────────── */
function IconDashboard() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1.5"/>
      <rect x="14" y="3" width="7" height="7" rx="1.5"/>
      <rect x="14" y="14" width="7" height="7" rx="1.5"/>
      <rect x="3" y="14" width="7" height="7" rx="1.5"/>
    </svg>
  );
}
function IconLoop() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 2l4 4-4 4"/>
      <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
      <path d="M7 22l-4-4 4-4"/>
      <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
    </svg>
  );
}
function IconUpload() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="17 8 12 3 7 8"/>
      <line x1="12" y1="3" x2="12" y2="15"/>
    </svg>
  );
}

/* ─── Pulsing Live Dot ─────────────────────────────────────────── */
function LiveDot() {
  return (
    <div className="flex items-center gap-1.5">
      <div className="relative flex items-center justify-center">
        <span className="navbar-live-ring" />
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 relative z-10" />
      </div>
      <span className="text-[10px] font-bold tracking-widest text-emerald-400/80 uppercase">Live</span>
    </div>
  );
}

/* ─── Language Toggle ──────────────────────────────────────────── */
function LangToggle() {
  const { lang, setLang } = useI18n();
  const isEs = lang === "es";
  return (
    <motion.button
      onClick={() => setLang(isEs ? "en" : "es")}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700/60 hover:border-indigo-500/50 bg-slate-900/60 hover:bg-indigo-950/40 transition-all duration-200 text-xs font-semibold text-slate-400 hover:text-indigo-300 overflow-hidden group"
      title={isEs ? "Switch to English" : "Cambiar a español"}
    >
      <span className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-gradient-to-r from-indigo-500/5 to-fuchsia-500/5" />
      <AnimatePresence mode="wait">
        <motion.span
          key={lang}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.15 }}
          className="text-sm leading-none"
        >
          {isEs ? "🇬🇧" : "🇦🇷"}
        </motion.span>
      </AnimatePresence>
      <AnimatePresence mode="wait">
        <motion.span
          key={lang + "-label"}
          initial={{ opacity: 0, x: 4 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -4 }}
          transition={{ duration: 0.15 }}
        >
          {isEs ? "EN" : "ES"}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
}

/* ─── Nav Item ─────────────────────────────────────────────────── */
interface NavItemProps {
  to: string;
  end?: boolean;
  icon: React.ReactNode;
  label: string;
}

function NavItem({ to, end, icon, label }: NavItemProps) {
  const location = useLocation();

  return (
    <NavLink to={to} end={end} className="relative outline-none">
      {({ isActive: routerActive }) => {
        const active = end
          ? location.pathname === to
          : routerActive;

        return (
          <motion.div
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            className={`relative flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors duration-200 select-none cursor-pointer z-10 ${
              active
                ? "text-white"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {active && (
              <motion.div
                layoutId="nav-pill"
                className="absolute inset-0 rounded-lg navbar-active-pill"
                transition={{ type: "spring", stiffness: 400, damping: 35 }}
              />
            )}
            <span className={`relative z-10 transition-colors duration-200 ${active ? "text-indigo-300" : ""}`}>
              {icon}
            </span>
            <span className="relative z-10">{label}</span>
          </motion.div>
        );
      }}
    </NavLink>
  );
}

/* ─── Logo ─────────────────────────────────────────────────────── */
function Logo() {
  return (
    <div className="flex items-center gap-2.5 group cursor-default select-none">
      <div className="relative">
        <span className="navbar-logo-halo" />
        <div className="relative w-8 h-8 rounded-xl navbar-logo-icon flex items-center justify-center text-white font-bold text-sm z-10">
          C
        </div>
      </div>
      <div className="flex flex-col leading-none">
        <span className="navbar-brand-text font-bold text-[15px] tracking-tight">
          Churn Oracle
        </span>
        <span className="text-[9px] tracking-[0.2em] text-slate-500 font-medium uppercase mt-0.5">
          Predict · Act · Retain
        </span>
      </div>
    </div>
  );
}

/* ─── Navbar ───────────────────────────────────────────────────── */
export default function Navbar() {
  const { t } = useI18n();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 12);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  return (
    <motion.header
      initial={{ y: -80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 30, delay: 0.05 }}
      className={`sticky top-0 z-40 transition-all duration-500 ${
        scrolled
          ? "navbar-scrolled"
          : "navbar-top"
      }`}
    >
      {/* Animated gradient border bottom */}
      <div className="navbar-gradient-line" />

      <div className="max-w-7xl mx-auto px-6 py-3 flex items-center gap-6">
        {/* Logo */}
        <Logo />

        {/* Nav links */}
        <nav className="flex gap-0.5 flex-1">
          <NavItem to="/" end icon={<IconDashboard />} label={t("nav.dashboard")} />
          <NavItem to="/closed-loop" icon={<IconLoop />} label={t("nav.closedLoop")} />
          <NavItem to="/upload" icon={<IconUpload />} label={t("nav.import")} />
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-4">
          <LiveDot />
          <div className="w-px h-5 bg-slate-800" />
          <LangToggle />
        </div>
      </div>
    </motion.header>
  );
}
