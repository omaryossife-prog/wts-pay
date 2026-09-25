import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

const links = [
  { to: "/wallet", icon: "💼", label: "Wallet" },
  { to: "/send", icon: "💸", label: "Send" },
  { to: "/requests", icon: "🙏", label: "Requests" },
  { to: "/transactions", icon: "📜", label: "Activity" },
  { to: "/referrals", icon: "🎁", label: "Referrals" },
  { to: "/profile", icon: "👤", label: "Profile" },
];

export default function Layout({ admin = false }: { admin?: boolean }) {
  const { user, logout } = useAuth();
  const nav = useNavigate();
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
            <span className="icon">🛡️</span>Admin
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
            Log out
          </button>
        </div>
        {admin ? <Outlet /> : (
          <>
            <div className="demo-banner">
              <strong>Demo environment</strong> — balances are demo credits with no cash value.
              No real money, no withdrawals.
            </div>
            <Outlet />
          </>
        )}
      </div>
    </>
  );
}
