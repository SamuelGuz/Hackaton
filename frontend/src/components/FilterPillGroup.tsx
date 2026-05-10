import { motion } from "framer-motion";
import type { ReactNode } from "react";

const pillSpring = { type: "spring" as const, stiffness: 420, damping: 32 };

export type FilterPillOption<T extends string> = {
  value: T;
  /** Texto o nodo (iconos + texto) */
  label: ReactNode;
  /** Contador u otro anexo a la derecha del label */
  suffix?: ReactNode;
};

type FilterPillGroupProps<T extends string> = {
  /** Único por grupo en pantalla (evita colisión entre dos barras de filtros). */
  layoutId: string;
  value: T;
  onChange: (value: T) => void;
  options: FilterPillOption<T>[];
  size?: "md" | "sm";
  className?: string;
};

/**
 * Pills de filtro con píldora activa animada (shared layout), misma familia que el nav principal.
 */
export function FilterPillGroup<T extends string>({
  layoutId,
  value,
  onChange,
  options,
  size = "md",
  className = "",
}: FilterPillGroupProps<T>) {
  const pad = size === "sm" ? "px-3 py-1.5 text-xs" : "px-3.5 py-1.5 text-sm";

  return (
    <div
      className={`flex gap-0.5 bg-slate-900/70 border border-slate-800 rounded-lg p-1 ${className}`}
    >
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`relative flex items-center gap-2 rounded-md font-medium transition-colors duration-200 ease-out ${pad} ${
              active ? "text-white" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {active ? (
              <motion.span
                layoutId={layoutId}
                className="pointer-events-none absolute inset-0 z-0 rounded-md bg-slate-700 shadow-sm"
                transition={pillSpring}
                initial={false}
              />
            ) : null}
            <span className="relative z-[1] flex min-w-0 items-center gap-2">
              {opt.label}
              {opt.suffix != null ? <span className="shrink-0">{opt.suffix}</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
