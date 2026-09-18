<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { showConfirmDialog, showToast } from 'vant';
import { api, type Order, type PartnerStats } from '../api';
import { ORDER_STATUS_TEXT } from '../utils/order';

type PartnerOrder = Order & { customer: { id: string; nickname: string; avatar: string | null; mobile: string } };

const router = useRouter();
const stats = ref<PartnerStats | null>(null);
const tab = ref('pending_accept');
const items = ref<PartnerOrder[]>([]);
const loading = ref(false);
const acting = ref('');
const wallet = ref<Awaited<ReturnType<typeof api.partnerWallet>> | null>(null);
const showWithdraw = ref(false);
const withdrawAmount = ref<number | undefined>();
const withdrawing = ref(false);
let poller: ReturnType<typeof setInterval> | null = null;

async function loadWallet() {
  wallet.value = await api.partnerWallet();
}

async function withdraw() {
  const amount = Number(withdrawAmount.value);
  if (!amount || amount <= 0) return showToast('请输入提现金额');
  withdrawing.value = true;
  try {
    await api.partnerWithdraw(amount);
    showWithdraw.value = false;
    withdrawAmount.value = undefined;
    showToast('提现申请已提交，等待平台审核');
    loadWallet();
  } finally {
    withdrawing.value = false;
  }
}

const withdrawStatusText: Record<string, string> = {
  pending: '审核中', done: '已到账', rejected: '已拒绝',
};

const tabs = [
  { label: '待接单', value: 'pending_accept' },
  { label: '待服务', value: 'pending_service' },
  { label: '服务中', value: 'serving' },
  { label: '已完成', value: 'done' },
];

const online = computed({
  get: () => stats.value?.status === 'available',
  set: (v: boolean) => toggleStatus(v),
});

async function toggleStatus(v: boolean) {
  const res = await api.setPartnerStatus(v ? 'available' : 'rest');
  if (stats.value) stats.value.status = res.status;
  showToast(v ? '已上线，开始接单' : '已休息，暂停接单');
}

async function loadStats() {
  stats.value = await api.partnerStats();
}

async function loadOrders() {
  loading.value = true;
  try {
    items.value = await api.partnerOrders(tab.value);
  } finally {
    loading.value = false;
  }
}

async function act(o: PartnerOrder, action: 'accept' | 'reject' | 'start' | 'finish') {
  if (action === 'reject') {
    try {
      await showConfirmDialog({ title: '拒绝订单', message: '拒绝后订单将关闭并全额退款给用户，确认拒绝？' });
    } catch {
      return;
    }
  }
  acting.value = o.id;
  try {
    await api.partnerOrderAct(o.id, action);
    const msg = { accept: '已接单', reject: '已拒绝', start: '服务已开始', finish: '服务已完成' }[action];
    showToast(msg);
    await Promise.all([loadOrders(), loadStats()]);
  } finally {
    acting.value = '';
  }
}

