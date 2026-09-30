import { useEffect, useState } from "react";
import { api } from "../services/api";

export default function Referrals() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    api.referrals().then(setData).catch(() => {});
  }, []);

  if (!data) return <p style={{ padding: 40, textAlign: "center" }}>Loading…</p>;

  const shareLink = `${location.origin}/register?ref=${encodeURIComponent(data.referralCode)}`;

  return (
    <>
      <h1 className="page-title">Referrals</h1>
      <div className="card balance-card" style={{ background: "linear-gradient(135deg,#12b76a,#067647)" }}>
        <div className="label">Your referral code</div>
        <div className="amount" style={{ fontSize: 30 }}>{data.referralCode}</div>
        <div className="demo-note">Earn {data.rules?.referralReward?.amount} EGP per qualified referral</div>
      </div>
      <div className="card">
        <div className="field">
          <label>Your invite link</label>
          <input readOnly value={shareLink} onFocus={(e) => e.target.select()} />
        </div>
        <p className="muted">
          A referral qualifies only after your invitee verifies their account (unique phone),
          stays active, and completes at least {data.rules?.minTransactionsToActivate} transfer(s).
          Rewards are capped at {data.rules?.maxRewardPerUser} EGP per user. No reward for duplicate accounts.
        </p>
      </div>
      <div className="card">
        <h2>Stats</h2>
        <div className="list-row"><span>Invited</span><strong>{data.referrals.length}</strong></div>
        <div className="list-row"><span>Rewarded</span><strong>{data.rewardedCount}</strong></div>
        <div className="list-row"><span>Total earned</span><strong>{data.totalEarned} EGP</strong></div>
      </div>
      <div className="card">
        <h2>My referrals</h2>
        {data.referrals.length === 0 ? <p className="muted">No referrals yet — share your code!</p> :
          data.referrals.map((r: any) => (
            <div className="list-row" key={r.id}>
              <div>
                <div style={{ fontWeight: 600 }}>{r.referred?.phone}</div>
                <div className="meta">joined {new Date(r.createdAt).toLocaleDateString()}</div>
              </div>
              <span className={`badge ${r.status === "REWARDED" ? "green" : r.status === "REJECTED" ? "red" : "gray"}`}>{r.status}</span>
            </div>
          ))}
      </div>
    </>
  );
}
