import { motion } from "framer-motion";
import type { ComponentProps, ReactNode } from "react";

export type SurfaceTone =
  | "neutral"
  | "indigo"
  | "rose"
  | "sky"
  | "amber"
  | "emerald"
  | "violet";

const toneBorder: Record<SurfaceTone, string> = {
  neutral: "border-slate-800/90",
  indigo: "border-indigo-500/22",
  rose: "border-rose-500/22",
  sky: "border-sky-500/22",
  amber: "border-amber-500/20",
  emerald: "border-emerald-500/22",
  violet: "border-violet-500/22",
};

/** elevated = tarjetas KPI; data = paneles con tabla / rejilla densa */
export type SurfaceKind = "elevated" | "data";

export type SurfaceCardProps = Omit<
  ComponentProps<typeof motion.div>,
  "children" | "initial" | "whileInView" | "viewport" | "transition" | "whileHover"
> & {
  children: ReactNode;
  tone?: SurfaceTone;
  weight?: "tile" | "panel";
  motionIndex?: number;
  hoverLift?: boolean;
  motionless?: boolean;
  surface?: SurfaceKind;
};

export function SurfaceCard({
  children,
  className = "",
  tone = "neutral",
  weight = "tile",
  motionIndex = 0,
  hoverLift = true,
  motionless = false,
  surface = "elevated",
  ...rest
}: SurfaceCardProps) {
  const rounded = weight === "panel" ? "rounded-2xl" : "rounded-xl";
  const ring = toneBorder[tone];
  const doLift = hoverLift && weight === "tile";
  const isData = surface === "data";

  const motionEnter = motionless
    ? {}
    : {
        initial: { opacity: 0, y: 22 },
        whileInView: { opacity: 1, y: 0 },
        viewport: { once: true, margin: "-12px 0px -8px 0px" } as const,
        transition: {
          duration: 0.46,
          delay: motionIndex * 0.06,
          ease: [0.22, 1, 0.36, 1] as const,
        },
      };

  const elevatedClasses = [
    "group relative isolate overflow-hidden",
    rounded,
    "border backdrop-blur-[2px]",
    ring,
    "co-surface-tile-bg",
    "shadow-[inset_0_1px_0_rgba(255,255,255,0.045),0_16px_48px_-18px_rgba(0,0,0,0.72)]",
    doLift
      ? "transition-shadow duration-300 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_24px_56px_-12px_rgba(0,0,0,0.78)]"
      : "",
  ];

  const dataClasses = [
    "surface-card-data group relative isolate overflow-hidden",
    rounded,
    "border border-slate-800/50",
    "co-surface-data-bg",
    "shadow-[0_20px_48px_-36px_rgba(0,0,0,0.75)]",
  ];

  return (
    <motion.div
      {...motionEnter}
      whileHover={
        doLift && !isData
          ? { y: -4, transition: { type: "spring", stiffness: 420, damping: 28 } }
          : undefined
      }
      className={[...(isData ? dataClasses : elevatedClasses), className].join(" ")}
      {...rest}
    >
      {!isData ? <div className="co-card-gloss" aria-hidden /> : null}
      <div
        className={[
          "pointer-events-none absolute inset-0 sc-card-noise",
          isData ? "opacity-[0.03]" : "",
        ].filter(Boolean).join(" ")}
        aria-hidden
      />
      <div className="relative z-[1]">{children}</div>
    </motion.div>
  );
}
