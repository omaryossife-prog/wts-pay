export default function StatCard({ label, value, tone }: { label: string; value: string | number; tone?: "green" | "red" | "amber" }) {
  return (
    <div className="stat">
      <div className="num" style={tone === "green" ? { color: "var(--accent)" } : tone === "red" ? { color: "var(--danger)" } : undefined}>
        {value}
      </div>
      <div className="lbl">{label}</div>
    </div>
  );
}
