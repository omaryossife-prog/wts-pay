// ---------------------------------------------------------------------------
// Website translations (Arabic / English). Flat dictionary, dot-free keys
// grouped by page/section as plain objects. Add new keys here and read them
// with useLang()'s t() helper — see LanguageContext.tsx.
// ---------------------------------------------------------------------------
export type Lang = "ar" | "en";

export interface TranslationShape {
  nav: {
    wallet: string; send: string; requests: string; activity: string;
    referrals: string; profile: string; admin: string; logout: string;
  };
  common: {
    loading: string; save: string; cancel: string; egp: string;
    demoBannerTitle: string; demoBanner: string;
  };
  landing: {
    tagline: string;
    walletTitle: string; walletBody: string;
    referralTitle: string; referralBody: string;
    whatsappTitle: string; whatsappBody: string;
    demoBanner: string;
    createAccount: string; haveAccount: string;
  };
  login: {
    subtitle: string; phone: string; password: string;
    submit: string; submitting: string; noAccount: string; registerLink: string;
  };
  profile: {
    title: string; name: string; phone: string; referralCode: string;
    status: string; memberSince: string;
    pinTitle: string; pinSetMsg: string; pinNotSetMsg: string;
    accountPassword: string; newPin: string;
    updatePin: string; createPin: string;
    pinUpdated: string; pinCreated: string;
    securityTitle: string; securityBody: string;
    languageTitle: string; languageBody: string; languageSaved: string;
  };
  languagePicker: {
    title: string; subtitle: string; arabic: string; english: string;
  };
  tx: {
    sent: string; received: string; with: string; fee: string; ref: string;
    reportBtn: string; reporting: string; reported: string;
    statusCompleted: string; statusReversed: string;
  };
  admin: {
    title: string;
    tabs: { overview: string; verifications: string; users: string; config: string; audit: string; transactions: string; fraud: string };
    overview: { total: string; active: string; pending: string; frozen: string; balance: string; transfers: string; volume: string; referrals: string; rewards: string; suspicious: string };
    verif: { title: string; policy: string; noName: string; pending: string; front: string; video: string; openWa: string; approve: string; reject: string; rejectLabel: string; rejectPlaceholder: string; confirmReject: string; approved: string; rejected: string; noPending: string; gender: string; male: string; female: string; governorate: string; nationalId: string };
    users: { title: string; profile: string; select: string; search: string; searchPlaceholder: string; balance: string; verif: string; pin: string; pinSet: string; pinNotSet: string; locked: string; transfers: string; enabled: string; disabled: string; fraudReports: string; banned: string; frozenUntil: string; freeze: string; unfreeze: string; resetPin: string; resetFraud: string; disableTransfers: string; enableTransfers: string; adjust: string; addBalance: string; deductBalance: string; amount: string; reason: string; reasonPlaceholder: string; adding: string; deducting: string; current: string; newBal: string; reasonLabel: string; review: string; confirm: string; cancel: string; adjustNote: string; recentTx: string; fraudTitle: string; noReports: string; report: string; filed: string; resolved: string; cleared: string };
    config: { title: string; feeTitle: string; feeLabel: string; saveFee: string; referralTitle: string; signupEnabled: string; referralEnabled: string; saveSignup: string; saveReferral: string; qualTitle: string; minTx: string; maxReward: string; saveQual: string; pinTitle: string; maxAttempts: string; lockMinutes: string; authTtl: string; savePin: string; limitsTitle: string; minTransfer: string; maxTransfer: string; initBalance: string; maintenance: string; saveLimits: string; saveInit: string; saveMaint: string };
    audit: { title: string; noLogs: string; when: string; event: string; admin: string; user: string; ip: string };
    txTab: { title: string; searchPlaceholder: string; search: string; ref: string; date: string; type: string; from: string; senderBal: string; to: string; receiverBal: string; amount: string; fee: string; status: string };
    fraud: { title: string; desc: string; all: string; reportOn: string; transaction: string; reportedBy: string; filed: string; msgReporter: string; msgReported: string; notePlaceholder: string; confirmFraud: string; dismiss: string; totalReports: string; hide: string; show: string };
  };
  wallet: {
    title: string; balanceLabel: string; noValue: string; sendBtn: string; txBtn: string;
    recentActivity: string; noTx: string;
  };
  send: {
    title: string; recipientLabel: string; amountLabel: string;
    antiFraudLabel: string; antiFraudDesc: string;
    calcFeeBtn: string; amountRow: string; feeRow: string; totalRow: string;
    feeNote: string; confirmBtn: string; sendingBtn: string; doneMsg: string;
    amountError: string;
  };
  requests: {
    title: string; noPinNotice: string; profileLink: string;
    incomingTab: string; sentTab: string; newTab: string;
    noPending: string; noSent: string;
    requests: string; pinPlaceholder: string; confirmBtn: string; cancelBtn: string;
    acceptBtn: string; rejectBtn: string; cancelRequestBtn: string;
    from: string; reasonLabel: string; reasonPlaceholder: string; sendBtn: string;
    requestSent: string; accepted: string; payerLabel: string; amountLabel: string;
  };
  transactions: {
    title: string; noTx: string; prev: string; next: string; pageOf: string;
  };
  referrals: {
    title: string; codeLabel: string; earnLabel: string; inviteLabel: string;
    qualifyNote: string; statsTitle: string; invited: string; rewarded: string;
    totalEarned: string; myReferrals: string; noReferrals: string; joined: string;
  };
}

