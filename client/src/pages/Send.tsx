import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../services/api";

export default function Send() {
  const nav = useNavigate();
  const [recipientPhone, setRecipientPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<{ amount: number; fee: number; totalDebit: number } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");

  const getQuote = async () => {
    setError("");
    setQuote(null);
    const n = Number(amount);
    if (!Number.isInteger(n) || n <= 0) return setError("Enter a whole amount greater than 0.");
    try {
      setQuote(await api.quote(n));
    } catch (err: any) {
      setError(err.message);
    }
  };

  const confirm = async () => {
    setError("");
    setBusy(true);
    try {
      const r = await api.transfer({ recipientPhone, amount: Number(amount) });
      setDone(`Sent ${r.transaction.amount} EGP (fee ${r.transaction.fee} EGP).`);
      setTimeout(() => nav("/transactions"), 900);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1 className="page-title">Send Money</h1>
      <div className="card">
        {done && <div className="notice">{done}</div>}
        {error && <div className="error">{error}</div>}
        <div className="field">
          <label>Recipient phone number</label>
          <input value={recipientPhone} onChange={(e) => setRecipientPhone(e.target.value)} placeholder="+2010xxxxxxx" />
        </div>
        <div className="field">
          <label>Amount (EGP)</label>
          <input inputMode="numeric" value={amount} onChange={(e) => { setAmount(e.target.value); setQuote(null); }} placeholder="500" />
        </div>
        <button className="btn secondary" onClick={getQuote}>Calculate fee</button>

        {quote && (
          <div style={{ marginTop: 16 }}>
            <div className="list-row"><span>Amount</span><strong>{quote.amount} EGP</strong></div>
            <div className="list-row"><span>Fee</span><strong>{quote.fee} EGP</strong></div>
            <div className="list-row"><span>Total debit</span><strong>{quote.totalDebit} EGP</strong></div>
            <p className="muted" style={{ margin: "10px 0" }}>
              Fee = 1 EGP per started 1,000 EGP. Demo credits only — no cash value.
            </p>
            <button className="btn" onClick={confirm} disabled={busy}>
              {busy ? "Sending…" : `Confirm — send ${quote.amount} EGP`}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
