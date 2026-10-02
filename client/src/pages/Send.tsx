import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../services/api";
import { useLang } from "../i18n/LanguageContext";

export default function Send() {
  const { t } = useLang();
  const nav = useNavigate();
  const [recipientPhone, setRecipientPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [escrowEnabled, setEscrowEnabled] = useState(false);
  const [quote, setQuote] = useState<{ amount: number; fee: number; totalDebit: number; warning: string | null } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");

  const getQuote = async () => {
    setError(""); setQuote(null);
    const n = Number(amount);
    if (!Number.isInteger(n) || n <= 0) return setError(t.send.amountError);
    try { setQuote(await api.quote(n, recipientPhone || undefined)); }
    catch (err: any) { setError(err.message); }
  };

  const confirm = async () => {
    setError(""); setBusy(true);
    try {
      const r = await api.transfer({ recipientPhone, amount: Number(amount), escrowEnabled });
      setDone(`${t.send.doneMsg} ${r.transaction.amount} ${t.common.egp} (${t.send.feeRow} ${r.transaction.fee} ${t.common.egp}).`);
      setTimeout(() => nav("/transactions"), 900);
    } catch (err: any) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <>
      <h1 className="page-title">{t.send.title}</h1>
      <div className="card">
        {done && <div className="notice">{done}</div>}
        {error && <div className="error">{error}</div>}
        <div className="field">
          <label>{t.send.recipientLabel}</label>
          <input value={recipientPhone} onChange={(e) => { setRecipientPhone(e.target.value); setQuote(null); }} placeholder="+2010xxxxxxx" dir="ltr" />
        </div>
        <div className="field">
          <label>{t.send.amountLabel}</label>
          <input inputMode="numeric" value={amount} onChange={(e) => { setAmount(e.target.value); setQuote(null); }} placeholder="500" dir="ltr" />
        </div>

        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, margin: "12px 0", cursor: "pointer" }}>
          <input type="checkbox" checked={escrowEnabled} onChange={(e) => setEscrowEnabled(e.target.checked)} style={{ marginTop: 3 }} />
          <span>
            <strong>{t.send.antiFraudLabel}</strong>
            <br />
            <small className="muted">{t.send.antiFraudDesc}</small>
          </span>
        </label>

        <button className="btn secondary" onClick={getQuote}>{t.send.calcFeeBtn}</button>

        {quote && (
          <div style={{ marginTop: 16 }}>
            {quote.warning && <div className="error">{quote.warning}</div>}
            <div className="list-row"><span>{t.send.amountRow}</span><strong>{quote.amount} {t.common.egp}</strong></div>
            <div className="list-row"><span>{t.send.feeRow}</span><strong>{quote.fee} {t.common.egp}</strong></div>
            <div className="list-row"><span>{t.send.totalRow}</span><strong>{quote.totalDebit} {t.common.egp}</strong></div>
            <p className="muted" style={{ margin: "10px 0" }}>{t.send.feeNote}</p>
            <button className="btn" onClick={confirm} disabled={busy}>
              {busy ? t.send.sendingBtn : `${t.send.confirmBtn} ${quote.amount} ${t.common.egp}`}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
