import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../services/api";
import { useLang } from "../i18n/LanguageContext";

type Step = "identity" | "code" | "password" | "done";

export default function ForgotPassword() {
  const { lang } = useLang();
  const nav = useNavigate();

  const [step, setStep] = useState<Step>("identity");
  const [phone, setPhone] = useState("");
  const [last6, setLast6] = useState("");
  const [code, setCode] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const tick = (seconds: number) => {
    setCooldown(seconds);
    const id = setInterval(() => {
      setCooldown((s) => {
        if (s <= 1) { clearInterval(id); return 0; }
        return s - 1;
      });
    }, 1000);
  };

  const sendCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(""); setBusy(true);
    try {
      const r = await api.sendResetCode(phone.trim(), last6.trim());
      tick(r.resendAfterSeconds ?? 45);
      setStep("code");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      const r = await api.verifyResetCode(phone.trim(), code.trim());
      setResetToken(r.resetToken);
      setStep("password");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const submitNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      await api.completeReset(phone.trim(), resetToken, newPassword);
      setStep("done");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="shell" style={{ paddingTop: 40 }}>
      <div className="hero">
        <div className="logo">WTS <span>Pay</span></div>
        <p>{lang === "ar" ? "استعادة كلمة السر" : "Reset your password"}</p>
      </div>
      <div className="card">
        {error && <div className="error">{error}</div>}

        {step === "identity" && (
          <form onSubmit={sendCode}>
            <p className="muted">
              {lang === "ar"
                ? "اكتب رقم الواتساب اللي سجّلت بيه، وآخر 6 أرقام من الرقم القومي اللي في بطاقتك."
                : "Enter the WhatsApp number you registered with, and the last 6 digits of your national ID."}
            </p>
            <div className="field">
              <label>{lang === "ar" ? "رقم الواتساب" : "WhatsApp number"}</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+2010xxxxxxx" dir="ltr" required />
            </div>
            <div className="field">
              <label>{lang === "ar" ? "آخر 6 أرقام من الرقم القومي" : "Last 6 digits of national ID"}</label>
              <input
                value={last6}
                onChange={(e) => setLast6(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                maxLength={6}
                dir="ltr"
                required
              />
            </div>
            <button className="btn" disabled={busy || last6.length !== 6}>
              {busy ? (lang === "ar" ? "جاري الإرسال…" : "Sending…") : (lang === "ar" ? "ابعت كود التحقق" : "Send verification code")}
            </button>
          </form>
        )}

        {step === "code" && (
          <form onSubmit={verifyCode}>
            <p className="muted">
              {lang === "ar" ? `بعتنا كود من 6 أرقام لرقم ${phone}.` : `We sent a 6-digit code to ${phone}.`}
            </p>
            <div className="field">
              <label>{lang === "ar" ? "الكود" : "Code"}</label>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                maxLength={6}
                dir="ltr"
                required
              />
            </div>
            <button className="btn" disabled={busy || code.length !== 6}>
              {busy ? (lang === "ar" ? "جاري التحقق…" : "Verifying…") : (lang === "ar" ? "تأكيد" : "Verify")}
            </button>
            <button
              type="button"
              className="btn ghost"
              style={{ marginTop: 10 }}
              disabled={cooldown > 0 || busy}
              onClick={() => sendCode()}
            >
              {cooldown > 0
                ? (lang === "ar" ? `أعد الإرسال بعد ${cooldown} ثانية` : `Resend in ${cooldown}s`)
                : (lang === "ar" ? "إعادة إرسال الكود" : "Resend code")}
            </button>
          </form>
        )}

        {step === "password" && (
          <form onSubmit={submitNewPassword}>
            <div className="field">
              <label>{lang === "ar" ? "كلمة السر الجديدة" : "New password"}</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={8}
                required
              />
            </div>
            <button className="btn" disabled={busy || newPassword.length < 8}>
              {busy ? (lang === "ar" ? "جاري الحفظ…" : "Saving…") : (lang === "ar" ? "حفظ كلمة السر" : "Save password")}
            </button>
          </form>
        )}

        {step === "done" && (
          <div>
            <p>{lang === "ar" ? "✅ اتغيّرت كلمة السر بنجاح." : "✅ Your password has been changed."}</p>
            <button className="btn" onClick={() => nav("/login")}>
              {lang === "ar" ? "تسجيل الدخول" : "Sign in"}
            </button>
          </div>
        )}
      </div>
      {step !== "done" && (
        <p className="muted" style={{ textAlign: "center" }}>
          <Link to="/login">{lang === "ar" ? "رجوع لتسجيل الدخول" : "Back to sign in"}</Link>
        </p>
      )}
    </div>
  );
}
