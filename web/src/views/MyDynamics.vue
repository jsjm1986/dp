<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { showConfirmDialog, showImagePreview, showToast } from 'vant';
import { api } from '../api';

type Dyn = Awaited<ReturnType<typeof api.myDynamics>>[number];
const items = ref<Dyn[]>([]);
const loading = ref(true);

async function load() {
  try {
    items.value = await api.myDynamics();
  } finally {
    loading.value = false;
  }
}

async function remove(d: Dyn) {
  try {
    await showConfirmDialog({ title: '删除动态', message: '确定删除这条动态吗？' });
  } catch {
    return;
  }
  await api.deleteDynamic(d.id);
  items.value = items.value.filter((x) => x.id !== d.id);
  showToast('已删除');
}

function fmt(t: string) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

onMounted(load);
</script>

<template>
  <div class="page page--no-tab">
    <van-nav-bar title="我的动态" left-arrow :border="false" @click-left="$router.back()" fixed placeholder>
      <template #right>
        <van-icon name="plus" size="18" @click="$router.push('/dynamic/publish')" />
      </template>
    </van-nav-bar>

    <van-loading v-if="loading" class="md__loading" />
    <div v-else class="md__list">
      <div v-for="d in items" :key="d.id" class="card md__item">
        <div class="md__content">{{ d.content }}</div>
        <div v-if="d.images.length" class="md__images">
          <van-image
            v-for="(img, i) in d.images" :key="i"
            width="80" height="80" radius="6" fit="cover" :src="img"
            @click="showImagePreview({ images: d.images, startPosition: i })"
          />
        </div>
        <div class="md__meta">
          <span class="muted">{{ d.city || '' }} · {{ fmt(d.createdAt) }}</span>
          <span class="muted">❤ {{ d.likeCount }} · 💬 {{ d.commentCount }}</span>
          <van-button size="mini" type="danger" plain @click="remove(d)">删除</van-button>
        </div>
      </div>
      <van-empty v-if="!items.length" description="还没发过动态" />
    </div>
  </div>
</template>

<style scoped>
.md__loading {
  display: block;
  margin: 40px auto;
}
.md__list {
  padding: 12px;
}
.md__item {
  padding: 14px;
  margin-bottom: 12px;
}
.md__content {
  font-size: 15px;
  line-height: 1.5;
  margin-bottom: 8px;
}
.md__images {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.md__meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
}
.md__meta .van-button {
  margin-left: auto;
}
</style>
