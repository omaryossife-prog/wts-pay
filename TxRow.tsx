import { useState } from "react";
import type { Transaction } from "../types";
import { api } from "../services/api";

const fmt = (n: number) => `${n} EGP`;

export default function TxRow({ tx, viewerId }: { tx: Transaction; viewerId: string }) {
  const outgoing = tx.senderId === viewerId;
  const sign = outgoing ? "−" : "+";
  const cls = outgoing ? "tx-out" : "tx-in";
  const other = outgoing ? tx.receiver?.phone ?? "—" : tx.sender?.phone ?? "—";

  const [reported, setReported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const canReport = outgoing && tx.escrowEnabled && tx.type === "TRANSFER" && tx.status === "COMPLETED";

  const report = async () => {
    setBusy(true);
    setError("");
    try {
      await api.reportTransaction(tx.id);
      setReported(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="list-row" style={{ flexWrap: "wrap" }}>
      <div>
        <div style={{ fontWeight: 600 }}>
          {outgoing ? "Sent" : "Received"} · {tx.type.replace(/_/g, " ").toLowerCase()}
          {tx.escrowEnabled ? " · 🛡️" : ""}
        </div>
        <div className="meta">
          {other !== "—" ? `with ${other}` : tx.description ?? ""} · {new Date(tx.createdAt).toLocaleString()}
          {tx.fee > 0 && outgoing ? ` · fee ${fmt(tx.fee)}` : ""}
        </div>
        <div className="meta" style={{ opacity: 0.7 }}>Ref: {tx.reference}</div>
        {canReport && (
          reported ? (
            <div className="notice" style={{ marginTop: 6, padding: "4px 8px" }}>Report submitted — our team will review it.</div>
          ) : (
            <button className="btn ghost small" onClick={report} disabled={busy} style={{ marginTop: 6 }}>
              {busy ? "Reporting…" : "🚩 Report this transfer"}
            </button>
          )
        )}
        {error && <div className="error" style={{ marginTop: 4 }}>{error}</div>}
      </div>
      <div className={cls} style={{ textAlign: "right" }}>
        {sign}{fmt(outgoing ? tx.totalDebit : tx.amount)}
        <div className="meta" style={{ fontWeight: 400 }}>
          <span className={`badge ${tx.status === "COMPLETED" ? "green" : tx.status === "REVERSED" ? "amber" : "gray"}`}>{tx.status}</span>
        </div>
      </div>
    </div>
  );
}
