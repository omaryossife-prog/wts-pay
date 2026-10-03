import { useEffect, useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { api } from "../services/api";
import type { TransferRequest } from "../types";
import { useLang } from "../i18n/LanguageContext";

export default function Requests() {
  const { t } = useLang();
  const { user, refreshUser } = useAuth();
  const [tab, setTab] = useState<"incoming" | "outgoing" | "new">("incoming");
  const [incoming, setIncoming] = useState<TransferRequest[]>([]);
  const [outgoing, setOutgoing] = useState<TransferRequest[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [payerPhone, setPayerPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");

  const load = async () => {
    setError("");
    try {
      const [inc, out] = await Promise.all([api.incomingRequests(), api.outgoingRequests()]);
      setIncoming(inc.items); setOutgoing(out.items);
    } catch (err: any) { setError(err.message); }
  };
  useEffect(() => { load(); }, []);

  const submitNewRequest = async (e: React.FormEvent) => {
    e.preventDefault(); setError(""); setNotice(""); setBusy(true);
    try {
      await api.createRequest({ payerPhone, amount: Number(amount), description: description || undefined });
      setNotice(t.requests.requestSent);
      setPayerPhone(""); setAmount(""); setDescription("");
      setTab("outgoing"); await load();
    } catch (err: any) { setError(err.message); }
    finally { setBusy(false); }
  };

  const reject = async (id: string) => {
    setError(""); setBusy(true);
    try { await api.rejectRequest(id); await load(); }
    catch (err: any) { setError(err.message); }
    finally { setBusy(false); }
  };

  const cancel = async (id: string) => {
    setError(""); setBusy(true);
    try { await api.cancelRequest(id); await load(); }
    catch (err: any) { setError(err.message); }
    finally { setBusy(false); }
  };

  const confirmAccept = async (id: string) => {
    setError(""); setBusy(true);
    try {
      await api.acceptRequest(id, pin);
      setNotice(t.requests.accepted);
      setAcceptingId(null); setPin("");
      await load(); await refreshUser?.();
    } catch (err: any) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <>
      <h1 className="page-title">{t.requests.title}</h1>

      {user?.pinSet === false && (
        <div className="notice" style={{ marginBottom: 16 }}>
          {t.requests.noPinNotice} <a href="/profile">{t.requests.profileLink}</a>.
        </div>
      )}

      <div className="tabs" style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button className={`btn small ${tab === "incoming" ? "" : "ghost"}`} onClick={() => setTab("incoming")}>
          {t.requests.incomingTab} ({incoming.length})
        </button>
        <button className={`btn small ${tab === "outgoing" ? "" : "ghost"}`} onClick={() => setTab("outgoing")}>
          {t.requests.sentTab}
        </button>
        <button className={`btn small ${tab === "new" ? "" : "ghost"}`} onClick={() => setTab("new")}>
          {t.requests.newTab}
        </button>
      </div>

      {error && <div className="error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}

      {tab === "incoming" && (
        <div className="card">
          {incoming.length === 0 && <p className="muted">{t.requests.noPending}</p>}
          {incoming.map((r) => (
            <div key={r.id} className="list-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>{r.requester?.username ?? "—"} {t.requests.requests}</span>
                <strong>{r.amount} {t.common.egp}</strong>
              </div>
              {r.description && <small className="muted">{r.description}</small>}
              {acceptingId === r.id ? (
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input inputMode="numeric" maxLength={6} placeholder={t.requests.pinPlaceholder}
                    value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} style={{ width: 140 }} dir="ltr" />
                  <button className="btn" disabled={busy || pin.length !== 6} onClick={() => confirmAccept(r.id)}>{t.requests.confirmBtn}</button>
                  <button className="btn ghost small" onClick={() => { setAcceptingId(null); setPin(""); }}>{t.requests.cancelBtn}</button>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn small" onClick={() => setAcceptingId(r.id)} disabled={busy}>{t.requests.acceptBtn}</button>
                  <button className="btn ghost small" onClick={() => reject(r.id)} disabled={busy}>{t.requests.rejectBtn}</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "outgoing" && (
        <div className="card">
          {outgoing.length === 0 && <p className="muted">{t.requests.noSent}</p>}
          {outgoing.map((r) => (
            <div key={r.id} className="list-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>{t.requests.from} {r.payer?.phone ?? "—"}</span>
                <strong>{r.amount} {t.common.egp}</strong>
              </div>
              <small className="muted">{r.status}</small>
              {r.status === "PENDING" && (
                <button className="btn ghost small" onClick={() => cancel(r.id)} disabled={busy} style={{ alignSelf: "flex-start" }}>
                  {t.requests.cancelRequestBtn}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "new" && (
        <form className="card" onSubmit={submitNewRequest}>
          <div className="field">
            <label>{t.requests.payerLabel}</label>
            <input value={payerPhone} onChange={(e) => setPayerPhone(e.target.value)} placeholder="+2010xxxxxxx" dir="ltr" required />
          </div>
          <div className="field">
            <label>{t.requests.amountLabel}</label>
            <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="500" dir="ltr" required />
          </div>
          <div className="field">
            <label>{t.requests.reasonLabel}</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t.requests.reasonPlaceholder} />
          </div>
          <button className="btn" type="submit" disabled={busy}>{t.requests.sendBtn}</button>
        </form>
      )}
    </>
  );
}
