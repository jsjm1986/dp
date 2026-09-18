import { defineStore } from 'pinia';
import { api, type UserProfile } from '../api';

const TOKEN_KEY = 'dp_token';
const USER_KEY = 'dp_user';

export const useUserStore = defineStore('user', {
  state: () => ({
    token: localStorage.getItem(TOKEN_KEY) ?? '',
    user: JSON.parse(localStorage.getItem(USER_KEY) ?? 'null') as UserProfile | null,
  }),
  getters: {
    loggedIn: (s) => !!s.token,
  },
  actions: {
    setAuth(token: string, user: UserProfile) {
      this.token = token;
      this.user = user;
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    },
    async refresh() {
      if (!this.token) return;
      this.user = await api.profile();
      localStorage.setItem(USER_KEY, JSON.stringify(this.user));
    },
    logout() {
      this.token = '';
      this.user = null;
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    },
  },
});
