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
  reviews: Array<{ id: string; rating: number; content: string | null; createdAt: string; user: { nickname: string; avatar: string | null } }>;
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
  status: string;
  cancelReason: string | null;
  urgedAt: string | null;
  paidAt: string | null;
  reviewed: boolean;
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
  bio?: string;
  tags?: string[];
  photos?: string[];
  services: Array<{ name: string; desc?: string; price: number; unit: string; miniNum: number }>;
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
  login: (mobile: string, code: string) =>
    http.post<{ token: string; user: UserProfile }>('/auth/login', { mobile, code }),
  profile: () => http.get<UserProfile>('/user/profile'),
  updateProfile: (data: Partial<UserProfile>) => http.put<UserProfile>('/user/profile', data),
  myFollows: () => http.get<PartnerCard[]>('/user/follows'),

  home: () =>
    http.get<{ banners: Array<{ id: string; image: string; link: string | null }>; recommend: PartnerCard[]; newest: PartnerCard[]; cities: string[] }>('/home'),
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
  reviewOrder: (id: string, rating: number, content?: string) => http.post(`/orders/${id}/review`, { rating, content }),

  /* 玩伴端 */
  partnerApply: (data: PartnerApplyPayload) => http.post<{ id: string }>('/partner/apply', data),
  partnerProfile: () => http.get<PartnerProfile>('/partner/profile'),
  updatePartnerProfile: (data: PartnerApplyPayload) => http.put<PartnerProfile>('/partner/profile', data),
  setPartnerStatus: (status: 'available' | 'rest') => http.put<{ status: string }>('/partner/status', { status }),
  partnerStats: () => http.get<PartnerStats>('/partner/stats'),
  partnerOrders: (status?: string) =>
    http.get<Array<Order & { customer: { id: string; nickname: string; avatar: string | null; mobile: string } }>>('/partner/orders', { params: { status } }),
  partnerOrderAct: (id: string, action: 'accept' | 'reject' | 'start' | 'finish') =>
    http.post<Order>(`/partner/orders/${id}/${action}`),

  dynamics: (page = 1) => http.get<{ total: number; items: Dynamic[] }>('/dynamics', { params: { page } }),
  createDynamic: (data: { content: string; images?: string[]; city?: string }) => http.post<{ id: string }>('/dynamics', data),
  likeDynamic: (id: string) => http.post<{ liked: boolean; likeCount: number }>(`/dynamics/${id}/like`),
  unlikeDynamic: (id: string) => http.delete<{ liked: boolean; likeCount: number }>(`/dynamics/${id}/like`),
  comments: (id: string) => http.get<CommentRow[]>(`/dynamics/${id}/comments`),
  comment: (id: string, content: string) =>
    http.post<CommentRow & { commentCount: number }>(`/dynamics/${id}/comments`, { content }),

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
    http.get<{ userCount: number; partnerApproved: number; partnerPending: number; orderCount: number; todayOrders: number; doneCount: number; gmv: number; dynamicCount: number; messageCount: number; pendingAccept: number; serving: number }>('/admin/dashboard'),
  adminUsers: (page = 1, keyword?: string) =>
    http.get<{ total: number; items: Array<{ id: string; mobile: string; nickname: string; avatar: string | null; city: string | null; role: string; balance: number; partnerId: string | null; auditStatus: string | null; orderCount: number; createdAt: string }> }>('/admin/users', { params: { page, keyword } }),
  adminPartners: (auditStatus = 'pending', page = 1) =>
    http.get<{ total: number; items: Array<{ id: string; userId: string; nickname: string; avatar: string | null; mobile: string; city: string; district: string | null; bio: string | null; tags: string[]; photos: string[]; auditStatus: string; status: string; verified: boolean; rating: number; serviceCount: number; createdAt: string; services: Array<{ name: string; price: number; unit: string; miniNum: number }> }> }>('/admin/partners', { params: { auditStatus, page } }),
  adminApprove: (id: string) => http.post(`/admin/partners/${id}/approve`),
  adminReject: (id: string) => http.post(`/admin/partners/${id}/reject`),
  adminVerify: (id: string, verified: boolean) => http.put(`/admin/partners/${id}/verify`, { verified }),
  adminOrders: (page = 1, status?: string) =>
    http.get<{ total: number; items: Array<{ id: string; orderNo: string; customer: string; customerMobile: string; partner: string; city: string; totalAmount: number; status: string; createdAt: string }> }>('/admin/orders', { params: { page, status } }),
  adminDynamics: (page = 1) =>
    http.get<{ total: number; items: Array<{ id: string; content: string; images: string[]; city: string | null; likeCount: number; commentCount: number; createdAt: string; author: string; avatar: string | null }> }>('/admin/dynamics', { params: { page } }),
  adminDeleteDynamic: (id: string) => http.delete(`/admin/dynamics/${id}`),
  adminBanners: () => http.get<Array<{ id: string; image: string; link: string | null; sort: number }>>('/admin/banners'),
  adminSaveBanner: (data: { id?: string; image: string; link?: string; sort?: number }) =>
    data.id ? http.put(`/admin/banners/${data.id}`, data) : http.post('/admin/banners', data),
  adminDeleteBanner: (id: string) => http.delete(`/admin/banners/${id}`),

  upload: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return http.post<{ url: string }>('/uploads', fd);
  },
};
