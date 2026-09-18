<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { showToast } from 'vant';
import { api } from '../api';

type Claimable = Awaited<ReturnType<typeof api.claimableCoupons>>[number];
type Mine = Awaited<ReturnType<typeof api.myCoupons>>[number];

const tab = ref(0);
const claimable = ref<Claimable[]>([]);
const mine = ref<Mine[]>([]);

async function load() {
  [claimable.value, mine.value] = await Promise.all([api.claimableCoupons(), api.myCoupons()]);
}

async function claim(c: Claimable) {
  if (c.claimed) return;
  try {
    await api.claimCoupon(c.id);
    c.claimed = true;
    showToast('领取成功');
    load();
  } catch {
    /* toast 已由拦截器处理 */
  }
}

function fmt(t: string) {
  const d = new Date(t);
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
}

onMounted(load);
</script>

<template>
  <div class="page page--no-tab">
    <van-nav-bar title="优惠券" left-arrow :border="false" @click-left="$router.back()" fixed placeholder />

    <van-tabs v-model:active="tab" sticky>
      <van-tab title="领券中心">
        <div class="cp__list">
          <div v-for="c in claimable" :key="c.id" class="cp__item">
            <div class="cp__amount"><i>¥</i>{{ c.amount }}</div>
            <div class="cp__info">
              <div class="cp__title">{{ c.title }}</div>
              <div class="muted">{{ c.minSpend > 0 ? `满${c.minSpend}元可用` : '无门槛' }} · {{ fmt(c.expiresAt) }}到期</div>
              <div v-if="c.left >= 0" class="muted">剩余 {{ c.left }} 张</div>
            </div>
            <van-button
              size="small" round
              :type="c.claimed ? 'default' : 'primary'"
              :disabled="c.claimed || c.left === 0"
              @click="claim(c)"
            >
              {{ c.claimed ? '已领取' : c.left === 0 ? '已领完' : '领取' }}
            </van-button>
          </div>
          <van-empty v-if="!claimable.length" description="暂无优惠券" />
        </div>
      </van-tab>

      <van-tab :title="`我的券(${mine.length})`">
        <div class="cp__list">
          <div v-for="c in mine" :key="c.id" class="cp__item" :class="{ 'cp__item--dead': c.used || c.expired }">
            <div class="cp__amount"><i>¥</i>{{ c.amount }}</div>
            <div class="cp__info">
              <div class="cp__title">{{ c.title }}</div>
              <div class="muted">{{ c.minSpend > 0 ? `满${c.minSpend}元可用` : '无门槛' }} · {{ fmt(c.expiresAt) }}到期</div>
            </div>
            <van-tag v-if="c.used" type="default">已使用</van-tag>
            <van-tag v-else-if="c.expired" type="default">已过期</van-tag>
            <van-tag v-else type="primary">可使用</van-tag>
          </div>
          <van-empty v-if="!mine.length" description="还没有优惠券，去领券中心看看" />
        </div>
      </van-tab>
    </van-tabs>
  </div>
</template>

<style scoped>
.cp__list {
  padding: 12px;
}
.cp__item {
  display: flex;
  align-items: center;
  gap: 14px;
  background: linear-gradient(135deg, #fff5f5, #fff);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 12px;
}
.cp__item--dead {
  opacity: 0.5;
  background: #f5f6f8;
}
.cp__amount {
  color: #ff5a5f;
  font-size: 30px;
  font-weight: 800;
  min-width: 70px;
}
.cp__amount i {
  font-size: 15px;
  font-style: normal;
}
.cp__info {
  flex: 1;
}
.cp__title {
  font-weight: 600;
  margin-bottom: 4px;
}
</style>
