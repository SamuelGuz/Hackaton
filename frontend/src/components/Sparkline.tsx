/**
 * Mini serie temporal para KPIs. Pasar `series` cuando el API exponga histórico;
 * sin datos no renderiza (evita gráficos vacíos engañosos).
 */
export function Sparkline({
  series,
  className = "",
  stroke = "rgba(148, 163, 184, 0.55)",
}: {
  series?: number[];
  className?: string;
  stroke?: string;
}) {
  if (!series || series.length < 2) return null;

  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const w = 56;
  const h = 20;
  const pad = 1;
  const pts = series.map((v, i) => {
    const x = pad + (i / (series.length - 1)) * (w - pad * 2);
    const y = pad + (1 - (v - min) / span) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <svg
      className={className}
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden
    >
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={pts.join(" ")}
      />
    </svg>
  );
}
