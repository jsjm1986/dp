import axios, { AxiosError } from 'axios';
import { showToast } from 'vant';
import { useUserStore } from '../stores/user';
import router from '../router';

declare module 'axios' {
  interface AxiosInstance {
    request<T = unknown>(config: AxiosRequestConfig): Promise<T>;
    get<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T>;
    delete<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T>;
    head<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T>;
    post<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>;
    put<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>;
    patch<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>;
  }
}

export const http = axios.create({ baseURL: '/api', timeout: 15000 });

http.interceptors.request.use((config) => {
  const store = useUserStore();
  if (store.token) config.headers.Authorization = `Bearer ${store.token}`;
  return config;
});

http.interceptors.response.use(
  (res) => res.data,
  (err: AxiosError<{ message?: string | string[] }>) => {
    const status = err.response?.status;
    const msg = err.response?.data?.message;
    if (status === 401) {
      const store = useUserStore();
      store.logout();
      router.push({ path: '/login', query: { redirect: router.currentRoute.value.fullPath } });
    }
    showToast(Array.isArray(msg) ? msg[0] : msg || '网络错误，请重试');
    return Promise.reject(err);
  },
);

/* ---------- types ---------- */
export interface PartnerCard {
  id: string;
  nickname: string;
  avatar: string | null;
  gender: string | null;
  city: string;
  district: string | null;
  tags: string[];
  status: string;
  verified: boolean;
  recommended?: boolean;
  serviceCount: number;
  rating: number;
  cover: string | null;
  age: number | null;
  followerCount: number;
  distance: number | null;
  followed: boolean;
}

export interface PartnerDetail extends Omit<PartnerCard, 'cover' | 'distance'> {
  userId: string;
  photos: string[];
  voiceIntro: string | null;
  bio: string | null;
  height: number | null;
  weight: number | null;
  constellation: string | null;
  education: string | null;
  viewCount: number;
  wechatId: string | null;
  services: Array<{ id: string; name: string; desc: string | null; price: number; unit: string; miniNum: number }>;
  reviews: Array<{ id: string; rating: number; content: string | null; reply: string | null; createdAt: string; user: { nickname: string; avatar: string | null } }>;
  reviewCount: number;
  dynamics: Array<{ id: string; content: string; images: string[]; likeCount: number; commentCount: number; createdAt: string }>;
}

export interface Order {
  id: string;
  orderNo: string;
  partnerId: string;
  partner: { id: string; userId: string; nickname: string; avatar: string | null; city: string };
  items: Array<{ id: string; serviceId: string; name: string; price: number; unit: string; num: number; subtotal: number }>;
  appointAt: string;
  address: string | null;
  remark: string | null;
  totalAmount: number;
  discount: number;
  payMethod: string | null;
  parentId: string | null;
  status: string;
  cancelReason: string | null;
  urgedAt: string | null;
  paidAt: string | null;
  acceptedAt: string | null;
  finishedAt: string | null;
  reviewed: boolean;
  createdAt: string;
  children?: Array<{ id: string; orderNo: string; status: string; totalAmount: number; items: Array<{ name: string; num: number }>; createdAt: string }>;
}

export interface BalanceLogItem {
  id: string;
  type: 'recharge' | 'card' | 'pay' | 'refund' | 'commission' | 'adjust' | 'income' | 'withdraw' | 'withdraw_refund';
  amount: number;
  remark: string | null;
  createdAt: string;
}

export interface Dynamic {
  id: string;
  content: string;
  images: string[];
  city: string | null;
  likeCount: number;
  commentCount: number;
  createdAt: string;
  liked: boolean;
  author: { nickname: string; avatar: string | null; partnerId: string | null };
}

export interface CommentRow {
  id: string;
  content: string;
  createdAt: string;
  user: { nickname: string; avatar: string | null };
}

export interface PartnerApplyPayload {
  city: string;
  district?: string;
  age?: number;
  bio?: string;
  tags?: string[];
  photos?: string[];
  services: Array<{ name: string; desc?: string; price: number; unit: string; miniNum: number }>;
  realName?: string;
  idCard?: string;
}

export interface PartnerProfile extends PartnerApplyPayload {
  id: string;
  status: string;
  auditStatus: string;
  rating: number;
  serviceCount: number;
  viewCount: number;
}

