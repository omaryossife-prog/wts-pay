// ---------------------------------------------------------------------------
// Website translations (Arabic / English). Flat dictionary, dot-free keys
// grouped by page/section as plain objects. Add new keys here and read them
// with useLang()'s t() helper — see LanguageContext.tsx.
// ---------------------------------------------------------------------------
export type Lang = "ar" | "en";

export const translations = {
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
  },
} as const;

export type TranslationShape = typeof translations["ar"];
