import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api";
import TxRow from "../components/TxRow";
import type { User, Transaction } from "../types";
import { useLang } from "../i18n/LanguageContext";

export default function Wallet() {
  const { t } = useLang();
  const [data, setData] = useState<{ user: User; notice: string } | null>(null);
  const [txs, setTxs] = useState<Transaction[]>([]);

  useEffect(() => {
    api.wallet().then(setData).catch(() => {});
    api.transactions(1).then((r) => setTxs(r.items.slice(0, 5))).catch(() => {});
  }, []);

  if (!data) return <p style={{ padding: 40, textAlign: "center" }}>{t.common.loading}</p>;
  const { user } = data;

  return (
    <>
      <h1 className="page-title">{t.wallet.title}</h1>
      <div className="card balance-card">
        <div className="label">{t.wallet.balanceLabel}</div>
        <div className="amount">{user.demoBalance ?? 0} <span style={{ fontSize: 20 }}>{t.common.egp}</span></div>
        <div className="demo-note">{t.wallet.noValue}</div>
      </div>

      <Link to="/send" className="btn" style={{ marginBottom: 12 }}>{t.wallet.sendBtn}</Link>
      <Link to="/transactions" className="btn secondary" style={{ marginBottom: 12 }}>{t.wallet.txBtn}</Link>

      <div className="card">
        <h2>{t.wallet.recentActivity}</h2>
        {txs.length === 0
          ? <p className="muted">{t.wallet.noTx}</p>
          : txs.map((tx) => <TxRow key={tx.id} tx={tx} viewerId={user.id} />)}
      </div>
    </>
  );
}
