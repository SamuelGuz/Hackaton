import type { ReactNode } from "react";

type Props = {
  open: boolean;
  children: ReactNode;
  /** Clases extra en el contenedor grid (p. ej. fondo). */
  className?: string;
};

/**
 * Altura animada dentro de una celda de tabla usando grid 0fr → 1fr.
 * Evita animar height:auto y da un cierre tan suave como la apertura.
 */
export function ExpandRowAccordion({ open, children, className = "" }: Props) {
  return (
    <div
      className={[
        "grid overflow-hidden transition-[grid-template-rows] duration-[260ms] ease-[cubic-bezier(0.33,1,0.68,1)] motion-reduce:transition-none motion-reduce:duration-0",
        open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        className,
      ].join(" ")}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}
