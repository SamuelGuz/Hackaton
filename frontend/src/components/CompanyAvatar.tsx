import { avatarStyle } from "../utils/format";

type Size = "sm" | "md" | "lg";

const dimBySize: Record<Size, string> = {
  sm: "w-7 h-7 text-[10px] rounded-md",
  md: "w-9 h-9 text-xs rounded-md",
  lg: "w-14 h-14 text-base rounded-lg",
};

export function CompanyAvatar({ name, size = "md" }: { name: string; size?: Size }) {
  const { initials, className } = avatarStyle(name);
  return (
    <div className={`${dimBySize[size]} ${className} ring-1 flex items-center justify-center font-bold tracking-wider shrink-0`}>
      {initials}
    </div>
  );
}
