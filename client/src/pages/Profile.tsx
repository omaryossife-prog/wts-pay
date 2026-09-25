import { useEffect, useState } from "react";
import { api } from "../services/api";

export default function Profile() {
  const [user, setUser] = useState<any>(null);
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [pinNotice, setPinNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => api.wallet().then((r) => setUser(r.user)).catch(() => {});
  useEffect(() => { load(); }, []);
  if (!user) return <p style={{ padding: 40, textAlign: "center" }}>Loading…</p>;

  const submitPin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinError(""); setPinNotice(""); setBusy(true);
    try {
      await api.setPin({ password, pin });
      setPinNotice(user.pinSet ? "PIN updated." : "PIN created.");
      setPassword(""); setPin("");
      await load();
    } catch (err: any) {
      setPinError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1 className="page-title">Profile</h1>
      <div className="card">
        <div className="list-row"><span>Name</span><strong>{user.username}</strong></div>
        <div className="list-row"><span>Phone</span><strong>{user.phone}</strong></div>
        <div className="list-row"><span>Referral code</span><strong>{user.referralCode}</strong></div>
        <div className="list-row"><span>Account status</span>
          <span className={`badge ${user.status === "ACTIVE" ? "green" : "red"}`}>{user.status}</span>
        </div>
        <div className="list-row"><span>Member since</span><strong>{new Date(user.createdAt).toLocaleDateString()}</strong></div>
      </div>

      <div className="card">
        <h2>Transaction PIN</h2>
        <p className="muted">
          {user.pinSet
            ? "Your PIN is set. Use it to accept money requests."
            : "You don't have a PIN yet. Set one to accept money requests."}
        </p>
        {pinError && <div className="error">{pinError}</div>}
        {pinNotice && <div className="notice">{pinNotice}</div>}
        <form onSubmit={submitPin}>
          <div className="field">
            <label>Account password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <div className="field">
            <label>New 6-digit PIN</label>
            <input
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              placeholder="••••••"
              required
            />
          </div>
          <button className="btn" type="submit" disabled={busy || pin.length !== 6}>
            {user.pinSet ? "Update PIN" : "Create PIN"}
          </button>
        </form>
      </div>

      <div className="card">
        <h2>Security</h2>
        <p className="muted">
          Passwords are hashed with bcrypt. Sessions use signed JWTs. WhatsApp sessions
          expire automatically after 10 minutes of inactivity.
        </p>
      </div>
    </>
  );
}
