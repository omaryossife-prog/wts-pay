import { useEffect, useState } from "react";
import { api } from "../services/api";
import { useLang } from "../i18n/LanguageContext";

export default function Profile() {
  const { t, lang, setLang } = useLang();
  const [user, setUser] = useState<any>(null);
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [pinNotice, setPinNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [langNotice, setLangNotice] = useState(false);

  const load = () => api.wallet().then((r) => setUser(r.user)).catch(() => {});
  useEffect(() => { load(); }, []);
  if (!user) return <p style={{ padding: 40, textAlign: "center" }}>{t.common.loading}</p>;

  const submitPin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinError(""); setPinNotice(""); setBusy(true);
    try {
      await api.setPin({ password, pin });
      setPinNotice(user.pinSet ? t.profile.pinUpdated : t.profile.pinCreated);
      setPassword(""); setPin("");
      await load();
    } catch (err: any) {
      setPinError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const changeLanguage = (next: "ar" | "en") => {
    setLang(next);
    setLangNotice(true);
    setTimeout(() => setLangNotice(false), 2500);
  };

  return (
    <>
      <h1 className="page-title">{t.profile.title}</h1>
      <div className="card">
        <div className="list-row"><span>{t.profile.name}</span><strong>{user.username}</strong></div>
        <div className="list-row"><span>{t.profile.phone}</span><strong>{user.phone}</strong></div>
        <div className="list-row"><span>{t.profile.referralCode}</span><strong>{user.referralCode}</strong></div>
        <div className="list-row"><span>{t.profile.status}</span>
          <span className={`badge ${user.status === "ACTIVE" ? "green" : "red"}`}>{user.status}</span>
        </div>
        <div className="list-row"><span>{t.profile.memberSince}</span><strong>{new Date(user.createdAt).toLocaleDateString()}</strong></div>
      </div>

      <div className="card">
        <h2>{t.profile.languageTitle}</h2>
        <p className="muted">{t.profile.languageBody}</p>
        {langNotice && <div className="notice">{t.profile.languageSaved}</div>}
        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            className={lang === "ar" ? "btn" : "btn ghost"}
            onClick={() => changeLanguage("ar")}
          >
            🇪🇬 {t.languagePicker.arabic}
          </button>
          <button
            type="button"
            className={lang === "en" ? "btn" : "btn ghost"}
            onClick={() => changeLanguage("en")}
          >
            🇬🇧 {t.languagePicker.english}
          </button>
        </div>
      </div>

      <div className="card">
        <h2>{t.profile.pinTitle}</h2>
        <p className="muted">
          {user.pinSet ? t.profile.pinSetMsg : t.profile.pinNotSetMsg}
        </p>
        {pinError && <div className="error">{pinError}</div>}
        {pinNotice && <div className="notice">{pinNotice}</div>}
        <form onSubmit={submitPin}>
          <div className="field">
            <label>{t.profile.accountPassword}</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <div className="field">
            <label>{t.profile.newPin}</label>
            <input
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              placeholder="••••••"
              dir="ltr"
              required
            />
          </div>
          <button className="btn" type="submit" disabled={busy || pin.length !== 6}>
            {user.pinSet ? t.profile.updatePin : t.profile.createPin}
          </button>
        </form>
      </div>

      <div className="card">
        <h2>{t.profile.securityTitle}</h2>
        <p className="muted">{t.profile.securityBody}</p>
      </div>
    </>
  );
}
