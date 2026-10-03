export default function Help() {
  return (
    <>
      <h1 className="page-title">Help</h1>
      <div className="card">
        <h2>What is WTS Pay?</h2>
        <p className="muted">
          WTS Pay is a <strong>demo digital wallet</strong>. It uses internal demo credits only.
          There is no real money, no bank integration, no InstaPay or Fawry, and no cash-out.
        </p>
      </div>
      <div className="card">
        <h2>What are demo credits worth?</h2>
        <p className="muted">
          Nothing. <strong>Demo Balance — No Cash Value.</strong> Demo credits cannot be withdrawn,
          exchanged for real money, or transferred outside WTS.
        </p>
      </div>
      <div className="card">
        <h2>How does the transfer fee work?</h2>
        <p className="muted">
          Fee = 1 EGP per started 1,000 EGP (ceiling). Example: sending 1,050 EGP costs a fee of 2 EGP,
          so 1,052 EGP is debited from your balance.
        </p>
      </div>
      <div className="card">
        <h2>How do referrals work?</h2>
        <p className="muted">
          Share your referral code. When a friend signs up with it, stays active, and completes their
          first transfer, you receive the referral reward. Rewards are subject to anti-abuse checks
          and per-user caps.
        </p>
      </div>
      <div className="card">
        <h2>WhatsApp</h2>
        <p className="muted">
          The wallet will be available on WhatsApp through the official WhatsApp Cloud API —
          same balance, same transfers, by chat.
        </p>
      </div>
      <div className="card">
        <h2>Contact</h2>
        <p className="muted">Support: support@wtspay.demo</p>
      </div>
    </>
  );
}
