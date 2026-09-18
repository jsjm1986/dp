import { createRouter, createWebHistory } from 'vue-router';
import { useUserStore } from '../stores/user';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/home' },
    { path: '/home', component: () => import('../views/Home.vue'), meta: { tab: true } },
    { path: '/partners', component: () => import('../views/Partners.vue'), meta: { tab: true } },
    { path: '/dynamics', component: () => import('../views/Dynamics.vue'), meta: { tab: true } },
    { path: '/orders', component: () => import('../views/Orders.vue'), meta: { tab: true, auth: true } },
    { path: '/mine', component: () => import('../views/Mine.vue'), meta: { tab: true, auth: true } },
    { path: '/login', component: () => import('../views/Login.vue') },
    { path: '/partner/:id', component: () => import('../views/PartnerDetail.vue') },
    { path: '/order/create/:partnerId', component: () => import('../views/OrderCreate.vue'), meta: { auth: true } },
    { path: '/order/:id', component: () => import('../views/OrderDetail.vue'), meta: { auth: true } },
    { path: '/review/:orderId', component: () => import('../views/Review.vue'), meta: { auth: true } },
    { path: '/dynamic/publish', component: () => import('../views/DynamicPublish.vue'), meta: { auth: true } },
    { path: '/follows', component: () => import('../views/Follows.vue'), meta: { auth: true } },
    { path: '/partner/apply', component: () => import('../views/PartnerApply.vue'), meta: { auth: true } },
    { path: '/partner/console', component: () => import('../views/PartnerConsole.vue'), meta: { auth: true } },
    { path: '/chats', component: () => import('../views/Chats.vue'), meta: { auth: true } },
    { path: '/chat/:peerId', component: () => import('../views/Chat.vue'), meta: { auth: true } },
  ],
});

router.beforeEach((to) => {
  const store = useUserStore();
  if (to.meta.auth && !store.loggedIn) {
    return { path: '/login', query: { redirect: to.fullPath } };
  }
});

export default router;
