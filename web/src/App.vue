<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();
const showTab = computed(() => route.meta.tab === true);
const active = computed(() => route.path);
</script>

<template>
  <router-view />
  <van-tabbar v-if="showTab" :model-value="active" route safe-area-inset-bottom fixed>
    <van-tabbar-item to="/home" icon="home-o">首页</van-tabbar-item>
    <van-tabbar-item to="/partners" icon="friends-o">玩伴</van-tabbar-item>
    <van-tabbar-item to="/dynamics" icon="fire-o">动态</van-tabbar-item>
    <van-tabbar-item to="/orders" icon="orders-o">订单</van-tabbar-item>
    <van-tabbar-item to="/mine" icon="user-o">我的</van-tabbar-item>
  </van-tabbar>
</template>
