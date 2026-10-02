import { useEffect, useState } from "react";
import { api } from "../services/api";
import TxRow from "../components/TxRow";
import type { User, Transaction } from "../types";
import { useLang } from "../i18n/LanguageContext";

export default function Transactions() {
  const { t } = useLang();
  const [user, setUser] = useState<User | null>(null);
  const [items, setItems] = useState<Transaction[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const load = (p: number) => {
    api.wallet().then((r) => setUser(r.user)).catch(() => {});
    api.transactions(p).then((r) => { setItems(r.items); setTotal(r.total); }).catch(() => {});
  };
  useEffect(() => { load(page); }, [page]);

  const pages = Math.max(1, Math.ceil(total / 20));
  return (
    <>
      <h1 className="page-title">{t.transactions.title}</h1>
      <div className="card">
        {items.length === 0
          ? <p className="muted">{t.transactions.noTx}</p>
          : items.map((tx) => user && <TxRow key={tx.id} tx={tx} viewerId={user.id} />)}
      </div>
      {pages > 1 && (
        <div className="row" style={{ justifyContent: "center" }}>
          <button className="btn ghost small" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t.transactions.prev}</button>
          <span className="muted">{t.transactions.pageOf} {page} / {pages}</span>
          <button className="btn ghost small" disabled={page >= pages} onClick={() => setPage(page + 1)}>{t.transactions.next}</button>
        </div>
      )}
    </>
  );
}
