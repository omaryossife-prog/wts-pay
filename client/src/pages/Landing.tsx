import { Link } from "react-router-dom";
import { useLang } from "../i18n/LanguageContext";

export default function Landing() {
  const { t } = useLang();
  return (
    <div className="shell" style={{ paddingBottom: 40 }}>
      <div className="hero">
        <div className="logo">WTS <span>Pay</span></div>
        <p>{t.landing.tagline}</p>
      </div>

      <div className="card">
        <h2>{t.landing.walletTitle}</h2>
        <p className="muted">{t.landing.walletBody}</p>
      </div>
      <div className="card">
        <h2>{t.landing.referralTitle}</h2>
        <p className="muted">{t.landing.referralBody}</p>
      </div>
      <div className="card">
        <h2>{t.landing.whatsappTitle}</h2>
        <p className="muted">{t.landing.whatsappBody}</p>
      </div>

      <div className="demo-banner" style={{ marginTop: 16 }}>
        {t.landing.demoBanner}
      </div>

      <Link to="/register" className="btn" style={{ marginBottom: 10 }}>{t.landing.createAccount}</Link>
      <Link to="/login" className="btn ghost">{t.landing.haveAccount}</Link>
    </div>
  );
}
