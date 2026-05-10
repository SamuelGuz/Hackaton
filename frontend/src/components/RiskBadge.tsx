import { useI18n } from "../context/I18nContext";
import type { HealthStatus } from "../types";

const style: Record<HealthStatus, string> = {
  critical:  "bg-red-900/60 text-red-300 border border-red-700",
  at_risk:   "bg-orange-900/60 text-orange-300 border border-orange-700",
  stable:    "bg-yellow-900/60 text-yellow-300 border border-yellow-700",
  healthy:   "bg-green-900/60 text-green-300 border border-green-700",
  expanding: "bg-blue-900/60 text-blue-300 border border-blue-700",
};

export function RiskBadge({ status }: { status: HealthStatus }) {
  const { t } = useI18n();
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${style[status]}`}>
      {t(`status.${status}` as any)}
    </span>
  );
}
