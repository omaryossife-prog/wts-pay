import { useEffect, useState } from "react";
import { api } from "../services/api";
import StatCard from "../components/StatCard";
import type { AdminStats, ConfigBundle, Transaction, PendingVerification } from "../types";

type Tab = "overview" | "verifications" | "users" | "config" | "audit" | "transactions" | "fraud";

export default function Admin() {
  const [tab, setTab] = useState<Tab>("overview");
  const tabs: Tab[] = ["overview", "verifications", "users", "config", "audit", "transactions", "fraud"];
  return (
    <>
      <h1 className="page-title">Admin Dashboard</h1>
      <div className="row" style={{ marginBottom: 16 }}>
        {tabs.map((t) => (
          <button key={t} className={`btn small ${tab === t ? "" : "ghost"}`} onClick={() => setTab(t)}>
            {t === "fraud" ? "Fraud Reports" : t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {tab === "overview" && <Overview />}
      {tab === "verifications" && <Verifications />}
      {tab === "users" && <Users />}
      {tab === "config" && <Config />}
      {tab === "audit" && <Audit />}
      {tab === "transactions" && <TransactionsTab />}
      {tab === "fraud" && <FraudReports />}
    </>
  );
}

function Overview() {
  const [s, setS] = useState<AdminStats | null>(null);
  useEffect(() => { api.adminStats().then(setS).catch(() => {}); }, []);
  if (!s) return <p className="muted">Loading…</p>;
  return (
    <div className="stat-grid">
      <StatCard label="Total users" value={s.totalUsers} />
      <StatCard label="Active users" value={s.activeUsers} />
      <StatCard label="Pending verification" value={s.pendingReview} tone={s.pendingReview > 0 ? "amber" : "green"} />
      <StatCard label="Frozen accounts" value={s.frozenUsers} tone={s.frozenUsers > 0 ? "red" : undefined} />
      <StatCard label="Demo balance in circulation" value={`${s.demoBalanceInCirculation} EGP`} />
      <StatCard label="Transfers" value={s.transfersCount} />
      <StatCard label="Transfer volume" value={`${s.transferVolume} EGP`} />
      <StatCard label="Referrals (rewarded)" value={`${s.rewardedReferrals}/${s.totalReferrals}`} />
      <StatCard label="Rewards paid" value={`${s.totalRewardsPaid} EGP`} />
      <StatCard label="Suspicious flags" value={s.suspiciousAccounts} tone={s.suspiciousAccounts > 0 ? "amber" : "green"} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pending verifications - METADATA ONLY. ID photos and face videos are never
// stored or displayed here; the admin opens the actual WhatsApp conversation
// to review the media.
// ---------------------------------------------------------------------------
function Verifications() {
  const [items, setItems] = useState<PendingVerification[]>([]);
  const [msg, setMsg] = useState("");
  const [rejectFor, setRejectFor] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const load = () => api.adminVerifications().then((r) => setItems(r.items)).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, []);

  const act = async (fn: () => Promise<any>, ok: string) => {
    try { await fn(); setMsg(ok); setRejectFor(null); setRejectReason(""); load(); }
    catch (e: any) { setMsg(e.message); }
  };

  return (
    <div className="card">
      <h2>Pending Verification</h2>
      <p className="muted" style={{ marginBottom: 12 }}>
        Media policy: ID photos and face videos are <strong>never</strong> stored in WTS databases.
        Open the WhatsApp conversation to review ID photos and the face video directly, then approve or reject.
        Registration details (name, gender, governorate, last 6 digits of national ID) are shown below.
      </p>
      {msg && <div className="notice">{msg}</div>}
      {items.length === 0 ? <p className="muted">No pending registrations.</p> :
        items.map((u) => (
          <div className="card" key={u.id} style={{ background: "#fcfcfd" }}>
            <div style={{ fontWeight: 700 }}>{u.fullName ?? "(no name)"}</div>
            <div className="meta">
              WhatsApp: {u.whatsappPhone ?? "-"}<br />
              WTS ID: {u.wtsId ?? "pending (issued at approval)"}<br />
              Gender: {u.gender === "male" ? "Male" : u.gender === "female" ? "Female" : "—"}<br />
              Governorate: {u.governorate ?? "—"}<br />
              National ID (last 6): {u.nationalIdLast6 ?? "—"}<br />
              ID photos: {u.idSubmitted ? `✅ Submitted ${u.idReceivedAt ? new Date(u.idReceivedAt).toLocaleString() : ""}` : "⏳ Pending"}<br />
              Face video: {u.faceVideoSubmitted ? "✅ Submitted" : "⏳ Pending"}<br />
              Status: <span className="badge amber">Pending Review</span>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              {u.whatsappConversationUrl && (
                <a className="btn small ghost" href={u.whatsappConversationUrl} target="_blank" rel="noreferrer">
                  Open WhatsApp Conversation
                </a>
              )}
              <button className="btn small" onClick={() => act(() => api.adminApprove(u.id), "Approved - wallet created")}>✅ Approve</button>
              <button className="btn small danger" onClick={() => setRejectFor(rejectFor === u.id ? null : u.id)}>❌ Reject</button>
            </div>
            {rejectFor === u.id && (
              <div style={{ marginTop: 10 }}>
                <div className="field">
                  <label>Rejection reason</label>
                  <input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="e.g. ID photo unclear" />
                </div>
                <button className="btn small danger" disabled={rejectReason.trim().length < 3}
                  onClick={() => act(() => api.adminReject(u.id, rejectReason.trim()), "Rejected")}>
                  Confirm Rejection
                </button>
              </div>
            )}
          </div>
        ))}
    </div>
  );
}

function Users() {
  const [q, setQ] = useState("");
  const [users, setUsers] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [confirmAdj, setConfirmAdj] = useState(false);
  const [msg, setMsg] = useState("");

  const search = () => api.adminUsers(q).then((r) => setUsers(r.users)).catch((e) => setMsg(e.message));
  useEffect(() => { search(); }, []);

  const open = async (u: any) => {
    setSelected(u); setMsg(""); setConfirmAdj(false);
    const d = await api.adminUser(u.id).catch((e) => { setMsg(e.message); return null; });
    if (d) setDetail(d);
  };

  const act = async (fn: () => Promise<any>, ok: string) => {
    try { await fn(); setMsg(ok); setConfirmAdj(false); if (selected) open(selected); search(); }
    catch (e: any) { setMsg(e.message); }
  };

  const adjAmount = Number(adjustAmount);
  const preview = detail && Number.isFinite(adjAmount) && adjAmount !== 0 ? {
    before: detail.user.demoBalance,
    after: detail.user.demoBalance + adjAmount,
  } : null;

  return (
    <div className="grid2">
      <div className="card">
        <h2>Search users</h2>
        <div className="row">
          <input style={{ flex: 1, padding: 10, borderRadius: 10, border: "1px solid var(--border)" }}
            placeholder="phone, name, WTS ID or code" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn small" onClick={search}>Search</button>
        </div>
        <div style={{ marginTop: 12 }}>
          {users.map((u) => (
            <div className="list-row" key={u.id} style={{ cursor: "pointer" }} onClick={() => open(u)}>
              <div>
                <div style={{ fontWeight: 600 }}>{u.fullName ?? u.username} {u.role === "ADMIN" && "🛡️"}</div>
                <div className="meta">{u.phone} · {u.demoBalance} EGP</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <span className={`badge ${u.status === "ACTIVE" ? "green" : "red"}`}>{u.status}</span>
                {u.verificationStatus && u.verificationStatus !== "VERIFIED" &&
                  <div><span className="badge amber">{u.verificationStatus.replace(/_/g, " ")}</span></div>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>User profile</h2>
        {msg && <div className="notice">{msg}</div>}
        {!selected ? <p className="muted">Select a user.</p> : !detail ? <p className="muted">Loading…</p> : (
          <>
            <div className="list-row"><span>Full name</span><strong>{detail.user.fullName ?? "-"}</strong></div>
            <div className="list-row"><span>Gender</span><strong>{detail.user.gender === "male" ? "Male" : detail.user.gender === "female" ? "Female" : "—"}</strong></div>
            <div className="list-row"><span>Governorate</span><strong>{detail.user.governorate ?? "—"}</strong></div>
            <div className="list-row"><span>National ID (last 6)</span><strong>{detail.user.nationalIdLast6 ?? "—"}</strong></div>
            <div className="list-row"><span>WTS ID / Wallet</span><strong>{detail.user.wtsId ?? "-"} / {detail.user.walletId ?? "-"}</strong></div>
            <div className="list-row"><span>Phone</span><strong>{detail.user.phone}</strong></div>
            <div className="list-row"><span>WhatsApp</span><strong>{detail.user.whatsappPhone ?? "-"}</strong></div>
            <div className="list-row"><span>Balance</span><strong>{detail.user.demoBalance} EGP</strong></div>
            <div className="list-row"><span>Verification</span>
              <span className={`badge ${detail.user.verificationStatus === "VERIFIED" ? "green" : "amber"}`}>{detail.user.verificationStatus}</span></div>
            <div className="list-row"><span>PIN</span>
              <strong>{detail.user.pinHash ? "Set" : "Not set"} {detail.user.pinLockedUntil && new Date(detail.user.pinLockedUntil) > new Date() ? "🔒 locked" : ""}</strong></div>
            <div className="list-row"><span>Transfers</span>
              <strong>{detail.user.transfersEnabled ? "Enabled" : "Disabled"}</strong></div>
            <div className="list-row"><span>Fraud reports</span>
              <strong>
                {detail.user.fraudReportCount ?? 0}
                {detail.user.banned && " · BANNED"}
                {detail.user.frozenUntil && new Date(detail.user.frozenUntil) > new Date() && ` · frozen until ${new Date(detail.user.frozenUntil).toLocaleDateString()}`}
              </strong>
            </div>

            <div className="row" style={{ margin: "12px 0" }}>
              {detail.user.status === "ACTIVE" ? (
                <button className="btn small danger" onClick={() => act(() => api.adminFreeze(detail.user.id), "Account frozen - user notified via WhatsApp")}>Freeze Account</button>
              ) : (
                <button className="btn small" onClick={() => act(() => api.adminUnfreeze(detail.user.id), "Account unfrozen")}>Unfreeze Account</button>
              )}
              <button className="btn small ghost" onClick={() => act(() => api.adminResetPin(detail.user.id), "PIN reset - user must create a new PIN")}>Reset PIN</button>
              <button className="btn small ghost" onClick={() => act(() => api.adminResetFraudStatus(detail.user.id), "Fraud status reset - counter, freeze and ban cleared")}>Reset fraud status</button>
              {detail.user.transfersEnabled ? (
                <button className="btn small ghost" onClick={() => act(() => api.adminSetTransfers(detail.user.id, false), "Transfers disabled")}>Disable Transfers</button>
              ) : (
                <button className="btn small" onClick={() => act(() => api.adminSetTransfers(detail.user.id, true), "Transfers enabled")}>Enable Transfers</button>
              )}
            </div>

            <h2 style={{ marginTop: 16 }}>Manual balance adjustment</h2>
            <div className="row" style={{ marginBottom: 10 }}>
              <button className={`btn small ${adjAmount >= 0 ? "" : "ghost"}`} onClick={() => setAdjustAmount(Math.abs(adjAmount || 100).toString())}>+ Add Balance</button>
              <button className={`btn small ${adjAmount < 0 ? "danger" : "ghost"}`} onClick={() => setAdjustAmount((-Math.abs(adjAmount || 100)).toString())}>- Deduct Balance</button>
            </div>
            <div className="field">
              <label>Amount (EGP)</label>
              <input inputMode="numeric" value={adjustAmount} onChange={(e) => { setAdjustAmount(e.target.value); setConfirmAdj(false); }} placeholder="100" />
            </div>
            <div className="field">
              <label>Reason (audited, immutable)</label>
              <input value={adjustReason} onChange={(e) => { setAdjustReason(e.target.value); setConfirmAdj(false); }} placeholder="Technical correction" />
            </div>
            {preview && (
              <div className="demo-banner">
                You are {adjAmount > 0 ? "adding" : "deducting"} {Math.abs(adjAmount)} EGP.<br />
                Current: {preview.before} EGP → New: {preview.after} EGP<br />
                Reason: {adjustReason || "-"}
              </div>
            )}
            {!confirmAdj ? (
              <button className="btn small" disabled={!preview || !adjustReason.trim()}
                onClick={() => setConfirmAdj(true)}>
                Review Adjustment
              </button>
            ) : (
              <div className="row">
                <button className="btn small" onClick={() => act(() => api.adminAdjust({ userId: detail.user.id, amount: adjAmount, reason: adjustReason.trim() }), "Adjustment applied with ledger entry")}>
                  Confirm Adjustment
                </button>
                <button className="btn small ghost" onClick={() => setConfirmAdj(false)}>Cancel</button>
              </div>
            )}
            <p className="muted" style={{ marginTop: 8 }}>
              Every adjustment creates a MANUAL_ADJUSTMENT ledger entry (balance before/after) and an audit record.
            </p>

            <h2 style={{ marginTop: 16 }}>Recent transactions</h2>
            {detail.transactions.slice(0, 10).map((t: Transaction) => {
              const isThisSender = t.senderId === detail.user.id;
              const before = isThisSender ? (t.senderBalanceBefore ?? t.balanceBefore) : (t.receiverBalanceBefore ?? t.balanceBefore);
              const after = isThisSender ? (t.senderBalanceAfter ?? t.balanceAfter) : (t.receiverBalanceAfter ?? t.balanceAfter);
              return (
              <div className="list-row" key={t.id}>
                <div>
                  <div style={{ fontSize: 14 }}>{t.type.replace(/_/g, " ")} — {t.amount} EGP</div>
                  <div className="meta">
                    {t.description ?? ""}
                    {before != null && after != null && ` · ${before} → ${after}`}
                    {" · "}{new Date(t.createdAt).toLocaleString()}
                  </div>
                  <div className="meta" style={{ opacity: 0.7 }}>Ref: {t.reference}</div>
                </div>
                <span className={`badge ${t.status === "COMPLETED" ? "green" : "amber"}`}>{t.status}</span>
              </div>
              );
            })}

            <h2 style={{ marginTop: 16 }}>Fraud reports on this user</h2>
            {(!detail.fraudReports || detail.fraudReports.length === 0) && <p className="muted">No reports.</p>}
            {detail.fraudReports?.map((r: any) => (
              <div className="list-row" key={r.id} style={{ flexDirection: "column", alignItems: "stretch", gap: 2 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Report #{r.reportNumber}</span>
                  <span className={`badge ${r.status === "CONFIRMED" ? "red" : r.status === "DISMISSED" ? "green" : "amber"}`}>{r.status}</span>
                </div>
                <span className="meta">
                  Filed {new Date(r.createdAt).toLocaleString()}
                  {r.resolvedAt && ` · resolved ${new Date(r.resolvedAt).toLocaleString()}`}
                  {r.status === "CONFIRMED" && (r.clearedAt ? " · cleared" : r.visible ? " · visible" : " · hidden")}
                </span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function Config() {
  const [cfg, setCfg] = useState<ConfigBundle | null>(null);
  const [msg, setMsg] = useState("");
  useEffect(() => { api.adminConfig().then(setCfg as any).catch((e) => setMsg(e.message)); }, []);

  const save = async (key: string, value: unknown) => {
    try { await api.adminSetConfig(key, value); setMsg(`${key} saved.`); }
    catch (e: any) { setMsg(e.message); }
  };

  if (!cfg) return <p className="muted">Loading…</p>;
  const num = (v: string) => Number(v);
  const val = (id: string) => (document.getElementById(id) as HTMLInputElement)?.value ?? "";
  const checked = (id: string) => (document.getElementById(id) as HTMLInputElement)?.checked ?? false;

  return (
    <div className="card">
      <h2>Configuration</h2>
      {msg && <div className="notice">{msg}</div>}

      <h2 style={{ marginTop: 8 }}>Fee formula</h2>
      <div className="field">
        <label>Fee divisor (fee = ceiling(amount / divisor))</label>
        <input defaultValue={cfg.fee.divisor} inputMode="numeric" id="feeDivisor" />
      </div>
      <button className="btn small" onClick={() => save("fee", { ...cfg.fee, divisor: num(val("feeDivisor")) })}>Save fee</button>

      <h2 style={{ marginTop: 20 }}>Referral rewards</h2>
      <div className="row">
        <input style={{ width: 110, padding: 10, borderRadius: 10, border: "1px solid var(--border)" }} defaultValue={cfg.signupReward.amount} inputMode="numeric" id="signupAmt" />
        <label className="muted"><input type="checkbox" id="signupEn" defaultChecked={cfg.signupReward.enabled} /> signup enabled</label>
        <input style={{ width: 110, padding: 10, borderRadius: 10, border: "1px solid var(--border)" }} defaultValue={cfg.referralReward.amount} inputMode="numeric" id="refAmt" />
        <label className="muted"><input type="checkbox" id="refEn" defaultChecked={cfg.referralReward.enabled} /> referral enabled</label>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn small" onClick={() => save("signupReward", { amount: num(val("signupAmt")), enabled: checked("signupEn") })}>Save signup</button>
        <button className="btn small" onClick={() => save("referralReward", { amount: num(val("refAmt")), enabled: checked("refEn") })}>Save referral</button>
      </div>

      <h2 style={{ marginTop: 20 }}>Referral qualification & campaign</h2>
      <div className="grid2">
        <div className="field"><label>Min transactions to qualify</label>
          <input defaultValue={cfg.referral.minTransactions} inputMode="numeric" id="minTx" /></div>
        <div className="field"><label>Max reward per user (EGP)</label>
          <input defaultValue={cfg.referral.maxRewardPerUser} inputMode="numeric" id="cap" /></div>
      </div>
      <button className="btn small" onClick={() => save("referral", { ...cfg.referral, minTransactions: num(val("minTx")), maxRewardPerUser: num(val("cap")) })}>
        Save qualification rules
      </button>

      <h2 style={{ marginTop: 20 }}>PIN security</h2>
      <div className="grid2">
        <div className="field"><label>Max failed PIN attempts</label>
          <input defaultValue={cfg.security.pinMaxAttempts} inputMode="numeric" id="pinMax" /></div>
        <div className="field"><label>Lock duration (minutes)</label>
          <input defaultValue={cfg.security.pinLockMinutes} inputMode="numeric" id="pinLock" /></div>
        <div className="field"><label>Authorization expiry (minutes)</label>
          <input defaultValue={cfg.security.authorizationTtlMinutes} inputMode="numeric" id="authTtl" /></div>
      </div>
      <button className="btn small" onClick={() => save("security", { ...cfg.security, pinMaxAttempts: num(val("pinMax")), pinLockMinutes: num(val("pinLock")), authorizationTtlMinutes: num(val("authTtl")) })}>
        Save PIN policy
      </button>

      <h2 style={{ marginTop: 20 }}>Transaction limits & maintenance</h2>
      <div className="grid2">
        <div className="field"><label>Min transfer (EGP)</label>
          <input defaultValue={cfg.limits.minTransfer} inputMode="numeric" id="minTr" /></div>
        <div className="field"><label>Max transfer (EGP)</label>
          <input defaultValue={cfg.limits.maxTransfer} inputMode="numeric" id="maxTr" /></div>
        <div className="field"><label>Initial balance at approval (EGP)</label>
          <input defaultValue={(cfg.approval as any)?.initialBalance ?? 0} inputMode="numeric" id="initBal" /></div>
      </div>
      <label className="muted" style={{ display: "block", marginBottom: 10 }}>
        <input type="checkbox" id="maintEn" defaultChecked={cfg.maintenanceMode.enabled} /> maintenance mode
      </label>
      <button className="btn small" onClick={() => save("limits", { minTransfer: num(val("minTr")), maxTransfer: num(val("maxTr")) })}>Save limits</button>{" "}
      <button className="btn small" onClick={() => save("approval", { initialBalance: num(val("initBal")) })}>Save initial balance</button>{" "}
      <button className="btn small" onClick={() => save("maintenanceMode", { ...cfg.maintenanceMode, enabled: checked("maintEn") })}>Save maintenance</button>
    </div>
  );
}

function Audit() {
  const [logs, setLogs] = useState<any[]>([]);
  useEffect(() => { api.adminAudit().then((r) => setLogs(r.logs)).catch(() => {}); }, []);
  const tone = (a: string) =>
    /REJECTED|FROZEN|LOCKED/.test(a) ? "red" : /FLAG|CAPPED/.test(a) ? "amber" : "gray";
  return (
    <div className="card">
      <h2>Audit log (append-only)</h2>
      {logs.length === 0 ? <p className="muted">No audit entries.</p> : (
        <table>
          <thead><tr><th>When</th><th>Event</th><th>Admin</th><th>User</th><th>IP</th></tr></thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id}>
                <td>{new Date(l.createdAt).toLocaleString()}</td>
                <td><span className={`badge ${tone(l.action)}`}>{l.action}</span></td>
                <td>{l.admin?.username ?? "—"}</td>
                <td>{l.user?.phone ?? "—"}</td>
                <td className="meta">{l.ip ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function TransactionsTab() {
  const [items, setItems] = useState<Transaction[]>([]);
  const [q, setQ] = useState("");
  const load = () => api.adminTransactions("", q).then((r) => setItems(r.items)).catch(() => {});
  useEffect(() => { load(); }, []);
  return (
    <div className="card">
      <h2>All transactions</h2>
      <div className="row" style={{ marginBottom: 12 }}>
        <input
          placeholder="Search by reference (WTS-...) or phone"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
          style={{ flex: 1 }}
        />
        <button className="btn small" onClick={load}>Search</button>
      </div>
      <table>
        <thead><tr><th>Reference</th><th>Date</th><th>Type</th><th>From</th><th>Sender bal.</th><th>To</th><th>Receiver bal.</th><th>Amount</th><th>Fee</th><th>Status</th></tr></thead>
        <tbody>
          {items.map((t) => (
            <tr key={t.id}>
              <td className="meta">{t.reference}</td>
              <td>{new Date(t.createdAt).toLocaleString()}</td>
              <td>{t.type.replace(/_/g, " ")}</td>
              <td>{t.sender?.phone ?? "—"}</td>
              <td className="meta">
                {t.senderId
                  ? `${t.senderBalanceBefore ?? t.balanceBefore ?? "—"}→${t.senderBalanceAfter ?? t.balanceAfter ?? "—"}`
                  : "—"}
              </td>
              <td>{t.receiver?.phone ?? "—"}</td>
              <td className="meta">
                {t.receiverId
                  ? `${t.receiverBalanceBefore ?? t.balanceBefore ?? "—"}→${t.receiverBalanceAfter ?? t.balanceAfter ?? "—"}`
                  : "—"}
              </td>
              <td>{t.amount}</td>
              <td>{t.fee}</td>
              <td><span className={`badge ${t.status === "COMPLETED" ? "green" : "amber"}`}>{t.status}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FraudReports() {
  const [statusFilter, setStatusFilter] = useState<"PENDING" | "CONFIRMED" | "DISMISSED" | "">("PENDING");
  const [items, setItems] = useState<any[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  const load = () => {
    api.adminFraudReports(statusFilter || undefined).then((r) => setItems(r.items)).catch((e) => setError(e.message));
  };
  useEffect(() => { load(); }, [statusFilter]);

  const waLink = (phone?: string) => phone ? `https://wa.me/${phone.replace(/[^0-9]/g, "")}` : null;

  const resolve = async (id: string, decision: "CONFIRMED" | "DISMISSED") => {
    setBusyId(id); setError("");
    try {
      await api.adminResolveFraudReport(id, decision, noteDraft[id]);
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  };

  const toggleVisible = async (id: string, visible: boolean) => {
    setBusyId(id);
    try {
      await api.adminSetReportVisibility(id, visible);
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="card">
      <h2>Fraud reports</h2>
      <p className="muted">
        Read the evidence directly in WhatsApp with both the reporter and the reported user, then decide here.
        Report #2 confirmed → 30-day freeze. Report #3 confirmed → permanent ban.
      </p>
      {error && <div className="error">{error}</div>}
      <div className="row" style={{ marginBottom: 12 }}>
        {(["PENDING", "CONFIRMED", "DISMISSED", ""] as const).map((s) => (
          <button key={s || "all"} className={`btn small ${statusFilter === s ? "" : "ghost"}`} onClick={() => setStatusFilter(s)}>
            {s || "All"}
          </button>
        ))}
      </div>

      {items.length === 0 && <p className="muted">No reports here.</p>}

      {items.map((r) => (
        <div key={r.id} className="list-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 6, borderBottom: "1px solid #eee", paddingBottom: 12, marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <strong>Report #{r.reportNumber} on {r.reportedUser?.username} ({r.reportedUser?.phone})</strong>
            <span className={`badge ${r.status === "CONFIRMED" ? "red" : r.status === "DISMISSED" ? "green" : "amber"}`}>{r.status}</span>
          </div>
          <div className="meta">
            Transaction: {r.transaction?.amount} EGP on {new Date(r.transaction?.createdAt).toLocaleString()} ·
            Reported by {r.reporter?.username} ({r.reporter?.phone}) · Filed {new Date(r.createdAt).toLocaleString()}
          </div>
          <div className="row">
            {waLink(r.reporter?.whatsappPhone ?? r.reporter?.phone) && (
              <a className="btn ghost small" target="_blank" href={waLink(r.reporter?.whatsappPhone ?? r.reporter?.phone)!}>
                💬 Message reporter
              </a>
            )}
            {waLink(r.reportedUser?.whatsappPhone ?? r.reportedUser?.phone) && (
              <a className="btn ghost small" target="_blank" href={waLink(r.reportedUser?.whatsappPhone ?? r.reportedUser?.phone)!}>
                💬 Message reported user
              </a>
            )}
          </div>

          {r.status === "PENDING" && (
            <>
              <input
                placeholder="Admin note (optional)"
                value={noteDraft[r.id] ?? ""}
                onChange={(e) => setNoteDraft((d) => ({ ...d, [r.id]: e.target.value }))}
              />
              <div className="row">
                <button className="btn small" disabled={busyId === r.id} onClick={() => resolve(r.id, "CONFIRMED")}>
                  Confirm fraud
                </button>
                <button className="btn ghost small" disabled={busyId === r.id} onClick={() => resolve(r.id, "DISMISSED")}>
                  Dismiss
                </button>
              </div>
            </>
          )}

          {r.status === "CONFIRMED" && (
            <div className="row" style={{ alignItems: "center" }}>
              <span className="meta">
                Total confirmed reports on this user: {r.reportedUser?.fraudReportCount}
                {r.reportedUser?.banned && " · PERMANENTLY BANNED"}
                {r.reportedUser?.frozenUntil && ` · frozen until ${new Date(r.reportedUser.frozenUntil).toLocaleDateString()}`}
              </span>
              <button className="btn ghost small" disabled={busyId === r.id} onClick={() => toggleVisible(r.id, !r.visible)}>
                {r.visible ? "Hide report" : "Show report"}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
