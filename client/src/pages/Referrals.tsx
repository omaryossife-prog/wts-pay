import { useEffect, useState } from "react";
import { api } from "../services/api";
import { useLang } from "../i18n/LanguageContext";

export default function Referrals() {
  const { t } = useLang();
  const [data, setData] = useState<any>(null);

  useEffect(() => { api.referrals().then(setData).catch(() => {}); }, []);

  if (!data) return <p style={{ padding: 40, textAlign: "center" }}>{t.common.loading}</p>;

  const shareLink = `${location.origin}/register?ref=${encodeURIComponent(data.referralCode)}`;
  const amount = data.rules?.referralReward?.amount ?? 0;
  const min = data.rules?.minTransactionsToActivate ?? 1;
  const max = data.rules?.maxRewardPerUser ?? 0;

  return (
    <>
      <h1 className="page-title">{t.referrals.title}</h1>
      <div className="card balance-card" style={{ background: "linear-gradient(135deg,#12b76a,#067647)" }}>
        <div className="label">{t.referrals.codeLabel}</div>
        <div className="amount" style={{ fontSize: 30 }}>{data.referralCode}</div>
        <div className="demo-note">{t.referrals.earnLabel.replace("{amount}", amount)}</div>
      </div>
      <div className="card">
        <div className="field">
          <label>{t.referrals.inviteLabel}</label>
          <input readOnly value={shareLink} onFocus={(e) => e.target.select()} dir="ltr" />
        </div>
        <p className="muted">
          {t.referrals.qualifyNote.replace("{min}", min).replace("{max}", max)}
        </p>
      </div>
      <div className="card">
        <h2>{t.referrals.statsTitle}</h2>
        <div className="list-row"><span>{t.referrals.invited}</span><strong>{data.referrals.length}</strong></div>
        <div className="list-row"><span>{t.referrals.rewarded}</span><strong>{data.rewardedCount}</strong></div>
        <div className="list-row"><span>{t.referrals.totalEarned}</span><strong>{data.totalEarned} {t.common.egp}</strong></div>
      </div>
      <div className="card">
        <h2>{t.referrals.myReferrals}</h2>
        {data.referrals.length === 0
          ? <p className="muted">{t.referrals.noReferrals}</p>
          : data.referrals.map((r: any) => (
              <div className="list-row" key={r.id}>
                <div>
                  <div style={{ fontWeight: 600 }}>{r.referred?.phone}</div>
                  <div className="meta">{t.referrals.joined} {new Date(r.createdAt).toLocaleDateString()}</div>
                </div>
                <span className={`badge ${r.status === "REWARDED" ? "green" : r.status === "REJECTED" ? "red" : "gray"}`}>{r.status}</span>
              </div>
            ))}
      </div>
    </>
  );
}
