<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, type Order } from '../api';
import { ORDER_STATUS_TEXT } from '../utils/order';

const router = useRouter();
const tab = ref('all');
const items = ref<Order[]>([]);
const page = ref(1);
const loading = ref(false);
const finished = ref(false);

const tabs = [
  { label: '全部', value: 'all' },
  { label: '待支付', value: 'pending_payment' },
  { label: '待接单', value: 'pending_accept' },
  { label: '待服务', value: 'pending_service' },
  { label: '服务中', value: 'serving' },
  { label: '已完成', value: 'done' },
];

async function load(reset = false) {
  if (loading.value && !reset) return;
  if (reset) {
    page.value = 1;
    items.value = [];
    finished.value = false;
  }
  loading.value = true;
  try {
    const res = await api.orders(tab.value === 'all' ? undefined : tab.value, page.value);
    items.value = reset ? res.items : [...items.value, ...res.items];
    finished.value = items.value.length >= res.total;
    page.value += 1;
  } finally {
    loading.value = false;
  }
}

function fmt(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

onMounted(() => load(true));
</script>

<template>
  <div class="page orders">
    <van-nav-bar title="订单" fixed placeholder :border="false" />
    <van-tabs v-model:active="tab" sticky offset-top="46" color="#ff5a5f" @change="load(true)">
      <van-tab v-for="t in tabs" :key="t.value" :title="t.label" :name="t.value" />
    </van-tabs>

    <div class="orders__list">
      <van-list :loading="loading" :finished="finished" finished-text="没有更多了" @load="load()">
        <div v-for="o in items" :key="o.id" class="ocard card" @click="router.push(`/order/${o.id}`)">
          <div class="ocard__head">
            <div class="ocard__partner">
              <van-image round width="20" height="20" :src="o.partner.avatar || ''" />
              <span>{{ o.partner.nickname }}</span>
              <van-icon name="arrow" color="#999" />
            </div>
            <span class="ocard__status">{{ ORDER_STATUS_TEXT[o.status] || o.status }}</span>
          </div>
          <div class="ocard__items">
            <div v-for="i in o.items" :key="i.id" class="ocard__item">
              <span>{{ i.name }} ×{{ i.num }}</span>
              <span class="muted">¥{{ i.subtotal }}</span>
            </div>
          </div>
          <div class="ocard__foot">
            <span class="muted">预约 {{ fmt(o.appointAt) }}</span>
            <span>合计 <span class="price">¥{{ o.totalAmount.toFixed(0) }}</span></span>
          </div>
        </div>
        <van-empty v-if="!loading && !items.length" description="还没有订单，去挑个玩伴吧" />
      </van-list>
    </div>
  </div>
</template>

<style scoped>
.orders__list {
  padding: 12px;
}
.ocard {
  margin-bottom: 12px;
}
.ocard__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 10px;
  border-bottom: 1px solid #f5f5f5;
}
.ocard__partner {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  font-size: 14px;
}
.ocard__status {
  color: var(--dp-primary);
  font-size: 13px;
}
.ocard__items {
  padding: 10px 0;
}
.ocard__item {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  padding: 3px 0;
}
.ocard__foot {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 13px;
}
</style>
