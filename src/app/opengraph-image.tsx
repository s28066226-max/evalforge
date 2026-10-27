import { ImageResponse } from "next/og";

export const alt = "EvalForge: RAG evaluation with statistical rigor";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Social preview card for links shared on LinkedIn, X, Slack and so on. */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "radial-gradient(70% 60% at 50% 0%, #2a1f5c 0%, #0b1120 70%)",
          color: "#e8edf6",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 34, fontWeight: 700 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: "linear-gradient(135deg, #8b6cff, #22c3e6)",
              display: "flex",
            }}
          />
          EvalForge
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 68, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2 }}>
            Which LLM can you trust with your documents?
          </div>
          <div style={{ fontSize: 30, color: "#a9b4c7" }}>
            Claim-level fact-checking · retrieval metrics · significance tests · live model arena
          </div>
        </div>
        <div style={{ display: "flex", gap: 14, fontSize: 24, color: "#cdd6e6" }}>
          {["RAG", "LLM-as-judge", "Wilcoxon + Holm", "Next.js"].map((t) => (
            <div key={t} style={{ display: "flex", padding: "8px 18px", borderRadius: 999, border: "1px solid #34425f" }}>
              {t}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
