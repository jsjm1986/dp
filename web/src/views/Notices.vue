<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, type NoticeItem } from '../api';

const router = useRouter();
const items = ref<NoticeItem[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);
const finished = ref(false);

const TYPE_META: Record<string, { icon: string; color: string }> = {
  order: { icon: 'orders-o', color: '#1989fa' },
  audit: { icon: 'certificate', color: '#ff976a' },
  wallet: { icon: 'balance-o', color: '#07c160' },
  commission: { icon: 'gift-o', color: '#ee0a24' },
  system: { icon: 'volume-o', color: '#7232dd' },
};

async function load() {
  if (loading.value) return;
  loading.value = true;
  try {
    const res = await api.notices(page.value);
    items.value.push(...res.items);
    total.value = res.total;
    finished.value = items.value.length >= res.total;
    page.value++;
  } finally {
    loading.value = false;
  }
}

function fmt(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return sameDay ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

function open(n: NoticeItem) {
  if (!n.read) {
    n.read = true;
    api.readNotices(n.id).catch(() => {});
  }
  if (n.type === 'order' && n.refId) router.push(`/order/${n.refId}`);
  else if (n.type === 'wallet' || n.type === 'commission') router.push('/wallet');
}

onMounted(() => {
  // 进入页面即全部已读（列表式浏览）；首屏由 van-list @load 触发
  api.readNotices().catch(() => {});
});
</script>

<template>
  <div class="ntc">
    <van-nav-bar title="通知" left-arrow @click-left="$router.back()" />
    <van-list v-model:loading="loading" :finished="finished" finished-text="没有更多了" @load="load">
      <div v-for="n in items" :key="n.id" class="card ntc__item" @click="open(n)">
        <div class="ntc__icon" :style="{ background: (TYPE_META[n.type]?.color ?? '#999') + '1a', color: TYPE_META[n.type]?.color }">
          <van-icon :name="TYPE_META[n.type]?.icon ?? 'bell'" size="20" />
        </div>
        <div class="ntc__body">
          <div class="ntc__head">
            <b>{{ n.title }}</b>
            <span class="muted">{{ fmt(n.createdAt) }}</span>
          </div>
          <div class="ntc__content">{{ n.content }}</div>
        </div>
        <span v-if="!n.read" class="ntc__dot" />
      </div>
      <van-empty v-if="finished && !items.length" description="暂无通知" />
    </van-list>
  </div>
</template>

<style scoped>
.ntc {
  min-height: 100vh;
  background: #f7f8fa;
}
.ntc__item {
  margin: 10px 12px;
  padding: 12px;
  display: flex;
  gap: 10px;
  align-items: flex-start;
  position: relative;
}
.ntc__icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.ntc__body {
  flex: 1;
  min-width: 0;
}
.ntc__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
}
.ntc__head .muted {
  font-size: 11px;
}
.ntc__content {
  margin-top: 4px;
  font-size: 13px;
  color: var(--dp-text-2);
  line-height: 1.5;
}
.ntc__dot {
  position: absolute;
  top: 14px;
  right: 12px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ee0a24;
}
</style>