export const translations: Record<Lang, TranslationShape> = {
  ar: {
    nav: {
      wallet: "المحفظة", send: "تحويل", requests: "الطلبات", activity: "العمليات",
      referrals: "الإحالات", profile: "حسابي", admin: "الإدارة", logout: "خروج",
    },
    common: {
      loading: "جاري التحميل…", save: "حفظ", cancel: "إلغاء", egp: "جنيه",
      demoBannerTitle: "بيئة تجريبية", demoBanner: "الأرصدة تجريبية ومالهاش قيمة نقدية. مفيش فلوس حقيقية ولا سحب.",
    },
    landing: {
      tagline: "محفظة رقمية تجريبية — ابعت رصيد تجريبي لأصحابك واكسب مكافآت الإحالة.",
      walletTitle: "💼 محفظة تجريبية", walletBody: "كل حساب بياخد رصيد تجريبي داخلي. التحويلات بين مستخدمي WTS فورية، بعمولة واضحة جنيه واحد لكل 1000 جنيه أو جزء منه.",
      referralTitle: "🎁 مكافآت الإحالة", referralBody: "ادعُ أصحابك بالكود الشخصي بتاعك. المكافآت بتتصرف بعد فحوصات مكافحة الاحتيال بس — لما اللي دعوته يعمل أول تحويل.",
      whatsappTitle: "💬 جاهز على واتساب", whatsappBody: "نفس محرك المحفظة متاح من خلال واتساب الرسمي — رصيد، تحويلات، وإحالات بالمحادثة.",
      demoBanner: "رصيد تجريبي — مالوش قيمة نقدية. الأرصدة التجريبية متتسحبش ومتتحولش لفلوس حقيقية، ومفيش ربط ببنك أو إنستاباي أو فوري.",
      createAccount: "اعمل حساب تجريبي مجاني", haveAccount: "عندي حساب بالفعل",
    },
    login: {
      subtitle: "سجّل دخولك لمحفظتك التجريبية", phone: "رقم الواتساب", password: "كلمة السر",
      submit: "دخول", submitting: "جاري الدخول…", noAccount: "معندكش حساب؟", registerLink: "اعمل حساب",
    },
    profile: {
      title: "حسابي", name: "الاسم", phone: "الموبايل", referralCode: "كود الإحالة",
      status: "حالة الحساب", memberSince: "عضو من",
      pinTitle: "الرقم السري للعمليات", pinSetMsg: "رقمك السري متظبط. استخدمه عشان توافق على طلبات التحويل.",
      pinNotSetMsg: "لسه معملتش رقم سري. اعمل واحد عشان تقدر توافق على طلبات التحويل.",
      accountPassword: "كلمة سر الحساب", newPin: "رقم سري جديد من 6 أرقام",
      updatePin: "تحديث الرقم السري", createPin: "إنشاء رقم سري",
      pinUpdated: "اتحدّث الرقم السري.", pinCreated: "اتعمل الرقم السري.",
      securityTitle: "الأمان", securityBody: "كلمات السر متشفّرة بـ bcrypt. الجلسات بتستخدم JWT موقّع. جلسات الواتساب بتنتهي تلقائيًا بعد 10 دقايق من عدم النشاط.",
      languageTitle: "لغة الواجهة", languageBody: "اختار اللغة اللي تفضّلها للموقع ولمحادثة الواتساب مع WTS Pay.",
      languageSaved: "تم حفظ اللغة.",
    },
    languagePicker: {
      title: "اختار لغتك", subtitle: "Choose your language", arabic: "العربي", english: "English",
    },
    tx: {
      sent: "مُرسَل", received: "مُستلَم", with: "مع", fee: "عمولة", ref: "مرجع",
      reportBtn: "🚩 بلّغ عن التحويل", reporting: "جاري الإبلاغ…", reported: "تم الإبلاغ — الفريق سيراجعه.",
      statusCompleted: "مكتمل", statusReversed: "مُعاد",
    },
    admin: {
      title: "لوحة الإدارة",
      tabs: { overview: "نظرة عامة", verifications: "طلبات التحقق", users: "المستخدمون", config: "الإعدادات", audit: "سجل المراجعة", transactions: "العمليات", fraud: "بلاغات النصب" },
      overview: { total: "إجمالي المستخدمين", active: "المستخدمون النشطون", pending: "قيد المراجعة", frozen: "حسابات مجمّدة", balance: "الرصيد التجريبي المتداول", transfers: "التحويلات", volume: "حجم التحويلات", referrals: "الإحالات (المكافأة)", rewards: "المكافآت المدفوعة", suspicious: "إشارات مشبوهة" },
      verif: { title: "طلبات التحقق", policy: "سياسة الوسائط: صور البطاقة والفيديو لا تُخزَّن في قاعدة بيانات WTS أبداً. افتح محادثة الواتساب لمراجعة الصور والفيديو مباشرة، ثم وافق أو ارفض. بيانات التسجيل موضّحة أدناه.", noName: "(بدون اسم)", pending: "قيد المراجعة", front: "صور البطاقة", video: "فيديو الوجه", openWa: "فتح محادثة الواتساب", approve: "✅ قبول", reject: "❌ رفض", rejectLabel: "سبب الرفض", rejectPlaceholder: "مثلاً: صورة البطاقة غير واضحة", confirmReject: "تأكيد الرفض", approved: "تم القبول — تم إنشاء المحفظة", rejected: "تم الرفض", noPending: "لا يوجد طلبات معلّقة.", gender: "الجنس", male: "ذكر", female: "أنثى", governorate: "المحافظة", nationalId: "الرقم القومي (آخر 6)" },
      users: { title: "بحث في المستخدمين", profile: "بيانات المستخدم", select: "اختار مستخدماً.", search: "بحث", searchPlaceholder: "رقم موبايل، اسم، كود WTS", balance: "الرصيد", verif: "التحقق", pin: "الرقم السري", pinSet: "مضبوط", pinNotSet: "غير مضبوط", locked: "🔒 مقفول", transfers: "التحويلات", enabled: "مفعّلة", disabled: "متوقفة", fraudReports: "بلاغات النصب", banned: "محظور نهائياً", frozenUntil: "مجمّد حتى", freeze: "تجميد الحساب", unfreeze: "رفع التجميد", resetPin: "إعادة تعيين PIN", resetFraud: "إعادة تعيين حالة النصب", disableTransfers: "إيقاف التحويلات", enableTransfers: "تفعيل التحويلات", adjust: "تعديل الرصيد يدوياً", addBalance: "+ إضافة رصيد", deductBalance: "- خصم رصيد", amount: "المبلغ (جنيه)", reason: "السبب (مُدقَّق وغير قابل للتعديل)", reasonPlaceholder: "تصحيح تقني", adding: "ستضيف", deducting: "ستخصم", current: "الحالي", newBal: "الجديد", reasonLabel: "السبب", review: "مراجعة التعديل", confirm: "تأكيد التعديل", cancel: "إلغاء", adjustNote: "كل تعديل يُسجَّل في دفتر الأستاذ مع إدخال MANUAL_ADJUSTMENT وسجل مراجعة.", recentTx: "آخر العمليات", fraudTitle: "بلاغات النصب على هذا المستخدم", noReports: "لا يوجد بلاغات.", report: "بلاغ #", filed: "تقدّم", resolved: "تمّت المراجعة", cleared: "تمّ المسح" },
      config: { title: "الإعدادات", feeTitle: "معادلة العمولة", feeLabel: "قسمة العمولة (العمولة = ceiling(المبلغ / القسمة))", saveFee: "حفظ العمولة", referralTitle: "مكافآت الإحالة", signupEnabled: "تسجيل مفعّل", referralEnabled: "إحالة مفعّلة", saveSignup: "حفظ التسجيل", saveReferral: "حفظ الإحالة", qualTitle: "شروط الإحالة والحملة", minTx: "أدنى تحويلات للتأهّل", maxReward: "أقصى مكافأة للمستخدم (جنيه)", saveQual: "حفظ الشروط", pinTitle: "أمان الرقم السري", maxAttempts: "أقصى محاولات خاطئة", lockMinutes: "مدة القفل (دقائق)", authTtl: "صلاحية التفويض (دقائق)", savePin: "حفظ سياسة PIN", limitsTitle: "حدود التحويل والصيانة", minTransfer: "أدنى تحويل (جنيه)", maxTransfer: "أقصى تحويل (جنيه)", initBalance: "الرصيد الأولي عند القبول (جنيه)", maintenance: "وضع الصيانة", saveLimits: "حفظ الحدود", saveInit: "حفظ الرصيد الأولي", saveMaint: "حفظ الصيانة" },
      audit: { title: "سجل المراجعة (للإضافة فقط)", noLogs: "لا يوجد سجلات.", when: "التوقيت", event: "الحدث", admin: "الأدمن", user: "المستخدم", ip: "IP" },
      txTab: { title: "كل العمليات", searchPlaceholder: "بحث بالمرجع (WTS-...) أو الرقم", search: "بحث", ref: "المرجع", date: "التاريخ", type: "النوع", from: "من", senderBal: "رصيد المُرسِل", to: "إلى", receiverBal: "رصيد المُستلِم", amount: "المبلغ", fee: "العمولة", status: "الحالة" },
      fraud: { title: "بلاغات النصب", desc: "اقرأ الأدلة مباشرة في الواتساب مع المُبلِّغ والمُبلَّغ عنه، ثم قرِّر هنا. البلاغ الثاني المؤكَّد → تجميد 30 يوم. البلاغ الثالث المؤكَّد → حظر دائم.", all: "الكل", reportOn: "بلاغ # على", transaction: "العملية", reportedBy: "أبلغ عنه", filed: "تقدّم", msgReporter: "💬 رسالة للمُبلِّغ", msgReported: "💬 رسالة للمُبلَّغ عنه", notePlaceholder: "ملاحظة الأدمن (اختياري)", confirmFraud: "تأكيد النصب", dismiss: "رفض البلاغ", totalReports: "إجمالي البلاغات المؤكَّدة", hide: "إخفاء البلاغ", show: "إظهار البلاغ" },
    },
    wallet: {
      title: "المحفظة", balanceLabel: "رصيد تجريبي — بدون قيمة نقدية",
      noValue: "الأرصدة التجريبية مالهاش قيمة نقدية ومتتسحبش.",
      sendBtn: "💸 تحويل فلوس", txBtn: "📜 كل العمليات",
      recentActivity: "آخر العمليات", noTx: "لسه مفيش عمليات. ابعت فلوس عشان تبدأ.",
    },
    send: {
      title: "تحويل فلوس", recipientLabel: "رقم الواتساب المستلم",
      amountLabel: "المبلغ (جنيه)",
      antiFraudLabel: "🛡️ حماية مكافحة الاحتيال",
      antiFraudDesc: "لو حسيت بحاجة غلط بعد التحويل، هتقدر تبلّغ عن العملية دي. مستحسن للتحويلات لحد مش بتعرفه كويس.",
      calcFeeBtn: "احسب العمولة",
      amountRow: "المبلغ", feeRow: "العمولة", totalRow: "الإجمالي المخصوم",
      feeNote: "العمولة = جنيه واحد لكل 1000 جنيه أو جزء منه. رصيد تجريبي فقط.",
      confirmBtn: "تأكيد — ابعت", sendingBtn: "جاري الإرسال…",
      doneMsg: "اتبعت", amountError: "اكتب مبلغ صحيح أكبر من 0.",
    },
    requests: {
      title: "طلبات تحويل", noPinNotice: "لسه معملتش رقم سري — محتاجه عشان تقبل طلبات التحويل. اعمله من صفحة",
      profileLink: "حسابي",
      incomingTab: "واردة", sentTab: "مبعوتة", newTab: "＋ طلب جديد",
      noPending: "مفيش طلبات واردة.", noSent: "لسه مبعتش أي طلب.",
      requests: "طالب", pinPlaceholder: "رقم سري 6 أرقام",
      confirmBtn: "تأكيد", cancelBtn: "إلغاء",
      acceptBtn: "قبول", rejectBtn: "رفض", cancelRequestBtn: "إلغاء الطلب",
      from: "من", reasonLabel: "السبب (اختياري)", reasonPlaceholder: "مثلاً: تقسيم فاتورة",
      sendBtn: "ابعت الطلب", requestSent: "اتبعت الطلب.", accepted: "تم القبول — اتبعتت الفلوس.",
      payerLabel: "اطلب من (رقم الواتساب)", amountLabel: "المبلغ (جنيه)",
    },
    transactions: {
      title: "العمليات", noTx: "لسه مفيش عمليات.", prev: "→ السابق", next: "التالي ←",
      pageOf: "صفحة",
    },
    referrals: {
      title: "الإحالات", codeLabel: "كود الإحالة بتاعك", earnLabel: "اكسب {amount} جنيه لكل إحالة مؤهلة",
      inviteLabel: "رابط دعوتك",
      qualifyNote: "الإحالة بتتأهل بس لما المدعوّ يتحقق (رقم موبايل فريد) ويعمل على الأقل {min} تحويل. الحد الأقصى للمكافأة {max} جنيه للمستخدم. لا مكافأة لحسابات مكررة.",
      statsTitle: "الإحصائيات", invited: "المدعوون", rewarded: "المكافأون",
      totalEarned: "إجمالي المكاسب", myReferrals: "إحالاتي", noReferrals: "لسه مفيش إحالات — شارك الكود!",
      joined: "انضم",
    },
  },
  en: {
    nav: {
      wallet: "Wallet", send: "Send", requests: "Requests", activity: "Activity",
      referrals: "Referrals", profile: "Profile", admin: "Admin", logout: "Log out",
    },
    common: {
      loading: "Loading…", save: "Save", cancel: "Cancel", egp: "EGP",
      demoBannerTitle: "Demo environment", demoBanner: "Balances are demo credits with no cash value. No real money, no withdrawals.",
    },
    landing: {
      tagline: "A demo digital wallet — send demo credits to friends, earn referral rewards.",
      walletTitle: "💼 Demo Wallet", walletBody: "Every account gets an internal demo balance. Transfers between WTS users are instant, with a transparent fee of 1 EGP per started 1,000 EGP.",
      referralTitle: "🎁 Referral Rewards", referralBody: "Invite friends with your personal code. Rewards are paid only after anti-abuse checks — when your invitee completes their first transfer.",
      whatsappTitle: "💬 WhatsApp-ready", whatsappBody: "The same wallet engine is reachable through the official WhatsApp Cloud API — balance checks, transfers and referrals by chat.",
      demoBanner: "Demo Balance — No Cash Value. Demo credits cannot be withdrawn, exchanged, or transferred outside WTS. No bank, InstaPay, or Fawry integration.",
      createAccount: "Create free demo account", haveAccount: "I have an account",
    },
    login: {
      subtitle: "Sign in to your demo wallet", phone: "WhatsApp number", password: "Password",
      submit: "Sign in", submitting: "Signing in…", noAccount: "No account?", registerLink: "Register",
    },
    profile: {
      title: "Profile", name: "Name", phone: "Phone", referralCode: "Referral code",
      status: "Account status", memberSince: "Member since",
      pinTitle: "Transaction PIN", pinSetMsg: "Your PIN is set. Use it to accept money requests.",
      pinNotSetMsg: "You don't have a PIN yet. Set one to accept money requests.",
      accountPassword: "Account password", newPin: "New 6-digit PIN",
      updatePin: "Update PIN", createPin: "Create PIN",
      pinUpdated: "PIN updated.", pinCreated: "PIN created.",
      securityTitle: "Security", securityBody: "Passwords are hashed with bcrypt. Sessions use signed JWTs. WhatsApp sessions expire automatically after 10 minutes of inactivity.",
      languageTitle: "Interface language", languageBody: "Choose your preferred language for the website and for WTS Pay on WhatsApp.",
      languageSaved: "Language saved.",
    },
    languagePicker: {
      title: "Choose your language", subtitle: "اختار لغتك", arabic: "العربي", english: "English",
    },
    tx: {
      sent: "Sent", received: "Received", with: "with", fee: "fee", ref: "Ref",
      reportBtn: "🚩 Report this transfer", reporting: "Reporting…", reported: "Report submitted — our team will review it.",
      statusCompleted: "COMPLETED", statusReversed: "REVERSED",
    },
    admin: {
      title: "Admin Dashboard",
      tabs: { overview: "Overview", verifications: "Verifications", users: "Users", config: "Config", audit: "Audit", transactions: "Transactions", fraud: "Fraud Reports" },
      overview: { total: "Total users", active: "Active users", pending: "Pending verification", frozen: "Frozen accounts", balance: "Demo balance in circulation", transfers: "Transfers", volume: "Transfer volume", referrals: "Referrals (rewarded)", rewards: "Rewards paid", suspicious: "Suspicious flags" },
      verif: { title: "Pending Verification", policy: "Media policy: ID photos and face videos are never stored in WTS databases. Open the WhatsApp conversation to review ID photos and the face video directly, then approve or reject. Registration details are shown below.", noName: "(no name)", pending: "Pending Review", front: "ID photos", video: "Face video", openWa: "Open WhatsApp Conversation", approve: "✅ Approve", reject: "❌ Reject", rejectLabel: "Rejection reason", rejectPlaceholder: "e.g. ID photo unclear", confirmReject: "Confirm Rejection", approved: "Approved - wallet created", rejected: "Rejected", noPending: "No pending registrations.", gender: "Gender", male: "Male", female: "Female", governorate: "Governorate", nationalId: "National ID (last 6)" },
      users: { title: "Search users", profile: "User profile", select: "Select a user.", search: "Search", searchPlaceholder: "phone, name, WTS ID or code", balance: "Balance", verif: "Verification", pin: "PIN", pinSet: "Set", pinNotSet: "Not set", locked: "🔒 locked", transfers: "Transfers", enabled: "Enabled", disabled: "Disabled", fraudReports: "Fraud reports", banned: "· BANNED", frozenUntil: "frozen until", freeze: "Freeze Account", unfreeze: "Unfreeze Account", resetPin: "Reset PIN", resetFraud: "Reset fraud status", disableTransfers: "Disable Transfers", enableTransfers: "Enable Transfers", adjust: "Manual balance adjustment", addBalance: "+ Add Balance", deductBalance: "- Deduct Balance", amount: "Amount (EGP)", reason: "Reason (audited, immutable)", reasonPlaceholder: "Technical correction", adding: "adding", deducting: "deducting", current: "Current", newBal: "New", reasonLabel: "Reason", review: "Review Adjustment", confirm: "Confirm Adjustment", cancel: "Cancel", adjustNote: "Every adjustment creates a MANUAL_ADJUSTMENT ledger entry and an audit record.", recentTx: "Recent transactions", fraudTitle: "Fraud reports on this user", noReports: "No reports.", report: "Report #", filed: "Filed", resolved: "resolved", cleared: "cleared" },
      config: { title: "Configuration", feeTitle: "Fee formula", feeLabel: "Fee divisor (fee = ceiling(amount / divisor))", saveFee: "Save fee", referralTitle: "Referral rewards", signupEnabled: "signup enabled", referralEnabled: "referral enabled", saveSignup: "Save signup", saveReferral: "Save referral", qualTitle: "Referral qualification & campaign", minTx: "Min transactions to qualify", maxReward: "Max reward per user (EGP)", saveQual: "Save qualification rules", pinTitle: "PIN security", maxAttempts: "Max failed PIN attempts", lockMinutes: "Lock duration (minutes)", authTtl: "Authorization expiry (minutes)", savePin: "Save PIN policy", limitsTitle: "Transaction limits & maintenance", minTransfer: "Min transfer (EGP)", maxTransfer: "Max transfer (EGP)", initBalance: "Initial balance at approval (EGP)", maintenance: "maintenance mode", saveLimits: "Save limits", saveInit: "Save initial balance", saveMaint: "Save maintenance" },
      audit: { title: "Audit log (append-only)", noLogs: "No audit entries.", when: "When", event: "Event", admin: "Admin", user: "User", ip: "IP" },
      txTab: { title: "All transactions", searchPlaceholder: "Search by reference (WTS-...) or phone", search: "Search", ref: "Reference", date: "Date", type: "Type", from: "From", senderBal: "Sender bal.", to: "To", receiverBal: "Receiver bal.", amount: "Amount", fee: "Fee", status: "Status" },
      fraud: { title: "Fraud reports", desc: "Read the evidence directly in WhatsApp with both the reporter and the reported user, then decide here. Report #2 confirmed → 30-day freeze. Report #3 confirmed → permanent ban.", all: "All", reportOn: "Report # on", transaction: "Transaction", reportedBy: "Reported by", filed: "Filed", msgReporter: "💬 Message reporter", msgReported: "💬 Message reported user", notePlaceholder: "Admin note (optional)", confirmFraud: "Confirm fraud", dismiss: "Dismiss", totalReports: "Total confirmed reports", hide: "Hide report", show: "Show report" },
    },
    wallet: {
      title: "Wallet", balanceLabel: "Demo Balance — No Cash Value",
      noValue: "Demo credits have no cash value and cannot be withdrawn or exchanged for real money.",
      sendBtn: "💸 Send money", txBtn: "📜 View all transactions",
      recentActivity: "Recent activity", noTx: "No transactions yet. Send money to get started.",
    },
    send: {
      title: "Send Money", recipientLabel: "Recipient phone number",
      amountLabel: "Amount (EGP)",
      antiFraudLabel: "🛡️ Anti-Fraud protection",
      antiFraudDesc: "If something feels wrong after sending, you'll be able to report this transfer. Recommended for payments to people you don't know well.",
      calcFeeBtn: "Calculate fee",
      amountRow: "Amount", feeRow: "Fee", totalRow: "Total debit",
      feeNote: "Fee = 1 EGP per started 1,000 EGP. Demo credits only — no cash value.",
      confirmBtn: "Confirm — send", sendingBtn: "Sending…",
      doneMsg: "Sent", amountError: "Enter a whole amount greater than 0.",
    },
    requests: {
      title: "Money Requests", noPinNotice: "You haven't set a transaction PIN yet — you'll need one to accept money requests. Set it from your",
      profileLink: "Profile",
      incomingTab: "Incoming", sentTab: "Sent", newTab: "+ New request",
      noPending: "No pending requests.", noSent: "You haven't requested any money yet.",
      requests: "requests", pinPlaceholder: "6-digit PIN",
      confirmBtn: "Confirm", cancelBtn: "Cancel",
      acceptBtn: "Accept", rejectBtn: "Reject", cancelRequestBtn: "Cancel request",
      from: "From", reasonLabel: "Reason (optional)", reasonPlaceholder: "e.g. Dinner split",
      sendBtn: "Send request", requestSent: "Request sent.", accepted: "Accepted — money sent.",
      payerLabel: "Request money from (WhatsApp number)", amountLabel: "Amount (EGP)",
    },
    transactions: {
      title: "Transactions", noTx: "No transactions yet.", prev: "← Prev", next: "Next →",
      pageOf: "Page",
    },
    referrals: {
      title: "Referrals", codeLabel: "Your referral code", earnLabel: "Earn {amount} EGP per qualified referral",
      inviteLabel: "Your invite link",
      qualifyNote: "A referral qualifies only after your invitee verifies their account (unique phone), stays active, and completes at least {min} transfer(s). Rewards are capped at {max} EGP per user. No reward for duplicate accounts.",
      statsTitle: "Stats", invited: "Invited", rewarded: "Rewarded",
      totalEarned: "Total earned", myReferrals: "My referrals", noReferrals: "No referrals yet — share your code!",
      joined: "joined",
    },
  },
};
