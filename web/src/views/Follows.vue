<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, type PartnerCard } from '../api';
import PartnerCardView from '../components/PartnerCard.vue';

const items = ref<PartnerCard[]>([]);
const loading = ref(true);

onMounted(async () => {
  try {
    items.value = await api.myFollows();
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="page page--no-tab">
    <van-nav-bar title="我的关注" left-arrow :border="false" @click-left="$router.back()" fixed placeholder />
    <div class="follows__list">
      <PartnerCardView v-for="p in items" :key="p.id" :partner="p" />
      <van-empty v-if="!loading && !items.length" description="还没关注任何玩伴" />
      <van-loading v-if="loading" class="follows__loading" />
    </div>
  </div>
</template>

<style scoped>
.follows__list {
  padding: 12px;
}
.follows__loading {
  display: block;
  margin: 40px auto;
}
</style>
