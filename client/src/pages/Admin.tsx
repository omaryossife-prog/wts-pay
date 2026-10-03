import { useEffect, useState } from "react";
import { api } from "../services/api";
import StatCard from "../components/StatCard";
import type { AdminStats, ConfigBundle, Transaction, PendingVerification } from "../types";
import { useLang } from "../i18n/LanguageContext";

type Tab = "overview" | "verifications" | "users" | "config" | "audit" | "transactions" | "fraud";

export default function Admin() {
  const { t } = useLang();
  const [tab, setTab] = useState<Tab>("overview");
  const tabKeys: Tab[] = ["overview", "verifications", "users", "config", "audit", "transactions", "fraud"];
  return (
    <>
      <h1 className="page-title">{t.admin.title}</h1>
      <div className="row" style={{ marginBottom: 16 }}>
        {tabKeys.map((k) => (
          <button key={k} className={`btn small ${tab === k ? "" : "ghost"}`} onClick={() => setTab(k)}>
            {t.admin.tabs[k]}
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
  const { t } = useLang();
  const [s, setS] = useState<AdminStats | null>(null);
  useEffect(() => { api.adminStats().then(setS).catch(() => {}); }, []);
  if (!s) return <p className="muted">{t.common.loading}</p>;
  const a = t.admin.overview;
  return (
    <div className="stat-grid">
      <StatCard label={a.total} value={s.totalUsers} />
      <StatCard label={a.active} value={s.activeUsers} />
      <StatCard label={a.pending} value={s.pendingReview} tone={s.pendingReview > 0 ? "amber" : "green"} />
      <StatCard label={a.frozen} value={s.frozenUsers} tone={s.frozenUsers > 0 ? "red" : undefined} />
      <StatCard label={a.balance} value={`${s.demoBalanceInCirculation} ${t.common.egp}`} />
      <StatCard label={a.transfers} value={s.transfersCount} />
      <StatCard label={a.volume} value={`${s.transferVolume} ${t.common.egp}`} />
      <StatCard label={a.referrals} value={`${s.rewardedReferrals}/${s.totalReferrals}`} />
      <StatCard label={a.rewards} value={`${s.totalRewardsPaid} ${t.common.egp}`} />
      <StatCard label={a.suspicious} value={s.suspiciousAccounts} tone={s.suspiciousAccounts > 0 ? "amber" : "green"} />
    </div>
  );
}

function Verifications() {
  const { t } = useLang();
  const v = t.admin.verif;
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
      <h2>{v.title}</h2>
      <p className="muted" style={{ marginBottom: 12 }}>{v.policy}</p>
      {msg && <div className="notice">{msg}</div>}
      {items.length === 0 ? <p className="muted">{v.noPending}</p> :
        items.map((u) => (
          <div className="card" key={u.id} style={{ background: "#fcfcfd" }}>
            <div style={{ fontWeight: 700 }}>{u.fullName ?? v.noName}</div>
            <div className="meta">
              WhatsApp: {u.whatsappPhone ?? "-"}<br />
              WTS ID: {u.wtsId ?? "pending"}<br />
              {v.gender}: {u.gender === "male" ? v.male : u.gender === "female" ? v.female : "—"}<br />
              {v.governorate}: {u.governorate ?? "—"}<br />
              {v.nationalId}: {u.nationalIdLast6 ?? "—"}<br />
              {v.front}: {u.idSubmitted ? `✅ ${u.idReceivedAt ? new Date(u.idReceivedAt).toLocaleString() : ""}` : "⏳"}<br />
              {v.video}: {u.faceVideoSubmitted ? "✅" : "⏳"}<br />
              <span className="badge amber">{v.pending}</span>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              {u.whatsappConversationUrl && (
                <a className="btn small ghost" href={u.whatsappConversationUrl} target="_blank" rel="noreferrer">{v.openWa}</a>
              )}
              <button className="btn small" onClick={() => act(() => api.adminApprove(u.id), v.approved)}>{v.approve}</button>
              <button className="btn small danger" onClick={() => setRejectFor(rejectFor === u.id ? null : u.id)}>{v.reject}</button>
            </div>
            {rejectFor === u.id && (
              <div style={{ marginTop: 10 }}>
                <div className="field">
                  <label>{v.rejectLabel}</label>
                  <input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder={v.rejectPlaceholder} />
                </div>
                <button className="btn small danger" disabled={rejectReason.trim().length < 3}
                  onClick={() => act(() => api.adminReject(u.id, rejectReason.trim()), v.rejected)}>
                  {v.confirmReject}
                </button>
              </div>
            )}
          </div>
        ))}
    </div>
  );
}

function Users() {
  const { t } = useLang();
  const u = t.admin.users;
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

  const open = async (usr: any) => {
    setSelected(usr); setMsg(""); setConfirmAdj(false);
    const d = await api.adminUser(usr.id).catch((e) => { setMsg(e.message); return null; });
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
        <h2>{u.title}</h2>
        <div className="row">
          <input style={{ flex: 1, padding: 10, borderRadius: 10, border: "1px solid var(--border)" }}
            placeholder={u.searchPlaceholder} value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn small" onClick={search}>{u.search}</button>
        </div>
        <div style={{ marginTop: 12 }}>
          {users.map((usr) => (
            <div className="list-row" key={usr.id} style={{ cursor: "pointer" }} onClick={() => open(usr)}>
              <div>
                <div style={{ fontWeight: 600 }}>{usr.fullName ?? usr.username} {usr.role === "ADMIN" && "🛡️"}</div>
                <div className="meta">{usr.phone} · {usr.demoBalance} {t.common.egp}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <span className={`badge ${usr.status === "ACTIVE" ? "green" : "red"}`}>{usr.status}</span>
                {usr.verificationStatus && usr.verificationStatus !== "VERIFIED" &&
                  <div><span className="badge amber">{usr.verificationStatus.replace(/_/g, " ")}</span></div>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>{u.profile}</h2>
        {msg && <div className="notice">{msg}</div>}
        {!selected ? <p className="muted">{u.select}</p> : !detail ? <p className="muted">{t.common.loading}</p> : (
          <>
            <div className="list-row"><span>{t.profile.name}</span><strong>{detail.user.fullName ?? "-"}</strong></div>
            <div className="list-row"><span>{t.admin.verif.gender}</span><strong>{detail.user.gender === "male" ? t.admin.verif.male : detail.user.gender === "female" ? t.admin.verif.female : "—"}</strong></div>
            <div className="list-row"><span>{t.admin.verif.governorate}</span><strong>{detail.user.governorate ?? "—"}</strong></div>
            <div className="list-row"><span>{t.admin.verif.nationalId}</span><strong>{detail.user.nationalIdLast6 ?? "—"}</strong></div>
            <div className="list-row"><span>WTS ID / Wallet</span><strong>{detail.user.wtsId ?? "-"} / {detail.user.walletId ?? "-"}</strong></div>
            <div className="list-row"><span>{t.profile.phone}</span><strong>{detail.user.phone}</strong></div>
            <div className="list-row"><span>WhatsApp</span><strong>{detail.user.whatsappPhone ?? "-"}</strong></div>
            <div className="list-row"><span>{u.balance}</span><strong>{detail.user.demoBalance} {t.common.egp}</strong></div>
            <div className="list-row"><span>{u.verif}</span>
              <span className={`badge ${detail.user.verificationStatus === "VERIFIED" ? "green" : "amber"}`}>{detail.user.verificationStatus}</span></div>
            <div className="list-row"><span>{u.pin}</span>
              <strong>{detail.user.pinHash ? u.pinSet : u.pinNotSet} {detail.user.pinLockedUntil && new Date(detail.user.pinLockedUntil) > new Date() ? u.locked : ""}</strong></div>
            <div className="list-row"><span>{u.transfers}</span>
              <strong>{detail.user.transfersEnabled ? u.enabled : u.disabled}</strong></div>
            <div className="list-row"><span>{u.fraudReports}</span>
              <strong>
                {detail.user.fraudReportCount ?? 0}
                {detail.user.banned && ` · ${u.banned}`}
                {detail.user.frozenUntil && new Date(detail.user.frozenUntil) > new Date() && ` · ${u.frozenUntil} ${new Date(detail.user.frozenUntil).toLocaleDateString()}`}
              </strong>
            </div>

            <div className="row" style={{ margin: "12px 0", flexWrap: "wrap", gap: 6 }}>
              {detail.user.status === "ACTIVE"
                ? <button className="btn small danger" onClick={() => act(() => api.adminFreeze(detail.user.id), `${u.freeze} ✓`)}>{u.freeze}</button>
                : <button className="btn small" onClick={() => act(() => api.adminUnfreeze(detail.user.id), `${u.unfreeze} ✓`)}>{u.unfreeze}</button>}
              <button className="btn small ghost" onClick={() => act(() => api.adminResetPin(detail.user.id), `${u.resetPin} ✓`)}>{u.resetPin}</button>
              <button className="btn small ghost" onClick={() => act(() => api.adminResetFraudStatus(detail.user.id), `${u.resetFraud} ✓`)}>{u.resetFraud}</button>
              {detail.user.transfersEnabled
                ? <button className="btn small ghost" onClick={() => act(() => api.adminSetTransfers(detail.user.id, false), `${u.disableTransfers} ✓`)}>{u.disableTransfers}</button>
                : <button className="btn small" onClick={() => act(() => api.adminSetTransfers(detail.user.id, true), `${u.enableTransfers} ✓`)}>{u.enableTransfers}</button>}
            </div>

            <h2 style={{ marginTop: 16 }}>{u.adjust}</h2>
            <div className="row" style={{ marginBottom: 10 }}>
              <button className={`btn small ${adjAmount >= 0 ? "" : "ghost"}`} onClick={() => setAdjustAmount(Math.abs(adjAmount || 100).toString())}>{u.addBalance}</button>
              <button className={`btn small ${adjAmount < 0 ? "danger" : "ghost"}`} onClick={() => setAdjustAmount((-Math.abs(adjAmount || 100)).toString())}>{u.deductBalance}</button>
            </div>
            <div className="field"><label>{u.amount}</label>
              <input inputMode="numeric" value={adjustAmount} onChange={(e) => { setAdjustAmount(e.target.value); setConfirmAdj(false); }} placeholder="100" dir="ltr" /></div>
            <div className="field"><label>{u.reason}</label>
              <input value={adjustReason} onChange={(e) => { setAdjustReason(e.target.value); setConfirmAdj(false); }} placeholder={u.reasonPlaceholder} /></div>
            {preview && (
              <div className="demo-banner">
                {adjAmount > 0 ? u.adding : u.deducting} {Math.abs(adjAmount)} {t.common.egp}<br />
                {u.current}: {preview.before} → {u.newBal}: {preview.after} {t.common.egp}<br />
                {u.reasonLabel}: {adjustReason || "-"}
              </div>
            )}
            {!confirmAdj
              ? <button className="btn small" disabled={!preview || !adjustReason.trim()} onClick={() => setConfirmAdj(true)}>{u.review}</button>
              : <div className="row">
                  <button className="btn small" onClick={() => act(() => api.adminAdjust({ userId: detail.user.id, amount: adjAmount, reason: adjustReason.trim() }), `${u.confirm} ✓`)}>{u.confirm}</button>
                  <button className="btn small ghost" onClick={() => setConfirmAdj(false)}>{u.cancel}</button>
                </div>}
            <p className="muted" style={{ marginTop: 8 }}>{u.adjustNote}</p>

            <h2 style={{ marginTop: 16 }}>{u.recentTx}</h2>
            {detail.transactions.slice(0, 10).map((tx: Transaction) => {
              const isSender = tx.senderId === detail.user.id;
              const before = isSender ? (tx.senderBalanceBefore ?? tx.balanceBefore) : (tx.receiverBalanceBefore ?? tx.balanceBefore);
              const after = isSender ? (tx.senderBalanceAfter ?? tx.balanceAfter) : (tx.receiverBalanceAfter ?? tx.balanceAfter);
              return (
                <div className="list-row" key={tx.id}>
                  <div>
                    <div style={{ fontSize: 14 }}>{tx.type.replace(/_/g, " ")} — {tx.amount} {t.common.egp}</div>
                    <div className="meta">
                      {tx.description ?? ""}
                      {before != null && after != null && ` · ${before} → ${after}`}
                      {" · "}{new Date(tx.createdAt).toLocaleString()}
                    </div>
                    <div className="meta" style={{ opacity: 0.7 }}>Ref: {tx.reference}</div>
                  </div>
                  <span className={`badge ${tx.status === "COMPLETED" ? "green" : "amber"}`}>{tx.status}</span>
                </div>
              );
            })}

            <h2 style={{ marginTop: 16 }}>{u.fraudTitle}</h2>
            {(!detail.fraudReports || detail.fraudReports.length === 0) && <p className="muted">{u.noReports}</p>}
            {detail.fraudReports?.map((r: any) => (
              <div className="list-row" key={r.id} style={{ flexDirection: "column", alignItems: "stretch", gap: 2 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>{u.report}{r.reportNumber}</span>
                  <span className={`badge ${r.status === "CONFIRMED" ? "red" : r.status === "DISMISSED" ? "green" : "amber"}`}>{r.status}</span>
                </div>
                <span className="meta">
                  {u.filed} {new Date(r.createdAt).toLocaleString()}
                  {r.resolvedAt && ` · ${u.resolved} ${new Date(r.resolvedAt).toLocaleString()}`}
                  {r.status === "CONFIRMED" && (r.clearedAt ? ` · ${u.cleared}` : "")}
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
  const { t } = useLang();
  const c = t.admin.config;
  const [cfg, setCfg] = useState<ConfigBundle | null>(null);
  const [msg, setMsg] = useState("");
  useEffect(() => { api.adminConfig().then(setCfg as any).catch((e) => setMsg(e.message)); }, []);

  const save = async (key: string, value: unknown) => {
    try { await api.adminSetConfig(key, value); setMsg(`${key} ✓`); }
    catch (e: any) { setMsg(e.message); }
  };

  if (!cfg) return <p className="muted">{t.common.loading}</p>;
  const num = (v: string) => Number(v);
  const val = (id: string) => (document.getElementById(id) as HTMLInputElement)?.value ?? "";
  const checked = (id: string) => (document.getElementById(id) as HTMLInputElement)?.checked ?? false;

  return (
    <div className="card">
      <h2>{c.title}</h2>
      {msg && <div className="notice">{msg}</div>}

      <h2 style={{ marginTop: 8 }}>{c.feeTitle}</h2>
      <div className="field"><label>{c.feeLabel}</label><input defaultValue={cfg.fee.divisor} inputMode="numeric" id="feeDivisor" dir="ltr" /></div>
      <button className="btn small" onClick={() => save("fee", { ...cfg.fee, divisor: num(val("feeDivisor")) })}>{c.saveFee}</button>

      <h2 style={{ marginTop: 20 }}>{c.referralTitle}</h2>
      <div className="row">
        <input style={{ width: 110, padding: 10, borderRadius: 10, border: "1px solid var(--border)" }} defaultValue={cfg.referralReward.amount} inputMode="numeric" id="refAmt" dir="ltr" />
        <label className="muted"><input type="checkbox" id="refEn" defaultChecked={cfg.referralReward.enabled} /> {c.referralEnabled}</label>
        <input style={{ width: 110, padding: 10, borderRadius: 10, border: "1px solid var(--border)" }} defaultValue={cfg.signupReward.amount} inputMode="numeric" id="signupAmt" dir="ltr" />
        <label className="muted"><input type="checkbox" id="signupEn" defaultChecked={cfg.signupReward.enabled} /> {c.signupEnabled}</label>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn small" onClick={() => save("referralReward", { amount: num(val("refAmt")), enabled: checked("refEn") })}>{c.saveReferral}</button>
        <button className="btn small" onClick={() => save("signupReward", { amount: num(val("signupAmt")), enabled: checked("signupEn") })}>{c.saveSignup}</button>
      </div>

      <h2 style={{ marginTop: 20 }}>{c.qualTitle}</h2>
      <div className="grid2">
        <div className="field"><label>{c.minTx}</label><input defaultValue={cfg.referral.minTransactions} inputMode="numeric" id="minTx" dir="ltr" /></div>
        <div className="field"><label>{c.maxReward}</label><input defaultValue={cfg.referral.maxRewardPerUser} inputMode="numeric" id="cap" dir="ltr" /></div>
      </div>
      <button className="btn small" onClick={() => save("referral", { ...cfg.referral, minTransactions: num(val("minTx")), maxRewardPerUser: num(val("cap")) })}>{c.saveQual}</button>

      <h2 style={{ marginTop: 20 }}>{c.pinTitle}</h2>
      <div className="grid2">
        <div className="field"><label>{c.maxAttempts}</label><input defaultValue={cfg.security.pinMaxAttempts} inputMode="numeric" id="pinMax" dir="ltr" /></div>
        <div className="field"><label>{c.lockMinutes}</label><input defaultValue={cfg.security.pinLockMinutes} inputMode="numeric" id="pinLock" dir="ltr" /></div>
        <div className="field"><label>{c.authTtl}</label><input defaultValue={cfg.security.authorizationTtlMinutes} inputMode="numeric" id="authTtl" dir="ltr" /></div>
      </div>
      <button className="btn small" onClick={() => save("security", { ...cfg.security, pinMaxAttempts: num(val("pinMax")), pinLockMinutes: num(val("pinLock")), authorizationTtlMinutes: num(val("authTtl")) })}>{c.savePin}</button>

      <h2 style={{ marginTop: 20 }}>{c.limitsTitle}</h2>
      <div className="grid2">
        <div className="field"><label>{c.minTransfer}</label><input defaultValue={cfg.limits.minTransfer} inputMode="numeric" id="minTr" dir="ltr" /></div>
        <div className="field"><label>{c.maxTransfer}</label><input defaultValue={cfg.limits.maxTransfer} inputMode="numeric" id="maxTr" dir="ltr" /></div>
        <div className="field"><label>{c.initBalance}</label><input defaultValue={(cfg.approval as any)?.initialBalance ?? 0} inputMode="numeric" id="initBal" dir="ltr" /></div>
      </div>
      <label className="muted" style={{ display: "block", marginBottom: 10 }}>
        <input type="checkbox" id="maintEn" defaultChecked={cfg.maintenanceMode.enabled} /> {c.maintenance}
      </label>
      <button className="btn small" onClick={() => save("limits", { minTransfer: num(val("minTr")), maxTransfer: num(val("maxTr")) })}>{c.saveLimits}</button>{" "}
      <button className="btn small" onClick={() => save("approval", { initialBalance: num(val("initBal")) })}>{c.saveInit}</button>{" "}
      <button className="btn small" onClick={() => save("maintenanceMode", { ...cfg.maintenanceMode, enabled: checked("maintEn") })}>{c.saveMaint}</button>
    </div>
  );
}

function Audit() {
  const { t } = useLang();
  const a = t.admin.audit;
  const [logs, setLogs] = useState<any[]>([]);
  useEffect(() => { api.adminAudit().then((r) => setLogs(r.logs)).catch(() => {}); }, []);
  const tone = (action: string) =>
    /REJECTED|FROZEN|LOCKED/.test(action) ? "red" : /FLAG|CAPPED/.test(action) ? "amber" : "gray";
  return (
    <div className="card">
      <h2>{a.title}</h2>
      {logs.length === 0 ? <p className="muted">{a.noLogs}</p> : (
        <table>
          <thead><tr><th>{a.when}</th><th>{a.event}</th><th>{a.admin}</th><th>{a.user}</th><th>{a.ip}</th></tr></thead>
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
  const { t } = useLang();
  const tx = t.admin.txTab;
  const [items, setItems] = useState<Transaction[]>([]);
  const [q, setQ] = useState("");
  const load = () => api.adminTransactions("", q).then((r) => setItems(r.items)).catch(() => {});
  useEffect(() => { load(); }, []);
  return (
    <div className="card">
      <h2>{tx.title}</h2>
      <div className="row" style={{ marginBottom: 12 }}>
        <input placeholder={tx.searchPlaceholder} value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()} style={{ flex: 1 }} />
        <button className="btn small" onClick={load}>{tx.search}</button>
      </div>
      <table>
        <thead><tr><th>{tx.ref}</th><th>{tx.date}</th><th>{tx.type}</th><th>{tx.from}</th><th>{tx.senderBal}</th><th>{tx.to}</th><th>{tx.receiverBal}</th><th>{tx.amount}</th><th>{tx.fee}</th><th>{tx.status}</th></tr></thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td className="meta">{item.reference}</td>
              <td>{new Date(item.createdAt).toLocaleString()}</td>
              <td>{item.type.replace(/_/g, " ")}</td>
              <td>{item.sender?.phone ?? "—"}</td>
              <td className="meta">{item.senderId ? `${item.senderBalanceBefore ?? item.balanceBefore ?? "—"}→${item.senderBalanceAfter ?? item.balanceAfter ?? "—"}` : "—"}</td>
              <td>{item.receiver?.phone ?? "—"}</td>
              <td className="meta">{item.receiverId ? `${item.receiverBalanceBefore ?? item.balanceBefore ?? "—"}→${item.receiverBalanceAfter ?? item.balanceAfter ?? "—"}` : "—"}</td>
              <td>{item.amount}</td>
              <td>{item.fee}</td>
              <td><span className={`badge ${item.status === "COMPLETED" ? "green" : "amber"}`}>{item.status}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FraudReports() {
  const { t } = useLang();
  const f = t.admin.fraud;
  const [statusFilter, setStatusFilter] = useState<"PENDING" | "CONFIRMED" | "DISMISSED" | "">("PENDING");
  const [items, setItems] = useState<any[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  const load = () => { api.adminFraudReports(statusFilter || undefined).then((r) => setItems(r.items)).catch((e) => setError(e.message)); };
  useEffect(() => { load(); }, [statusFilter]);

  const waLink = (phone?: string) => phone ? `https://wa.me/${phone.replace(/[^0-9]/g, "")}` : null;

  const resolve = async (id: string, decision: "CONFIRMED" | "DISMISSED") => {
    setBusyId(id); setError("");
    try { await api.adminResolveFraudReport(id, decision, noteDraft[id]); load(); }
    catch (e: any) { setError(e.message); }
    finally { setBusyId(null); }
  };

  const toggleVisible = async (id: string, visible: boolean) => {
    setBusyId(id);
    try { await api.adminSetReportVisibility(id, visible); load(); }
    catch (e: any) { setError(e.message); }
    finally { setBusyId(null); }
  };

  return (
    <div className="card">
      <h2>{f.title}</h2>
      <p className="muted">{f.desc}</p>
      {error && <div className="error">{error}</div>}
      <div className="row" style={{ marginBottom: 12 }}>
        {(["PENDING", "CONFIRMED", "DISMISSED", ""] as const).map((s) => (
          <button key={s || "all"} className={`btn small ${statusFilter === s ? "" : "ghost"}`} onClick={() => setStatusFilter(s)}>
            {s || f.all}
          </button>
        ))}
      </div>

      {items.length === 0 && <p className="muted">{t.admin.users.noReports}</p>}

      {items.map((r) => (
        <div key={r.id} className="list-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 6, borderBottom: "1px solid #eee", paddingBottom: 12, marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <strong>{f.reportOn} {r.reportedUser?.username} ({r.reportedUser?.phone})</strong>
            <span className={`badge ${r.status === "CONFIRMED" ? "red" : r.status === "DISMISSED" ? "green" : "amber"}`}>{r.status}</span>
          </div>
          <div className="meta">
            {f.transaction}: {r.transaction?.amount} {t.common.egp} · {new Date(r.transaction?.createdAt).toLocaleString()} ·
            {f.reportedBy} {r.reporter?.username} · {f.filed} {new Date(r.createdAt).toLocaleString()}
          </div>
          <div className="row">
            {waLink(r.reporter?.whatsappPhone ?? r.reporter?.phone) && (
              <a className="btn ghost small" target="_blank" href={waLink(r.reporter?.whatsappPhone ?? r.reporter?.phone)!}>{f.msgReporter}</a>
            )}
            {waLink(r.reportedUser?.whatsappPhone ?? r.reportedUser?.phone) && (
              <a className="btn ghost small" target="_blank" href={waLink(r.reportedUser?.whatsappPhone ?? r.reportedUser?.phone)!}>{f.msgReported}</a>
            )}
          </div>
          {r.status === "PENDING" && (
            <>
              <input placeholder={f.notePlaceholder} value={noteDraft[r.id] ?? ""} onChange={(e) => setNoteDraft((d) => ({ ...d, [r.id]: e.target.value }))} />
              <div className="row">
                <button className="btn small" disabled={busyId === r.id} onClick={() => resolve(r.id, "CONFIRMED")}>{f.confirmFraud}</button>
                <button className="btn ghost small" disabled={busyId === r.id} onClick={() => resolve(r.id, "DISMISSED")}>{f.dismiss}</button>
              </div>
            </>
          )}
          {r.status === "CONFIRMED" && (
            <div className="row" style={{ alignItems: "center" }}>
              <span className="meta">
                {f.totalReports}: {r.reportedUser?.fraudReportCount}
                {r.reportedUser?.banned && ` · ${t.admin.users.banned}`}
                {r.reportedUser?.frozenUntil && ` · ${t.admin.users.frozenUntil} ${new Date(r.reportedUser.frozenUntil).toLocaleDateString()}`}
              </span>
              <button className="btn ghost small" disabled={busyId === r.id} onClick={() => toggleVisible(r.id, !r.visible)}>
                {r.visible ? f.hide : f.show}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
