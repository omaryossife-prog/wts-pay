import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useLang } from "../i18n/LanguageContext";

export default function Login() {
  const { login } = useAuth();
  const { t, lang } = useLang();
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
      <div className="hero"><div className="logo">WTS <span>Pay</span></div><p>{t.login.subtitle}</p></div>
      <div className="card">
        {error && <div className="error">{error}</div>}
        <form onSubmit={submit}>
          <div className="field">
            <label>{t.login.phone}</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+2010xxxxxxx" dir="ltr" required />
          </div>
          <div className="field">
            <label>{t.login.password}</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button className="btn" disabled={busy}>{busy ? t.login.submitting : t.login.submit}</button>
        </form>
        <p className="muted" style={{ textAlign: "center", marginTop: 10 }}>
          <Link to="/forgot-password">{lang === "ar" ? "نسيت كلمة السر؟" : "Forgot password?"}</Link>
        </p>
      </div>
      <p className="muted" style={{ textAlign: "center" }}>
        {t.login.noAccount} <Link to="/register">{t.login.registerLink}</Link>
      </p>
    </div>
  );
}
