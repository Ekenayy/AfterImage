import { EvidenceItem } from "@/types";

interface EvidenceCardProps {
  item: EvidenceItem;
  variant: "for" | "against";
  onClick?: () => void;
}

export default function EvidenceCard({
  item,
  variant,
  onClick,
}: EvidenceCardProps) {
  const borderColor =
    variant === "for" ? "border-emerald-400" : "border-red-400";
  const bgColor =
    variant === "for" ? "bg-emerald-50" : "bg-red-50";
  const badge =
    variant === "for" ? "Supporting" : "Contradicting";
  const badgeColor =
    variant === "for"
      ? "bg-emerald-100 text-emerald-700"
      : "bg-red-100 text-red-700";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-lg border-l-4 ${borderColor} ${bgColor} p-3 text-left transition-shadow hover:shadow-md`}
    >
      <div className="mb-1 flex items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${badgeColor}`}>
          {badge}
        </span>
        <span className="text-xs text-gray-500">Page {item.page}</span>
      </div>
      <p className="text-sm leading-relaxed text-gray-800">
        &ldquo;{item.quote}&rdquo;
      </p>
      {item.note && (
        <p className="mt-1 text-xs text-gray-500">{item.note}</p>
      )}
    </button>
  );
}
