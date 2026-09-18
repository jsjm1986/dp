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
}

export interface Order {
  id: string;
  orderNo: string;
  partnerId: string;
  partner: { id: string; nickname: string; avatar: string | null; city: string };
  items: Array<{ id: string; serviceId: string; name: string; price: number; unit: string; num: number; subtotal: number }>;
  appointAt: string;
  address: string | null;
  remark: string | null;
  totalAmount: number;
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

export interface UserProfile {
  id: string;
  mobile: string;
  nickname: string;
  avatar: string | null;
  gender: string | null;
  city: string | null;
  balance: number;
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

  createOrder: (data: { partnerId: string; items: Array<{ serviceId: string; num: number }>; appointAt: string; address?: string; remark?: string }) =>
    http.post<Order>('/orders', data),
  orders: (status?: string, page = 1) =>
    http.get<{ total: number; items: Order[] }>('/orders', { params: { status, page } }),
  order: (id: string) => http.get<Order>(`/orders/${id}`),
  payOrder: (id: string) => http.post<Order>(`/orders/${id}/pay`),
  cancelOrder: (id: string, reason?: string) => http.post<Order>(`/orders/${id}/cancel`, { reason }),
  urgeOrder: (id: string) => http.post(`/orders/${id}/urge`),
  reviewOrder: (id: string, rating: number, content?: string) => http.post(`/orders/${id}/review`, { rating, content }),

  dynamics: (page = 1) => http.get<{ total: number; items: Dynamic[] }>('/dynamics', { params: { page } }),
  createDynamic: (data: { content: string; images?: string[]; city?: string }) => http.post<{ id: string }>('/dynamics', data),
  likeDynamic: (id: string) => http.post<{ liked: boolean; likeCount: number }>(`/dynamics/${id}/like`),
  unlikeDynamic: (id: string) => http.delete<{ liked: boolean; likeCount: number }>(`/dynamics/${id}/like`),
  comments: (id: string) => http.get<CommentRow[]>(`/dynamics/${id}/comments`),
  comment: (id: string, content: string) =>
    http.post<CommentRow & { commentCount: number }>(`/dynamics/${id}/comments`, { content }),

  upload: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return http.post<{ url: string }>('/uploads', fd);
  },
};
