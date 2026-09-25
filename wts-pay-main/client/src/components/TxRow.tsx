import type { Transaction } from "../types";

const fmt = (n: number) => `${n} EGP`;

export default function TxRow({ tx, viewerId }: { tx: Transaction; viewerId: string }) {
  const outgoing = tx.senderId === viewerId;
  const sign = outgoing ? "−" : "+";
  const cls = outgoing ? "tx-out" : "tx-in";
  const other = outgoing ? tx.receiver?.phone ?? "—" : tx.sender?.phone ?? "—";
  return (
    <div className="list-row">
      <div>
        <div style={{ fontWeight: 600 }}>
          {outgoing ? "Sent" : "Received"} · {tx.type.replace(/_/g, " ").toLowerCase()}
        </div>
        <div className="meta">
          {other !== "—" ? `with ${other}` : tx.description ?? ""} · {new Date(tx.createdAt).toLocaleString()}
          {tx.fee > 0 && outgoing ? ` · fee ${fmt(tx.fee)}` : ""}
        </div>
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
