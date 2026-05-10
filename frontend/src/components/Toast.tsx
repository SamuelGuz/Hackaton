import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";

type ToastVariant = "info" | "success" | "warning" | "error";
type Toast = { id: number; message: string; variant: ToastVariant };

interface ToastCtx {
  push: (message: string, variant?: ToastVariant) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

export function useToast(): ToastCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

const variantClasses: Record<ToastVariant, string> = {
  info:    "bg-slate-800 border-slate-600 text-slate-100",
  success: "bg-emerald-900/80 border-emerald-700 text-emerald-100",
  warning: "bg-amber-900/80 border-amber-700 text-amber-100",
  error:   "bg-rose-900/80 border-rose-700 text-rose-100",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, variant: ToastVariant = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, variant }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-6 right-6 flex flex-col gap-2 z-50 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto px-4 py-3 rounded-lg border shadow-xl text-sm font-medium min-w-[260px] animate-slide-in ${variantClasses[t.variant]}`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
