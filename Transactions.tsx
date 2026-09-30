import { useEffect, useState } from "react";
import { api } from "../services/api";
import TxRow from "../components/TxRow";
import type { User, Transaction } from "../types";

export default function Transactions() {
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
      <h1 className="page-title">Transactions</h1>
      <div className="card">
        {items.length === 0 ? <p className="muted">No transactions yet.</p> :
          items.map((t) => user && <TxRow key={t.id} tx={t} viewerId={user.id} />)}
      </div>
      {pages > 1 && (
        <div className="row" style={{ justifyContent: "center" }}>
          <button className="btn ghost small" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</button>
          <span className="muted">Page {page} of {pages}</span>
          <button className="btn ghost small" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next →</button>
        </div>
      )}
    </>
  );
}
