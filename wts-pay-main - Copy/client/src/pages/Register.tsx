import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

export default function Register() {
  const { register } = useAuth();
  const [params] = useSearchParams();
  const [form, setForm] = useState({
    phone: "",
    username: "",
    password: "",
    referralCode: params.get("ref") ?? "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingReview, setPendingReview] = useState(false);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await register({ ...form, referralCode: form.referralCode || undefined });
      setPendingReview(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (pendingReview) {
    return (
      <div className="shell" style={{ paddingTop: 40 }}>
        <div className="hero"><div className="logo">WTS <span>Pay</span></div></div>
        <div className="card">
          <h2>تم استلام طلب التسجيل</h2>
          <p className="muted">
            حسابك دلوقتي قيد مراجعة الأدمن. هتقدر تسجّل دخول بعد ما يتم قبول حسابك.
          </p>
          <Link to="/login" className="btn" style={{ display: "inline-block", textAlign: "center", marginTop: 16 }}>
            رجوع لتسجيل الدخول
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="shell" style={{ paddingTop: 40 }}>
      <div className="hero"><div className="logo">WTS <span>Pay</span></div><p>Create your demo wallet</p></div>
      <div className="card">
        <div className="demo-banner">
          Demo wallet only. You will receive <strong>+50 demo credits</strong> signup reward.
          Demo credits have no cash value.
        </div>
        {error && <div className="error">{error}</div>}
        <form onSubmit={submit}>
          <div className="field">
            <label>WhatsApp number</label>
            <input value={form.phone} onChange={set("phone")} placeholder="+2010xxxxxxx" required />
          </div>
          <div className="field">
            <label>Display name</label>
            <input value={form.username} onChange={set("username")} required minLength={2} />
          </div>
          <div className="field">
            <label>Password (min 8 characters)</label>
            <input type="password" value={form.password} onChange={set("password")} required minLength={8} />
          </div>
          <div className="field">
            <label>Referral code (optional)</label>
            <input value={form.referralCode} onChange={set("referralCode")} placeholder="WTS-XXXXXX" />
          </div>
          <button className="btn" disabled={busy}>{busy ? "Creating…" : "Create account"}</button>
        </form>
      </div>
      <p className="muted" style={{ textAlign: "center" }}>
        Already registered? <Link to="/login">Sign in</Link>
      </p>
    </div>
  );
}
