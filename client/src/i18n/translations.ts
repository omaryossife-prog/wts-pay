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
