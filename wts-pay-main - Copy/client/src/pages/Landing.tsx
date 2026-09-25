import { Link } from "react-router-dom";

export default function Landing() {
  return (
    <div className="shell" style={{ paddingBottom: 40 }}>
      <div className="hero">
        <div className="logo">WTS <span>Pay</span></div>
        <p>A demo digital wallet — send demo credits to friends, earn referral rewards.</p>
      </div>

      <div className="card">
        <h2>💼 Demo Wallet</h2>
        <p className="muted">
          Every account gets an internal demo balance. Transfers between WTS users are instant,
          with a transparent fee of 1 EGP per started 1,000 EGP.
        </p>
      </div>
      <div className="card">
        <h2>🎁 Referral Rewards</h2>
        <p className="muted">
          Invite friends with your personal code. Rewards are paid only after anti-abuse checks —
          when your invitee completes their first transfer.
        </p>
      </div>
      <div className="card">
        <h2>💬 WhatsApp-ready</h2>
        <p className="muted">
          The same wallet engine will be reachable through the official WhatsApp Cloud API —
          balance checks, transfers and referrals by chat.
        </p>
      </div>

      <div className="demo-banner" style={{ marginTop: 16 }}>
        <strong>Demo Balance — No Cash Value.</strong> Demo credits cannot be withdrawn,
        exchanged, or transferred outside WTS. No bank, InstaPay, or Fawry integration.
      </div>

      <Link to="/register" className="btn" style={{ marginBottom: 10 }}>Create free demo account</Link>
      <Link to="/login" className="btn ghost">I have an account</Link>
    </div>
  );
}
