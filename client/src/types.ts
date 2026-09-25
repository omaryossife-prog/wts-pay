export interface User {
  id: string;
  phone: string;
  username: string;
  referralCode: string;
  demoBalance?: number;
  role?: "USER" | "ADMIN";
  status?: string;
  createdAt?: string;
  wtsId?: string | null;
  walletId?: string | null;
  fullName?: string | null;
  verificationStatus?: string;
  transfersEnabled?: boolean;
  pinSet?: boolean;
}

export interface Transaction {
  id: string;
  senderId: string | null;
  receiverId: string | null;
  amount: number;
  fee: number;
  totalDebit: number;
  type: string;
  status: string;
  description: string | null;
  balanceBefore?: number | null;
  balanceAfter?: number | null;
  createdAt: string;
  sender?: { phone: string; username: string };
  receiver?: { phone: string; username: string };
}

export interface Referral {
  id: string;
  status: string;
  createdAt: string;
  referred?: { phone: string; username: string; createdAt: string };
}

export interface TransferRequest {
  id: string;
  requesterId: string;
  payerId: string;
  amount: number;
  description: string | null;
  status: "PENDING" | "ACCEPTED" | "REJECTED" | "CANCELED" | "EXPIRED";
  createdAt: string;
  respondedAt: string | null;
  transactionId: string | null;
  requester?: { phone: string; username: string; wtsId: string | null };
  payer?: { phone: string; username: string; wtsId: string | null };
}

export interface PendingVerification {
  id: string;
  fullName: string | null;
  whatsappPhone: string | null;
  waId: string | null;
  wtsId: string | null;
  idSubmitted: boolean;
  idReceivedAt: string | null;
  faceVideoSubmitted: boolean;
  faceVideoReceivedAt: string | null;
  createdAt: string;
  whatsappConversationUrl: string | null;
}

export interface AdminStats {
  totalUsers: number;
  activeUsers: number;
  frozenUsers: number;
  pendingReview: number;
  demoBalanceInCirculation: number;
  transferVolume: number;
  transfersCount: number;
  totalReferrals: number;
  rewardedReferrals: number;
  totalRewardsPaid: number;
  rewardsCount: number;
  suspiciousAccounts: number;
}

export interface ConfigBundle {
  fee: { mode: string; divisor: number };
  signupReward: { amount: number; enabled: boolean };
  referralReward: { amount: number; enabled: boolean };
  referral: {
    requiredReferrals: number;
    minTransactions: number;
    maxRewardPerUser: number;
    campaignStart: string | null;
    campaignEnd: string | null;
    campaignEnabled: boolean;
  };
  security: { pinMaxAttempts: number; pinLockMinutes: number; authorizationTtlMinutes: number };
  limits: { minTransfer: number; maxTransfer: number };
  maintenanceMode: { enabled: boolean; message: string };
  approval: { initialBalance: number };
}
