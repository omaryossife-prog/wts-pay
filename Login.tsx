import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await login(phone, password);
      nav("/wallet");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="shell" style={{ paddingTop: 40 }}>
      <div className="hero"><div className="logo">WTS <span>Pay</span></div><p>Sign in to your demo wallet</p></div>
      <div className="card">
        {error && <div className="error">{error}</div>}
        <form onSubmit={submit}>
          <div className="field">
            <label>WhatsApp number</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+2010xxxxxxx" required />
          </div>
          <div className="field">
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button className="btn" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        </form>
      </div>
      <p className="muted" style={{ textAlign: "center" }}>
        No account? <Link to="/register">Register</Link>
      </p>
    </div>
  );
}