export interface PartnerStats {
  pendingAccept: number;
  todayOrders: number;
  doneCount: number;
  doneAmount: number;
  followers: number;
  rating: number;
  status: string;
  auditStatus: string;
}

export interface AdminReport {
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  detail: string | null;
  status: string;
  remark: string | null;
  createdAt: string;
  reporter: { id: string; nickname: string; mobile: string } | null;
}

export interface NoticeItem {
  id: string;
  type: 'order' | 'audit' | 'wallet' | 'commission' | 'system';
  title: string;
  content: string;
  refId: string | null;
  read: boolean;
  createdAt: string;
}

export interface UserProfile {
  id: string;
  mobile: string;
  nickname: string;
  avatar: string | null;
  gender: string | null;
  city: string | null;
  balance: number;
  role: string;
  partnerId: string | null;
}

/* ---------- api ---------- */
export const api = {
  sendSms: (mobile: string) => http.post<{ devCode: string }>('/auth/sms/send', { mobile }),
  login: (mobile: string, code: string, inviteCode?: string) =>
    http.post<{ token: string; user: UserProfile }>('/auth/login', { mobile, code, inviteCode }),
  profile: () => http.get<UserProfile>('/user/profile'),
  updateProfile: (data: Partial<UserProfile>) => http.put<UserProfile>('/user/profile', data),
  myFollows: () => http.get<PartnerCard[]>('/user/follows'),

  home: () =>
    http.get<{ banners: Array<{ id: string; image: string; link: string | null }>; recommend: PartnerCard[]; newest: PartnerCard[]; cities: string[]; announcement: { id: string; title: string; content: string } | null }>('/home'),
  partners: (params: Record<string, string | number>) =>
    http.get<{ total: number; page: number; pageSize: number; items: PartnerCard[] }>('/partners', { params }),
  partner: (id: string) => http.get<PartnerDetail>(`/partners/${id}`),
  partnerReviews: (id: string, page = 1) => http.get<{ total: number; items: PartnerDetail['reviews'] }>(`/partners/${id}/reviews`, { params: { page } }),
  follow: (id: string) => http.post<{ followed: boolean }>(`/partners/${id}/follow`),
  unfollow: (id: string) => http.delete<{ followed: boolean }>(`/partners/${id}/follow`),

  createOrder: (data: { partnerId: string; items: Array<{ serviceId: string; num: number }>; appointAt: string; address?: string; remark?: string; userCouponId?: string }) =>
    http.post<Order>('/orders', data),
  orders: (status?: string, page = 1) =>
    http.get<{ total: number; items: Order[] }>('/orders', { params: { status, page } }),
  order: (id: string) => http.get<Order>(`/orders/${id}`),
  payOrder: (id: string, method: 'balance' | 'mock' = 'mock') => http.post<Order>(`/orders/${id}/pay`, { method }),
  cancelOrder: (id: string, reason?: string) => http.post<Order>(`/orders/${id}/cancel`, { reason }),
  urgeOrder: (id: string) => http.post(`/orders/${id}/urge`),
  extendOrder: (id: string, items: Array<{ serviceId: string; num: number }>) =>
    http.post<Order>(`/orders/${id}/extend`, { items }),
  reviewOrder: (id: string, rating: number, content?: string) => http.post(`/orders/${id}/review`, { rating, content }),

  /* 玩伴端 */
  partnerApply: (data: PartnerApplyPayload) => http.post<{ id: string }>('/partner/apply', data),
  partnerProfile: () => http.get<PartnerProfile>('/partner/profile'),
  updatePartnerProfile: (data: PartnerApplyPayload) => http.put<PartnerProfile>('/partner/profile', data),
  setPartnerStatus: (status: 'available' | 'rest') => http.put<{ status: string }>('/partner/status', { status }),
  partnerStats: () => http.get<PartnerStats>('/partner/stats'),
  partnerOrders: (status?: string) =>
    http.get<Array<Order & { customer: { id: string; nickname: string; avatar: string | null; mobile: string } }>>('/partner/orders', { params: { status } }),
  partnerOrderAct: (id: string, action: 'accept' | 'reject' | 'start' | 'finish', reason?: string) =>
    http.post<Order>(`/partner/orders/${id}/${action}`, { reason }),
  partnerWallet: () =>
    http.get<{
      balance: number;
      withdrawals: Array<{ id: string; amount: number; account: string | null; status: string; remark: string | null; createdAt: string }>;
      logs: BalanceLogItem[];
    }>('/partner/wallet'),
  partnerWithdraw: (amount: number, account?: string) => http.post<{ id: string; status: string }>('/partner/withdraw', { amount, account }),
  partnerBusy: (id: string, date: string) => http.get<{ allDay: boolean; hours: number[] }>(`/partners/${id}/busy`, { params: { date } }),
  partnerOffDates: () => http.get<{ dates: string[] }>('/partner/off-dates'),
  addOffDate: (date: string) => http.post('/partner/off-dates', { date }),
  removeOffDate: (date: string) => http.delete(`/partner/off-dates/${date}`),
  userWallet: (page = 1) =>
    http.get<{ balance: number; total: number; items: BalanceLogItem[] }>('/user/wallet', { params: { page } }),

  /* 通知 & 举报 */
  notices: (page = 1) =>
    http.get<{ total: number; unread: number; page: number; pageSize: number; items: NoticeItem[] }>('/user/notices', { params: { page } }),
  noticeUnread: () => http.get<{ count: number }>('/user/notices/unread'),
  readNotices: (id?: string) => http.post('/user/notices/read', id ? { id } : {}),
  report: (data: { targetType: 'user' | 'partner' | 'dynamic' | 'comment' | 'order'; targetId: string; reason: string; detail?: string }) =>
    http.post('/user/reports', data),

  dynamics: (page = 1, tab?: string) => http.get<{ total: number; items: Dynamic[] }>('/dynamics', { params: { page, tab } }),
  createDynamic: (data: { content: string; images?: string[]; city?: string }) => http.post<{ id: string }>('/dynamics', data),
  likeDynamic: (id: string) => http.post<{ liked: boolean; likeCount: number }>(`/dynamics/${id}/like`),
  unlikeDynamic: (id: string) => http.delete<{ liked: boolean; likeCount: number }>(`/dynamics/${id}/like`),
  comments: (id: string) => http.get<CommentRow[]>(`/dynamics/${id}/comments`),
  comment: (id: string, content: string) =>
    http.post<CommentRow & { commentCount: number }>(`/dynamics/${id}/comments`, { content }),
  deleteComment: (id: string) => http.delete(`/dynamics/comments/${id}`),
  blockUser: (id: string) => http.post<{ blocked: boolean }>(`/user/block/${id}`),
  unblockUser: (id: string) => http.delete<{ blocked: boolean }>(`/user/block/${id}`),
  myBlocks: () => http.get<Array<{ id: string; nickname: string; avatar: string | null }>>('/user/blocks'),
  partnerMyReviews: () =>
    http.get<Array<{ id: string; rating: number; content: string | null; reply: string | null; replyAt: string | null; createdAt: string; user: { nickname: string; avatar: string | null } }>>('/partner/reviews'),
  replyReview: (id: string, content: string) => http.post(`/partner/reviews/${id}/reply`, { content }),

  myDynamics: () =>
    http.get<Array<{ id: string; content: string; images: string[]; city: string | null; likeCount: number; commentCount: number; createdAt: string }>>('/dynamics/mine'),
  deleteDynamic: (id: string) => http.delete(`/dynamics/${id}`),

  /* 聊天 */
  conversations: () =>
    http.get<Array<{ peer: { id: string; nickname: string; avatar: string | null }; lastMessage: { content: string; createdAt: string; fromMe: boolean }; unread: number }>>('/chat/conversations'),
  chatMessages: (peerId: string, before?: string) =>
    http.get<{ peer: { id: string; nickname: string; avatar: string | null }; items: Array<{ id: string; senderId: string; content: string; createdAt: string }> }>('/chat/messages', { params: { peerId, before } }),
  sendMessage: (data: { peerId: string; content: string; orderId?: string }) =>
    http.post<{ id: string }>('/chat/send', data),
  unreadCount: () => http.get<{ count: number }>('/chat/unread'),

  /* 优惠券 & 钱包 */
  claimableCoupons: () =>
    http.get<Array<{ id: string; title: string; amount: number; minSpend: number; expiresAt: string; left: number; claimed: boolean }>>('/coupons/claimable'),
  claimCoupon: (id: string) => http.post<{ id: string }>(`/coupons/${id}/claim`),
  myCoupons: (amount?: number) =>
    http.get<Array<{ id: string; title: string; amount: number; minSpend: number; expiresAt: string; used: boolean; expired: boolean; usable: boolean }>>('/coupons/mine', { params: { amount } }),
  recharge: (amount: number) => http.post<{ balance: number }>('/user/recharge', { amount }),
  service: () => http.get<{ id: string; nickname: string; avatar: string | null }>('/user/service'),

  /* 管理后台 */
  adminDashboard: () =>
    http.get<{ userCount: number; partnerApproved: number; partnerPending: number; orderCount: number; todayOrders: number; doneCount: number; gmv: number; dynamicCount: number; messageCount: number; pendingAccept: number; serving: number; pendingWithdrawals: number; pendingWithdrawalAmount: number; commissionTotal: number; commissionCount: number; couponClaimed: number; couponUsed: number; reviewCount: number; disabledUsers: number }>('/admin/dashboard'),
  adminUsers: (page = 1, keyword?: string) =>
    http.get<{ total: number; items: Array<{ id: string; mobile: string; nickname: string; avatar: string | null; city: string | null; role: string; disabled: boolean; balance: number; partnerId: string | null; auditStatus: string | null; orderCount: number; createdAt: string }> }>('/admin/users', { params: { page, keyword } }),
  adminPartners: (auditStatus = 'pending', page = 1) =>
    http.get<{ total: number; items: Array<{ id: string; userId: string; nickname: string; avatar: string | null; mobile: string; city: string; district: string | null; bio: string | null; tags: string[]; photos: string[]; auditStatus: string; status: string; verified: boolean; recommended: boolean; rating: number; serviceCount: number; realName: string | null; idCard: string | null; age: number | null; createdAt: string; services: Array<{ name: string; price: number; unit: string; miniNum: number }> }> }>('/admin/partners', { params: { auditStatus, page } }),
  adminApprove: (id: string) => http.post(`/admin/partners/${id}/approve`),
  adminReject: (id: string, reason?: string) => http.post(`/admin/partners/${id}/reject`, { reason }),
  adminVerify: (id: string, verified: boolean) => http.put(`/admin/partners/${id}/verify`, { verified }),
  adminOrders: (page = 1, status?: string, keyword?: string) =>
    http.get<{ total: number; items: Array<{ id: string; orderNo: string; customer: string; customerMobile: string; partner: string; city: string; totalAmount: number; status: string; createdAt: string }> }>('/admin/orders', { params: { page, status, keyword } }),
  adminCancelOrder: (id: string, reason?: string) => http.post(`/admin/orders/${id}/cancel`, { reason }),
  adminReviews: (page = 1) =>
    http.get<{ total: number; items: Array<{ id: string; rating: number; content: string | null; reply: string | null; createdAt: string; author: string; avatar: string | null; partner: string; orderNo: string }> }>('/admin/reviews', { params: { page } }),
  adminDeleteReview: (id: string) => http.delete(`/admin/reviews/${id}`),
  adminRecommend: (id: string, recommended: boolean) => http.put(`/admin/partners/${id}/recommend`, { recommended }),
  adminPartnerStatus: (id: string, status: string) => http.put(`/admin/partners/${id}/status`, { status }),
  adminSetRole: (id: string, role: string) => http.put(`/admin/users/${id}/role`, { role }),
  adminAdjustBalance: (id: string, amount: number, remark?: string) =>
    http.post<{ balance: number }>(`/admin/users/${id}/balance`, { amount, remark }),
  adminUserDetail: (id: string) =>
    http.get<{
      id: string; mobile: string; nickname: string; avatar: string | null; gender: string | null; city: string | null;
      role: string; disabled: boolean; balance: number; inviteCode: string | null; inviterId: string | null; createdAt: string;
      partner: { id: string; auditStatus: string; status: string; serviceCount: number; rating: number; balance: number } | null;
      orderCount: number;
      recentOrders: Array<{ id: string; orderNo: string; totalAmount: number; status: string; createdAt: string }>;
      commissions: Array<{ id: string; amount: number; rate: number; createdAt: string }>;
    }>(`/admin/users/${id}`),
  adminDynamics: (page = 1) =>
    http.get<{ total: number; items: Array<{ id: string; content: string; images: string[]; city: string | null; likeCount: number; commentCount: number; createdAt: string; author: string; avatar: string | null }> }>('/admin/dynamics', { params: { page } }),
  adminDeleteDynamic: (id: string) => http.delete(`/admin/dynamics/${id}`),
  adminBanners: () => http.get<Array<{ id: string; image: string; link: string | null; sort: number }>>('/admin/banners'),
  adminSaveBanner: (data: { id?: string; image: string; link?: string; sort?: number }) =>
    data.id ? http.put(`/admin/banners/${data.id}`, data) : http.post('/admin/banners', data),
  adminDeleteBanner: (id: string) => http.delete(`/admin/banners/${id}`),
  adminWithdrawals: (status = 'pending') =>
    http.get<Array<{ id: string; amount: number; account: string | null; status: string; remark: string | null; createdAt: string; handledAt: string | null; partner: { id: string; nickname: string; avatar: string | null; mobile: string } }>>('/admin/withdrawals', { params: { status } }),
  adminApproveWithdrawal: (id: string) => http.post(`/admin/withdrawals/${id}/approve`),
  adminRejectWithdrawal: (id: string, remark?: string) => http.post(`/admin/withdrawals/${id}/reject`, { remark }),
  adminSettings: () =>
    http.get<{ commissionRate: number; sensitiveWords: string[]; commissionTotal: number; commissionCount: number }>('/admin/settings'),
  adminUpdateSettings: (data: { commissionRate?: number; sensitiveWords?: string[] }) =>
    http.put<{ commissionRate: number; sensitiveWords: string[] }>('/admin/settings', data),
  adminCommissions: (page = 1) =>
    http.get<{ total: number; items: Array<{ id: string; inviter: string; inviterMobile: string; invitee: string; orderNo: string; amount: number; rate: number; createdAt: string }> }>('/admin/commissions', { params: { page } }),
  adminCoupons: () =>
    http.get<Array<{ id: string; title: string; amount: number; minSpend: number; total: number; claimed: number; expiresAt: string; createdAt: string }>>('/admin/coupons'),
  adminCreateCoupon: (data: { title: string; amount: number; minSpend?: number; total: number; days: number }) =>
    http.post('/admin/coupons', data),
  adminDeleteCoupon: (id: string) => http.delete(`/admin/coupons/${id}`),
  adminToggleUser: (id: string, disabled: boolean) => http.put(`/admin/users/${id}/disabled`, { disabled }),
  adminRechargeCards: (status?: string, page = 1) =>
    http.get<{ total: number; unusedCount: number; items: Array<{ id: string; code: string; amount: number; batch: string | null; used: boolean; usedBy: string | null; usedAt: string | null; createdAt: string }> }>('/admin/recharge-cards', { params: { status, page } }),
  adminGenCards: (amount: number, count: number) =>
    http.post<{ batch: string; count: number; codes: string[] }>('/admin/recharge-cards', { amount, count }),
  adminDeleteCard: (id: string) => http.delete(`/admin/recharge-cards/${id}`),
  adminReports: (page = 1, status?: string) =>
    http.get<{ total: number; page: number; items: AdminReport[] }>('/admin/reports', { params: { page, status } }),
  adminHandleReport: (id: string, action: 'processed' | 'rejected', remark?: string) =>
    http.post(`/admin/reports/${id}/handle`, { action, remark }),
  adminAnnouncements: () =>
    http.get<Array<{ id: string; title: string; content: string; enabled: boolean; createdAt: string }>>('/admin/announcements'),
  adminCreateAnnouncement: (title: string, content: string) => http.post('/admin/announcements', { title, content }),
  adminUpdateAnnouncement: (id: string, data: { enabled?: boolean; title?: string; content?: string }) =>
    http.put(`/admin/announcements/${id}`, data),
  adminDeleteAnnouncement: (id: string) => http.delete(`/admin/announcements/${id}`),
  redeemCard: (code: string) => http.post<{ balance: number; amount: number }>('/user/redeem', { code }),

  bindInviter: (code: string) => http.post<{ bound: boolean; inviter: string }>('/user/bind-inviter', { code }),
  referral: () =>
    http.get<{
      inviteCode: string;
      inviterNickname: string | null;
      rate: number;
      inviteeCount: number;
      totalCommission: number;
      invitees: Array<{ id: string; nickname: string; avatar: string | null; createdAt: string }>;
      commissions: Array<{ id: string; amount: number; rate: number; createdAt: string; inviteeNickname: string; orderNo: string; orderAmount: number }>;
    }>('/user/referral'),

  upload: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return http.post<{ url: string }>('/uploads', fd);
  },
};
