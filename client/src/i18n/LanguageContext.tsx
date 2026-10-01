import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { translations, type Lang, type TranslationShape } from "./translations";
import { useAuth } from "../hooks/useAuth";
import { api, getToken } from "../services/api";

const STORAGE_KEY = "wts_lang";

interface LanguageCtx {
  lang: Lang;
  // true until a language has been chosen (first-ever visit, logged out) —
  // App.tsx shows the full-screen picker while this is true.
  needsPicker: boolean;
  setLang: (lang: Lang, opts?: { fromPicker?: boolean }) => void;
  t: TranslationShape;
}

const Ctx = createContext<LanguageCtx>(null as never);

function applyDocumentLang(lang: Lang) {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const stored = (typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null) as Lang | null;
  const [lang, setLangState] = useState<Lang>(stored === "en" ? "en" : "ar");
  const [needsPicker, setNeedsPicker] = useState(!stored);
  const { user } = useAuth();

  useEffect(() => { applyDocumentLang(lang); }, [lang]);

  // Once we know who's logged in, the account's saved language wins — it's
  // what the WhatsApp bot uses too, so keep the website in sync with it.
  useEffect(() => {
    if (user?.language === "ar" || user?.language === "en") {
      setLangState(user.language);
      setNeedsPicker(false);
      localStorage.setItem(STORAGE_KEY, user.language);
    }
  }, [user?.language]);

  const setLang = (next: Lang, opts?: { fromPicker?: boolean }) => {
    setLangState(next);
    setNeedsPicker(false);
    localStorage.setItem(STORAGE_KEY, next);
    applyDocumentLang(next);
    if (getToken()) {
      api.setLanguage(next).catch(() => {});
    }
    void opts;
  };

  return (
    <Ctx.Provider value={{ lang, needsPicker, setLang, t: translations[lang] }}>
      {children}
    </Ctx.Provider>
  );
}

export function useLang() {
  return useContext(Ctx);
}
