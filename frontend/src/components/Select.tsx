import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";

export type SelectOption<T extends string> = {
  value: T;
  label: string;
  /** Texto chico al lado derecho de la opción (típicamente un contador). */
  hint?: string | number;
  /** Dot de color (clases tailwind, ej. "bg-rose-400") junto al label. */
  dotClass?: string;
  disabled?: boolean;
};

type SelectProps<T extends string> = {
  value: T;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  label?: string;
  /** Si es true, muestra un input de búsqueda dentro del panel. */
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyText?: string;
  minWidthClass?: string;
  /** Ancho del panel desplegable. Por defecto coincide con el trigger. */
  panelWidthClass?: string;
  ariaLabel?: string;
  className?: string;
};

const Chevron = ({ open }: { open: boolean }) => (
  <svg
    width="11"
    height="11"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`transition-transform duration-200 ease-out ${open ? "rotate-180" : "rotate-0"}`}
    aria-hidden="true"
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const Check = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const SearchIcon = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

export function Select<T extends string>({
  value,
  onChange,
  options,
  label,
  searchable = false,
  searchPlaceholder,
  emptyText,
  minWidthClass = "min-w-[10rem]",
  panelWidthClass,
  ariaLabel,
  className = "",
}: SelectProps<T>) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [dropDir, setDropDir] = useState<"down" | "up">("down");
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});

  const selectedOption = useMemo(
    () => options.find((o) => o.value === value) ?? options[0],
    [options, value],
  );

  const filteredOptions = useMemo(() => {
    if (!searchable || !query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
    );
  }, [options, query, searchable]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  // Recalcula posición y dirección del panel a partir del trigger.
  const updatePanelPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const desired = 360;
    const margin = 8;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const goUp = spaceBelow < desired && spaceAbove > spaceBelow;
    setDropDir(goUp ? "up" : "down");

    const style: CSSProperties = {
      position: "fixed",
      left: Math.round(rect.left),
    };
    if (!panelWidthClass) {
      style.width = Math.round(rect.width);
    }
    if (goUp) {
      style.bottom = Math.round(window.innerHeight - rect.top + margin);
    } else {
      style.top = Math.round(rect.bottom + margin);
    }
    setPanelStyle(style);
  }, [panelWidthClass]);

  // Cuando se abre: enfoca search (si aplica) y resalta la opción seleccionada.
  useEffect(() => {
    if (!open) return;
    const idx = filteredOptions.findIndex((o) => o.value === value);
    setHighlightIdx(idx >= 0 ? idx : 0);
    if (searchable) {
      requestAnimationFrame(() => searchInputRef.current?.focus());
    }
  }, [open, searchable, value]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset highlight cuando cambia el filtro de búsqueda.
  useEffect(() => {
    if (!open) return;
    setHighlightIdx(0);
  }, [query, open]);

  // Click fuera + Escape global.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        triggerRef.current?.contains(t) ||
        panelRef.current?.contains(t)
      ) {
        return;
      }
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  // Calcula la posición inicial del panel cuando se abre.
  useLayoutEffect(() => {
    if (!open) return;
    updatePanelPosition();
  }, [open, updatePanelPosition]);

  // Reposiciona el panel mientras está abierto (scroll/resize en cualquier ancestro).
  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => updatePanelPosition();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, updatePanelPosition]);

  // Scroll al item resaltado.
  useEffect(() => {
    if (!open) return;
    const el = optionRefs.current[highlightIdx];
    if (el && listRef.current) {
      const list = listRef.current;
      const top = el.offsetTop;
      const bottom = top + el.offsetHeight;
      if (top < list.scrollTop) list.scrollTop = top;
      else if (bottom > list.scrollTop + list.clientHeight) {
        list.scrollTop = bottom - list.clientHeight;
      }
    }
  }, [highlightIdx, open]);

  const commit = (v: T) => {
    onChange(v);
    close();
  };

  const onPanelKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (filteredOptions.length === 0) return;
      setHighlightIdx((i) => {
        let next = i;
        for (let step = 0; step < filteredOptions.length; step++) {
          next = (next + 1) % filteredOptions.length;
          if (!filteredOptions[next].disabled) return next;
        }
        return i;
      });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (filteredOptions.length === 0) return;
      setHighlightIdx((i) => {
        let next = i;
        for (let step = 0; step < filteredOptions.length; step++) {
          next = (next - 1 + filteredOptions.length) % filteredOptions.length;
          if (!filteredOptions[next].disabled) return next;
        }
        return i;
      });
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = filteredOptions[highlightIdx];
      if (opt && !opt.disabled) commit(opt.value);
    } else if (e.key === "Home") {
      e.preventDefault();
      setHighlightIdx(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setHighlightIdx(Math.max(0, filteredOptions.length - 1));
    } else if (e.key === "Tab") {
      close();
    }
  };

  const onTriggerKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(true);
    }
  };

  const panelClasses = [
    panelWidthClass ?? "",
    dropDir === "down" ? "origin-top" : "origin-bottom",
  ]
    .filter(Boolean)
    .join(" ");

  // Panel renderizado vía portal en <body> con position: fixed.
  // Esto evita que el dropdown sea recortado por contenedores con
  // `overflow-hidden`/`isolate` (p. ej. SurfaceCard) o se quede detrás
  // por culpa de stacking contexts en padres.
  const panel = (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={panelRef}
          role="listbox"
          id={`${id}-listbox`}
          tabIndex={-1}
          onKeyDown={onPanelKey}
          style={panelStyle}
          initial={{ opacity: 0, scale: 0.96, y: dropDir === "down" ? -4 : 4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: dropDir === "down" ? -4 : 4 }}
          transition={{ type: "spring", stiffness: 520, damping: 38, mass: 0.6 }}
          className={[
            panelClasses,
            "z-[1000]",
            "rounded-xl border border-slate-700/70 bg-slate-900/95 backdrop-blur",
            "shadow-2xl shadow-black/50 ring-1 ring-black/5 overflow-hidden",
          ].join(" ")}
        >
          {searchable && (
            <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800/70">
              <span className="text-slate-500"><SearchIcon /></span>
              <input
                ref={searchInputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder ?? "Buscar..."}
                className="flex-1 bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none tabular-nums"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    searchInputRef.current?.focus();
                  }}
                  className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
                  aria-label="Limpiar búsqueda"
                >
                  ×
                </button>
              )}
            </div>
          )}

          <div
            ref={listRef}
            className="max-h-72 overflow-y-auto py-1 co-select-scroll"
          >
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-slate-500">
                {emptyText ?? "Sin resultados"}
              </div>
            ) : (
              filteredOptions.map((opt, idx) => {
                const selected = opt.value === value;
                const highlighted = idx === highlightIdx;
                return (
                  <div
                    key={opt.value}
                    ref={(el) => {
                      optionRefs.current[idx] = el;
                    }}
                    role="option"
                    aria-selected={selected}
                    aria-disabled={opt.disabled}
                    onMouseEnter={() => setHighlightIdx(idx)}
                    onClick={() => !opt.disabled && commit(opt.value)}
                    className={[
                      "mx-1 my-0.5 rounded-md px-2.5 py-1.5 flex items-center gap-2 text-sm cursor-pointer select-none",
                      "transition-colors duration-100",
                      opt.disabled ? "opacity-40 cursor-not-allowed" : "",
                      highlighted && !selected ? "bg-slate-800/80 text-slate-100" : "",
                      selected
                        ? "bg-indigo-500/10 text-indigo-100 ring-1 ring-inset ring-indigo-500/25"
                        : "text-slate-300",
                    ].join(" ")}
                  >
                    {opt.dotClass ? (
                      <span
                        className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${opt.dotClass}`}
                      />
                    ) : null}
                    <span className="truncate flex-1 tabular-nums">{opt.label}</span>
                    {opt.hint !== undefined && opt.hint !== "" ? (
                      <span
                        className={[
                          "text-[10px] px-1.5 py-0.5 rounded tabular-nums shrink-0",
                          selected
                            ? "bg-indigo-500/20 text-indigo-200"
                            : "bg-slate-800 text-slate-500",
                        ].join(" ")}
                      >
                        {opt.hint}
                      </span>
                    ) : null}
                    <span
                      className={`text-indigo-300 shrink-0 transition-opacity ${
                        selected ? "opacity-100" : "opacity-0"
                      }`}
                      aria-hidden="true"
                    >
                      <Check />
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <div className={`relative ${className}`}>
      <button
        id={id}
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        aria-label={ariaLabel ?? label}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onTriggerKey}
        className={[
          "group flex items-center gap-2 rounded-lg pl-3 pr-2.5 py-2 text-sm w-full",
          "bg-slate-900/70 border border-slate-800 text-slate-100",
          "hover:border-indigo-500/40 hover:bg-slate-900",
          open
            ? "border-indigo-500/60 ring-1 ring-indigo-500/25 bg-slate-900"
            : "",
          "transition-colors duration-150",
          minWidthClass,
        ].join(" ")}
      >
        {label ? (
          <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold shrink-0">
            {label}
          </span>
        ) : null}

        <span className="flex items-center gap-2 min-w-0 flex-1">
          {selectedOption?.dotClass ? (
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${selectedOption.dotClass}`}
            />
          ) : null}
          <span className="truncate text-slate-100 font-medium tabular-nums">
            {selectedOption?.label ?? ""}
          </span>
          {selectedOption?.hint !== undefined && selectedOption.hint !== "" ? (
            <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 tabular-nums shrink-0">
              {selectedOption.hint}
            </span>
          ) : null}
        </span>

        <span className="text-slate-500 group-hover:text-slate-300 transition-colors shrink-0">
          <Chevron open={open} />
        </span>
      </button>

      {typeof document !== "undefined"
        ? createPortal(panel, document.body)
        : null}
    </div>
  );
}
