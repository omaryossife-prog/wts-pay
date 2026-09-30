import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api";
import TxRow from "../components/TxRow";
import type { User, Transaction } from "../types";

export default function Wallet() {
  const [data, setData] = useState<{ user: User; notice: string } | null>(null);
  const [txs, setTxs] = useState<Transaction[]>([]);

  useEffect(() => {
    api.wallet().then(setData).catch(() => {});
    api.transactions(1).then((r) => setTxs(r.items.slice(0, 5))).catch(() => {});
  }, []);

  if (!data) return <p style={{ padding: 40, textAlign: "center" }}>Loading…</p>;
  const { user } = data;

  return (
    <>
      <h1 className="page-title">Wallet</h1>
      <div className="card balance-card">
        <div className="label">Demo Balance — No Cash Value</div>
        <div className="amount">{user.demoBalance ?? 0} <span style={{ fontSize: 20 }}>EGP</span></div>
        <div className="demo-note">
          Demo credits have no cash value and cannot be withdrawn or exchanged for real money.
        </div>
      </div>

      <Link to="/send" className="btn" style={{ marginBottom: 12 }}>💸 Send money</Link>
      <Link to="/transactions" className="btn secondary" style={{ marginBottom: 12 }}>📜 View all transactions</Link>

      <div className="card">
        <h2>Recent activity</h2>
        {txs.length === 0 ? (
          <p className="muted">No transactions yet. Send money to get started.</p>
        ) : (
          txs.map((t) => <TxRow key={t.id} tx={t} viewerId={user.id} />)
        )}
      </div>
    </>
  );
}
