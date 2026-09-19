<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { showToast } from 'vant';
import { api, type BalanceLogItem } from '../api';
import { useUserStore } from '../stores/user';

const store = useUserStore();
const balance = ref(0);
const logs = ref<BalanceLogItem[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);

// 充值/兑换
const showRecharge = ref(false);
const rechargeAmount = ref(100);
const recharging = ref(false);
const cardCode = ref('');
const redeeming = ref(false);

const TYPE_TEXT: Record<BalanceLogItem['type'], string> = {
  recharge: '余额充值',
  card: '充值卡兑换',
  pay: '订单支付',
  refund: '订单退款',
  commission: '邀请佣金',
  adjust: '平台调整',
  income: '完单入账',
  withdraw: '提现申请',
  withdraw_refund: '提现驳回返还',
};

async function load(p = 1) {
  loading.value = true;
  try {
    const r = await api.userWallet(p);
    balance.value = r.balance;
    total.value = r.total;
    page.value = p;
    logs.value = p === 1 ? r.items : [...logs.value, ...r.items];
  } finally {
    loading.value = false;
  }
}

async function recharge() {
  recharging.value = true;
  try {
    const r = await api.recharge(rechargeAmount.value);
    balance.value = r.balance;
    store.user && (store.user.balance = r.balance);
    showRecharge.value = false;
    showToast(`已充值 ¥${rechargeAmount.value}`);
    load(1);
  } finally {
    recharging.value = false;
  }
}

async function redeem() {
  const code = cardCode.value.trim();
  if (!code) return showToast('请输入卡密');
  redeeming.value = true;
  try {
    const r = await api.redeemCard(code);
    balance.value = r.balance;
    store.user && (store.user.balance = r.balance);
    cardCode.value = '';
    showToast(`兑换成功 +¥${r.amount}`);
    load(1);
  } finally {
    redeeming.value = false;
  }
}

function fmt(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

onMounted(() => load(1));
</script>

<template>
  <div class="page page--no-tab">
    <van-nav-bar title="我的钱包" left-arrow :border="false" @click-left="$router.back()" fixed placeholder />

    <div class="wt__hero">
      <div class="wt__label">账户余额（元）</div>
      <div class="wt__num">{{ balance.toFixed(2) }}</div>
      <div class="wt__actions">
        <van-button size="small" round color="#fff" plain hairline @click="showRecharge = true">
          <span style="color:#fff">充值</span>
        </van-button>
      </div>
    </div>

    <div class="card wt__redeem">
      <van-field v-model="cardCode" placeholder="输入充值卡密" maxlength="20">
        <template #button>
          <van-button size="small" type="primary" round :loading="redeeming" @click="redeem">兑换</van-button>
        </template>
      </van-field>
    </div>

    <div class="card wt__logs">
      <div class="wt__logs-title">收支明细</div>
      <div v-for="l in logs" :key="l.id" class="wt__log">
        <div>
          <div class="wt__log-type">{{ TYPE_TEXT[l.type] || l.type }}</div>
          <div class="muted">{{ fmt(l.createdAt) }}<template v-if="l.remark"> · {{ l.remark }}</template></div>
        </div>
        <div class="wt__log-amt" :class="l.amount >= 0 ? 'wt__log-amt--in' : 'wt__log-amt--out'">
          {{ l.amount >= 0 ? '+' : '' }}{{ l.amount.toFixed(2) }}
        </div>
      </div>
      <van-empty v-if="!loading && !logs.length" description="暂无收支记录" image-size="70" />
      <div v-if="logs.length < total" class="wt__more">
        <van-button size="small" round plain :loading="loading" @click="load(page + 1)">加载更多</van-button>
      </div>
    </div>

    <van-dialog v-model:show="showRecharge" title="余额充值（模拟）" show-cancel-button :confirm-button-loading="recharging" @confirm="recharge">
      <div class="wt__recharge">
        <div
          v-for="a in [50, 100, 200, 500]"
          :key="a"
          class="wt__recharge-opt"
          :class="{ 'wt__recharge-opt--on': rechargeAmount === a }"
          @click="rechargeAmount = a"
        >
          ¥{{ a }}
        </div>
      </div>
    </van-dialog>
  </div>
</template>

<style scoped>
.wt__hero {
  margin: 12px;
  padding: 26px 20px;
  border-radius: 16px;
  background: linear-gradient(135deg, #ff5a5f, #ff8e53);
  color: #fff;
  text-align: center;
}
.wt__label { font-size: 13px; opacity: .85; }
.wt__num { font-size: 40px; font-weight: 700; margin: 4px 0 12px; }
.wt__redeem { margin: 0 12px 12px; padding: 6px; }
.wt__logs { margin: 0 12px 12px; padding: 14px 16px; }
.wt__logs-title { font-size: 15px; font-weight: 600; margin-bottom: 8px; }
.wt__log { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #f5f5f5; font-size: 14px; }
.wt__log:last-of-type { border-bottom: none; }
.wt__log-type { font-size: 14px; }
.wt__log-amt { font-weight: 600; font-size: 15px; }
.wt__log-amt--in { color: #07c160; }
.wt__log-amt--out { color: #2c3e50; }
.wt__more { text-align: center; padding-top: 10px; }
.wt__recharge { display: flex; gap: 10px; padding: 16px; }
.wt__recharge-opt {
  flex: 1; text-align: center; padding: 10px 0; border: 1px solid #eee; border-radius: 10px; font-size: 15px;
}
.wt__recharge-opt--on { border-color: #ff5a5f; color: #ff5a5f; background: #fff5f5; }
</style>
