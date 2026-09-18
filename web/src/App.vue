<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from './api';
import { useUserStore } from './stores/user';

const route = useRoute();
const store = useUserStore();
const showTab = computed(() => route.meta.tab === true);
const active = computed(() => route.path);
const unread = ref(0);
let timer: ReturnType<typeof setInterval> | undefined;

async function poll() {
  if (!store.loggedIn) return;
  try {
    unread.value = (await api.unreadCount()).count;
  } catch {
    /* 静默 */
  }
}

onMounted(() => {
  poll();
  timer = setInterval(poll, 15000);
});
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <router-view />
  <van-tabbar v-if="showTab" :model-value="active" route safe-area-inset-bottom fixed>
    <van-tabbar-item to="/home" icon="home-o">首页</van-tabbar-item>
    <van-tabbar-item to="/partners" icon="friends-o">玩伴</van-tabbar-item>
    <van-tabbar-item to="/dynamics" icon="fire-o">动态</van-tabbar-item>
    <van-tabbar-item to="/orders" icon="orders-o">订单</van-tabbar-item>
    <van-tabbar-item to="/mine" icon="user-o" :badge="unread || ''">我的</van-tabbar-item>
  </van-tabbar>
</template>
