import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { api } from "../services/api";

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

  // خطوات التحقق من الرقم: phone → code → verified
  const [step, setStep] = useState<"phone" | "code" | "verified">("phone");
  const [code, setCode] = useState("");
  const [phoneToken, setPhoneToken] = useState("");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const sendCode = async () => {
    setError("");
    setBusy(true);
    try {
      const r = await api.sendPhoneCode(form.phone.trim());
      setStep("code");
      setCode("");
      setCooldown(r.resendAfterSeconds);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async () => {
    setError("");
    setBusy(true);
    try {
      const r = await api.verifyPhoneCode(form.phone.trim(), code.trim());
      setPhoneToken(r.phoneToken);
      setStep("verified");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const changePhone = () => {
    setStep("phone");
    setPhoneToken("");
    setCode("");
    setError("");
  };

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step !== "verified") return; // Enter في خانة الرقم ميعديش التسجيل من غير تحقق
    setError("");
    setBusy(true);
    try {
      await register({ ...form, phone: form.phone.trim(), referralCode: form.referralCode || undefined, phoneToken });
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
            <label>رقم الموبايل (بالصيغة الدولية)</label>
            <input
              value={form.phone}
              onChange={set("phone")}
              placeholder="+2010xxxxxxxx"
              dir="ltr"
              disabled={step !== "phone"}
              required
            />
          </div>

          {step === "phone" && (
            <button type="button" className="btn" disabled={busy || form.phone.trim().length < 8} onClick={sendCode}>
              {busy ? "جاري الإرسال…" : "إرسال كود التحقق"}
            </button>
          )}

          {step === "code" && (
            <>
              <div className="field">
                <label>كود التحقق (6 أرقام وصلك SMS)</label>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="000000"
                  dir="ltr"
                />
              </div>
              <button type="button" className="btn" disabled={busy || code.length !== 6} onClick={verifyCode}>
                {busy ? "جاري التحقق…" : "تأكيد الكود"}
              </button>
              <p className="muted" style={{ textAlign: "center" }}>
                {cooldown > 0 ? (
                  <>تقدر تطلب كود جديد بعد {cooldown} ثانية</>
                ) : (
                  <a href="#" onClick={(e) => { e.preventDefault(); sendCode(); }}>إعادة إرسال الكود</a>
                )}
                {" · "}
                <a href="#" onClick={(e) => { e.preventDefault(); changePhone(); }}>تغيير الرقم</a>
              </p>
            </>
          )}

          {step === "verified" && (
            <>
              <p className="muted">✅ تم التحقق من رقمك. كمّل بياناتك.</p>
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
            </>
          )}
        </form>
      </div>
      <p className="muted" style={{ textAlign: "center" }}>
        Already registered? <Link to="/login">Sign in</Link>
      </p>
    </div>
  );
}
