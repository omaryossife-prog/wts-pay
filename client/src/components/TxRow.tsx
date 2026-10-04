import { useState } from "react";
import type { Transaction } from "../types";
import { api } from "../services/api";
import { useLang } from "../i18n/LanguageContext";
import { txType, txStatus } from "../i18n/enums";

const fmt = (n: number, egp: string) => `${n} ${egp}`;

export default function TxRow({ tx, viewerId }: { tx: Transaction; viewerId: string }) {
  const { t } = useLang();
  const outgoing = tx.senderId === viewerId;
  const sign = outgoing ? "−" : "+";
  const cls = outgoing ? "tx-out" : "tx-in";
  const other = outgoing ? tx.receiver?.phone ?? "—" : tx.sender?.phone ?? "—";

  const [reported, setReported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const canReport = outgoing && tx.escrowEnabled && tx.type === "TRANSFER" && tx.status === "COMPLETED";

  const report = async () => {
    setBusy(true); setError("");
    try { await api.reportTransaction(tx.id); setReported(true); }
    catch (err: any) { setError(err.message); }
    finally { setBusy(false); }
  };

  const typeLabel = txType(t, tx.type);
  const statusLabel = txStatus(t, tx.status);
  const statusCls = tx.status === "COMPLETED" ? "green" : tx.status === "REVERSED" ? "amber" : "gray";

  return (
    <div className="list-row" style={{ flexWrap: "wrap" }}>
      <div>
        <div style={{ fontWeight: 600 }}>
          {outgoing ? t.tx.sent : t.tx.received} · {typeLabel}
          {tx.escrowEnabled ? " · 🛡️" : ""}
        </div>
        <div className="meta">
          {other !== "—" ? `${t.tx.with} ${other}` : tx.description ?? ""} · {new Date(tx.createdAt).toLocaleString()}
          {tx.fee > 0 && outgoing ? ` · ${t.tx.fee} ${fmt(tx.fee, t.common.egp)}` : ""}
        </div>
        <div className="meta" style={{ opacity: 0.7 }}>{t.tx.ref}: {tx.reference}</div>
        {canReport && (
          reported ? (
            <div className="notice" style={{ marginTop: 6, padding: "4px 8px" }}>{t.tx.reported}</div>
          ) : (
            <button className="btn ghost small" onClick={report} disabled={busy} style={{ marginTop: 6 }}>
              {busy ? t.tx.reporting : t.tx.reportBtn}
            </button>
          )
        )}
        {error && <div className="error" style={{ marginTop: 4 }}>{error}</div>}
      </div>
      <div className={cls} style={{ textAlign: "right" }}>
        {sign}{fmt(outgoing ? tx.totalDebit : tx.amount, t.common.egp)}
        <div className="meta" style={{ fontWeight: 400 }}>
          <span className={`badge ${statusCls}`}>{statusLabel}</span>
        </div>
      </div>
    </div>
  );
}
