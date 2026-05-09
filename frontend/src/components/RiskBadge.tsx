import type { HealthStatus } from "../types";

const config: Record<HealthStatus, { label: string; className: string }> = {
  critical:  { label: "Crítico",    className: "bg-red-900/60 text-red-300 border border-red-700" },
  at_risk:   { label: "En riesgo",  className: "bg-orange-900/60 text-orange-300 border border-orange-700" },
  stable:    { label: "Estable",    className: "bg-yellow-900/60 text-yellow-300 border border-yellow-700" },
  healthy:   { label: "Saludable",  className: "bg-green-900/60 text-green-300 border border-green-700" },
  expanding: { label: "Expansión",  className: "bg-blue-900/60 text-blue-300 border border-blue-700" },
};

export function RiskBadge({ status }: { status: HealthStatus }) {
  const { label, className } = config[status];
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${className}`}>
      {label}
    </span>
  );
}
