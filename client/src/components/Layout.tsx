import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useLang } from "../i18n/LanguageContext";

export default function Layout({ admin = false }: { admin?: boolean }) {
  const { user, logout } = useAuth();
  const { t } = useLang();
  const nav = useNavigate();

  const links = [
    { to: "/wallet", icon: "💼", label: t.nav.wallet },
    { to: "/send", icon: "💸", label: t.nav.send },
    { to: "/requests", icon: "🙏", label: t.nav.requests },
    { to: "/transactions", icon: "📜", label: t.nav.activity },
    { to: "/referrals", icon: "🎁", label: t.nav.referrals },
    { to: "/profile", icon: "👤", label: t.nav.profile },
  ];

  return (
    <>
      <nav className="navbar">
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} className={({ isActive }) => (isActive ? "active" : "")}>
            <span className="icon">{l.icon}</span>
            {l.label}
          </NavLink>
        ))}
        {user?.role === "ADMIN" && (
          <NavLink to="/admin" className={({ isActive }) => (isActive ? "active" : "")}>
            <span className="icon">🛡️</span>{t.nav.admin}
          </NavLink>
        )}
      </nav>
      <div className="shell">
        <div className="topbar">
          <div className="who">
            {user?.username}
            <small>{user?.phone}</small>
          </div>
          <button
            className="btn ghost small"
            onClick={() => { logout(); nav("/"); }}
          >
            {t.nav.logout}
          </button>
        </div>
        {admin ? <Outlet /> : (
          <>
            <div className="demo-banner">
              <strong>{t.common.demoBannerTitle}</strong> — {t.common.demoBanner}
            </div>
            <Outlet />
          </>
        )}
      </div>
    </>
  );
}
