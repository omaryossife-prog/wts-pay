import { useLang } from "../i18n/LanguageContext";

// Shown once, before anything else, exactly like the WhatsApp bot's first
// message — the visitor must pick a language before using the site.
export default function LanguagePicker() {
  const { setLang } = useLang();
  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(15,15,20,0.92)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1000, padding: 20,
      }}
    >
      <div className="card" style={{ maxWidth: 360, width: "100%", textAlign: "center" }}>
        <div className="logo" style={{ marginBottom: 8 }}>WTS <span>Pay</span></div>
        <p style={{ marginBottom: 4 }}>اختار لغتك</p>
        <p className="muted" style={{ marginBottom: 20 }}>Choose your language</p>
        <button className="btn" style={{ marginBottom: 10 }} onClick={() => setLang("ar", { fromPicker: true })}>
          🇪🇬 العربي
        </button>
        <button className="btn ghost" onClick={() => setLang("en", { fromPicker: true })}>
          🇬🇧 English
        </button>
      </div>
    </div>
  );
}
