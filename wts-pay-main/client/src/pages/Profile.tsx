import { useEffect, useState } from "react";
import { api } from "../services/api";

export default function Profile() {
  const [user, setUser] = useState<any>(null);
  useEffect(() => { api.wallet().then((r) => setUser(r.user)).catch(() => {}); }, []);
  if (!user) return <p style={{ padding: 40, textAlign: "center" }}>Loading…</p>;

  return (
    <>
      <h1 className="page-title">Profile</h1>
      <div className="card">
        <div className="list-row"><span>Name</span><strong>{user.username}</strong></div>
        <div className="list-row"><span>Phone</span><strong>{user.phone}</strong></div>
        <div className="list-row"><span>Referral code</span><strong>{user.referralCode}</strong></div>
        <div className="list-row"><span>Account status</span>
          <span className={`badge ${user.status === "ACTIVE" ? "green" : "red"}`}>{user.status}</span>
        </div>
        <div className="list-row"><span>Member since</span><strong>{new Date(user.createdAt).toLocaleDateString()}</strong></div>
      </div>
      <div className="card">
        <h2>Security</h2>
        <p className="muted">
          Passwords are hashed with bcrypt. Sessions use signed JWTs. WhatsApp sessions
          expire automatically after 10 minutes of inactivity.
        </p>
      </div>
    </>
  );
}