function fmt(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

onMounted(() => {
  loadStats();
  loadOrders();
  loadWallet();
  poller = setInterval(() => {
    loadStats();
    loadOrders();
  }, 10000);
});
onUnmounted(() => poller && clearInterval(poller));
</script>

<template>
  <div class="page page--no-tab">
    <van-nav-bar title="玩伴工作台" left-arrow :border="false" @click-left="$router.back()" fixed placeholder>
      <template #right>
        <van-icon name="edit" size="18" @click="router.push('/partner/apply')" />
      </template>
    </van-nav-bar>

    <van-notice-bar
      v-if="stats?.auditStatus === 'pending'"
      left-icon="info-o"
      text="入驻资料审核中，通过后才会展示给用户"
      wrapable
    />
    <van-notice-bar
      v-else-if="stats?.auditStatus === 'rejected'"
      left-icon="warning-o"
      color="#ee0a24"
      background="#ffe1e1"
      text="入驻申请被拒绝，请修改资料后重新提交"
      wrapable
    />

    <div class="pc__hero">
      <div class="pc__status">
        <div>
          <div class="pc__status-text">{{ stats?.status === 'rest' ? '休息中' : '接单中' }}</div>
          <div class="pc__status-sub">{{ stats?.status === 'rest' ? '用户暂时看不到你' : '正在对用户展示' }}</div>
        </div>
        <van-switch :model-value="online" size="22" @update:model-value="(v: boolean) => (online = v)" />
      </div>
      <div class="pc__stats" v-if="stats">
        <div class="pc__stat">
          <div class="pc__stat-num">{{ stats.pendingAccept }}</div>
          <div class="pc__stat-label">待接单</div>
        </div>
        <div class="pc__stat">
          <div class="pc__stat-num">{{ stats.todayOrders }}</div>
          <div class="pc__stat-label">今日订单</div>
        </div>
        <div class="pc__stat">
          <div class="pc__stat-num">{{ stats.doneCount }}</div>
          <div class="pc__stat-label">累计完成</div>
        </div>
        <div class="pc__stat">
          <div class="pc__stat-num">¥{{ stats.doneAmount.toFixed(0) }}</div>
          <div class="pc__stat-label">累计收入</div>
        </div>
      </div>
    </div>

    <div class="card pc__wallet" @click="showWithdraw = true">
      <div>
        <div class="muted">可提现余额</div>
        <div class="pc__wallet-num">¥{{ (wallet?.balance ?? 0).toFixed(2) }}</div>
      </div>
      <van-button size="small" round type="primary" plain>提现</van-button>
    </div>
    <div v-if="wallet?.withdrawals.length" class="card pc__withdrawals">
      <div v-for="w in wallet.withdrawals" :key="w.id" class="pc__withdrawal">
        <span>提现 ¥{{ w.amount.toFixed(2) }}</span>
        <van-tag :type="w.status === 'done' ? 'success' : w.status === 'rejected' ? 'danger' : 'warning'">
          {{ withdrawStatusText[w.status] || w.status }}
        </van-tag>
      </div>
    </div>

    <van-tabs v-model:active="tab" sticky offset-top="46" color="#ff5a5f" @change="loadOrders">
      <van-tab v-for="t in tabs" :key="t.value" :name="t.value">
        <template #title>
          {{ t.label }}
          <van-badge v-if="t.value === 'pending_accept' && stats?.pendingAccept" :content="stats.pendingAccept" />
        </template>
      </van-tab>
    </van-tabs>

    <div class="pc__list">
      <van-loading v-if="loading && !items.length" class="pc__loading" />
      <template v-else>
        <div v-for="o in items" :key="o.id" class="porder card">
          <div class="porder__head">
            <div class="porder__customer">
              <van-image round width="32" height="32" :src="o.customer.avatar || ''" />
              <div>
                <div class="porder__name">{{ o.customer.nickname }}</div>
                <div class="muted">{{ fmt(o.appointAt) }}</div>
              </div>
            </div>
            <span class="porder__status">{{ ORDER_STATUS_TEXT[o.status] || o.status }}</span>
          </div>
          <div class="porder__items">
            <div v-for="i in o.items" :key="i.id" class="porder__item">
              <span>{{ i.name }} ×{{ i.num }}</span>
              <span class="muted">¥{{ i.subtotal }}</span>
            </div>
          </div>
          <div v-if="o.address || o.remark" class="porder__extra">
            <div v-if="o.address" class="muted">📍 {{ o.address }}</div>
            <div v-if="o.remark" class="muted">💬 {{ o.remark }}</div>
          </div>
          <div class="porder__foot">
            <span class="price">¥{{ o.totalAmount.toFixed(0) }}</span>
            <div class="porder__actions">
              <van-button size="small" round plain icon="chat-o" @click="router.push(`/chat/${o.customer.id}?orderId=${o.id}`)" />
              <template v-if="o.status === 'pending_accept'">
                <van-button size="small" round plain :loading="acting === o.id" @click="act(o, 'reject')">拒绝</van-button>
                <van-button size="small" round type="primary" :loading="acting === o.id" @click="act(o, 'accept')">接单</van-button>
              </template>
              <van-button v-else-if="o.status === 'pending_service'" size="small" round type="primary" :loading="acting === o.id" @click="act(o, 'start')">
                开始服务
              </van-button>
              <van-button v-else-if="o.status === 'serving'" size="small" round type="success" :loading="acting === o.id" @click="act(o, 'finish')">
                完成服务
              </van-button>
              <span v-else-if="o.status === 'done'" class="muted">已完成</span>
            </div>
          </div>
        </div>
        <van-empty v-if="!items.length" description="暂无订单" />
      </template>
    </div>

    <van-dialog v-model:show="showWithdraw" title="申请提现" show-cancel-button :confirm-button-loading="withdrawing" @confirm="withdraw">
      <div class="pc__withdraw-form">
        <van-field
          v-model.number="withdrawAmount"
          type="number"
          label="金额"
          :placeholder="`可提 ¥${(wallet?.balance ?? 0).toFixed(2)}`"
        />
        <div class="muted pc__withdraw-hint">提交后平台审核打款，拒绝将退回余额</div>
      </div>
    </van-dialog>
  </div>
</template>

<style scoped>
.pc__hero {
  background: linear-gradient(135deg, #2c2c3a, #44445c);
  padding: 18px 16px;
  color: #fff;
}
.pc__status {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.pc__status-text {
  font-size: 18px;
  font-weight: 800;
}
.pc__status-sub {
  font-size: 11px;
  opacity: 0.7;
  margin-top: 2px;
}
.pc__stats {
  margin-top: 16px;
  display: flex;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 12px 0;
}
.pc__stat {
  flex: 1;
  text-align: center;
}
.pc__stat-num {
  font-size: 17px;
  font-weight: 800;
}
.pc__stat-label {
  font-size: 11px;
  opacity: 0.7;
  margin-top: 2px;
}
.pc__list {
  padding: 12px;
}
.pc__loading {
  display: block;
  margin: 40px auto;
}
.porder {
  margin-bottom: 12px;
}
.porder__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.porder__customer {
  display: flex;
  gap: 10px;
  align-items: center;
}
.porder__name {
  font-weight: 700;
  font-size: 14px;
}
.porder__status {
  color: var(--dp-primary);
  font-size: 12px;
}
.porder__items {
  margin-top: 10px;
  padding: 10px;
  background: #f8f8f8;
  border-radius: 8px;
}
.porder__item {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  padding: 2px 0;
}
.porder__extra {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.porder__foot {
  margin-top: 10px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.porder__actions {
  display: flex;
  gap: 8px;
}
.pc__wallet {
  margin: 12px;
  padding: 14px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.pc__wallet-num {
  font-size: 22px;
  font-weight: 800;
  color: #ff5a5f;
  margin-top: 2px;
}
.pc__withdrawals {
  margin: 0 12px 12px;
  padding: 8px 16px;
}
.pc__withdrawal {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  font-size: 13px;
}
.pc__withdraw-form {
  padding: 8px 0;
}
.pc__withdraw-hint {
  padding: 8px 16px;
  font-size: 12px;
}
</style>