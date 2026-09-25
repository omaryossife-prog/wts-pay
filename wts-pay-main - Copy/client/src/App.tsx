import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./hooks/useAuth";
import Layout from "./components/Layout";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Wallet from "./pages/Wallet";
import Send from "./pages/Send";
import Requests from "./pages/Requests";
import Transactions from "./pages/Transactions";
import Referrals from "./pages/Referrals";
import Profile from "./pages/Profile";
import Help from "./pages/Help";
import Admin from "./pages/Admin";

function Protected({ children, adminOnly = false }: { children: JSX.Element; adminOnly?: boolean }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="shell"><p style={{ padding: 40, textAlign: "center" }}>Loading…</p></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== "ADMIN") return <Navigate to="/wallet" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route element={<Protected><Layout /></Protected>}>
        <Route path="/wallet" element={<Wallet />} />
        <Route path="/send" element={<Send />} />
        <Route path="/requests" element={<Requests />} />
        <Route path="/transactions" element={<Transactions />} />
        <Route path="/referrals" element={<Referrals />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/help" element={<Help />} />
      </Route>
      <Route path="/admin" element={<Protected adminOnly><Layout admin /></Protected>}>
        <Route index element={<Admin />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
