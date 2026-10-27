import type { RunRow } from "@/lib/types.ts";

export function StatusBadge({ status }: { status: RunRow["status"] }) {
  const tone = status === "done" ? "better" : status === "failed" ? "worse" : "same running";
  return (
    <span className={`badge ${tone}`}>
      <span className="dot" />
      {status === "failed" ? "partial" : status}
    </span>
  );
}
