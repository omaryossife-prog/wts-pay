import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { api } from "../services/api";

type Step = "phone" | "code" | "details";

export default function Register() {
  const { register } = useAuth();
  const [params] = useSearchParams();

  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [phoneToken, setPhoneToken] = useState("");
  const [form, setForm] = useState({
    username: "",
    password: "",
    referralCode: params.get("ref") ?? "",
  });

  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingReview, setPendingReview] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startCooldown = (seconds: number) => {
    setCooldown(seconds);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1 && timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        return Math.max(0, c - 1);
      });
    }, 1000);
  };

  // خطوة 1: إرسال كود التحقق برسالة SMS
  const sendCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError("");
    setInfo("");
    setBusy(true);
    try {
      const r = await api.requestOtp(phone);
      startCooldown(r.cooldownSeconds ?? 45);
      setStep("code");
      setInfo("اتبعتلك رسالة SMS فيها كود التحقق. الرسالة ممكن تاخد دقيقة.");
    } catch (err: any) {
      if (err.message?.includes("wait")) startCooldown(45);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // خطوة 2: تأكيد الكود
  const confirmCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const r = await api.verifyOtp(phone, code);
      setPhoneToken(r.phoneToken);
      setStep("details");
      setInfo("تم التحقق من رقمك بنجاح. كمّل بيانات الحساب.");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // خطوة 3: إنشاء الحساب
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await register({
        phone,
        username: form.username,
        password: form.password,
        referralCode: form.referralCode || undefined,
        phoneToken,
      });
      setPendingReview(true);
    } catch (err: any) {
      setError(err.message);
      // لو توكن التحقق خلص، ارجع لخطوة الرقم
      if (err.message?.toLowerCase().includes("verification")) {
        setStep("phone");
        setPhoneToken("");
        setCode("");
      }
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
            رقم هاتفك اتأكد ✅ وحسابك دلوقتي قيد مراجعة الأدمن. هتقدر تسجّل دخول بعد ما يتم قبول حسابك.
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
        {info && <p className="muted" style={{ marginBottom: 12 }}>{info}</p>}

        {step === "phone" && (
          <form onSubmit={sendCode}>
            <div className="field">
              <label>رقم الهاتف (بالصيغة الدولية)</label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+2010xxxxxxx"
                dir="ltr"
                required
              />
            </div>
            <button className="btn" disabled={busy}>
              {busy ? "جاري الإرسال…" : "إرسال كود التحقق SMS"}
            </button>
          </form>
        )}

        {step === "code" && (
          <form onSubmit={confirmCode}>
            <div className="field">
              <label>كود التحقق (6 أرقام) — أُرسل إلى <b dir="ltr">{phone}</b></label>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="123456"
                dir="ltr"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                minLength={6}
                maxLength={6}
              />
            </div>
            <button className="btn" disabled={busy || code.length !== 6}>
              {busy ? "جاري التحقق…" : "تأكيد الكود"}
            </button>
            <p className="muted" style={{ textAlign: "center", marginTop: 12 }}>
              {cooldown > 0 ? (
                <>إعادة الإرسال بعد {cooldown} ثانية</>
              ) : (
                <a href="#" onClick={(e) => { e.preventDefault(); sendCode(); }} style={{ color: "inherit" }}>
                  إعادة إرسال الكود
                </a>
              )}
              {" · "}
              <a href="#" onClick={(e) => { e.preventDefault(); setStep("phone"); setError(""); setInfo(""); }} style={{ color: "inherit" }}>
                تغيير الرقم
              </a>
            </p>
          </form>
        )}

        {step === "details" && (
          <form onSubmit={submit}>
            <div className="field">
              <label>رقم الهاتف (متحقق منه ✅)</label>
              <input value={phone} dir="ltr" disabled />
            </div>
            <div className="field">
              <label>Display name</label>
              <input
                value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                required
                minLength={2}
              />
            </div>
            <div className="field">
              <label>Password (min 8 characters)</label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                required
                minLength={8}
              />
            </div>
            <div className="field">
              <label>Referral code (optional)</label>
              <input
                value={form.referralCode}
                onChange={(e) => setForm((f) => ({ ...f, referralCode: e.target.value }))}
                placeholder="WTS-XXXXXX"
              />
            </div>
            <button className="btn" disabled={busy}>
              {busy ? "Creating…" : "Create account"}
            </button>
          </form>
        )}
      </div>
      <p className="muted" style={{ textAlign: "center" }}>
        Already registered? <Link to="/login">Sign in</Link>
      </p>
    </div>
  );
}
