<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showConfirmDialog, showToast } from 'vant';
import { api, type Order } from '../api';
import { useUserStore } from '../stores/user';
import { ORDER_STATUS_TEXT } from '../utils/order';

const route = useRoute();
const router = useRouter();
const id = route.params.id as string;
const store = useUserStore();
const order = ref<Order | null>(null);
const paying = ref(false);
const showPay = ref(false);
const payMethod = ref<'balance' | 'mock'>('mock');
let poller: ReturnType<typeof setInterval> | null = null;

async function load() {
  order.value = await api.order(id);
}

async function pay() {
  paying.value = true;
  try {
    order.value = await api.payOrder(id, payMethod.value);
    showPay.value = false;
    showToast('支付成功，等待玩伴接单');
  } finally {
    paying.value = false;
  }
}

async function cancel() {
  try {
    await showConfirmDialog({ title: '取消订单', message: '确认要取消该笔订单嘛？' });
  } catch {
    return;
  }
  order.value = await api.cancelOrder(id, '用户主动取消');
  showToast('已取消');
}

async function urge() {
  try {
    await api.urgeOrder(id);
    showToast('已通知玩伴尽快处理');
    load();
  } catch {
    /* toast 已由拦截器弹出 */
  }
}

function review() {
  router.push(`/review/${id}`);
}

function chat() {
  router.push(`/chat/${order.value!.partner.userId}?orderId=${id}`);
}

function fmt(iso: string | null) {
  if (!iso) return '-';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

onMounted(() => {
  load();
  // 演示模式下订单会自动流转，轮询状态
  poller = setInterval(() => {
    const s = order.value?.status;
    if (s && !['done', 'cancelled', 'rejected', 'refunded'].includes(s)) load();
  }, 5000);
});
onUnmounted(() => poller && clearInterval(poller));
</script>

<template>
  <div v-if="order" class="page page--no-tab">
    <van-nav-bar title="订单详情" left-arrow :border="false" @click-left="$router.back()" fixed placeholder />

    <div class="od__status">
      <div class="od__status-text">{{ ORDER_STATUS_TEXT[order.status] || order.status }}</div>
      <div class="od__status-sub">
        <template v-if="order.status === 'pending_payment'">请在30分钟内完成支付</template>
        <template v-else-if="order.status === 'pending_accept'">等待玩伴确认接单</template>
        <template v-else-if="order.status === 'pending_service'">玩伴已接单，按约定时间见面</template>
        <template v-else-if="order.status === 'serving'">服务进行中，玩得开心</template>
        <template v-else-if="order.status === 'done'">服务已完成，评价一下吧</template>
        <template v-else>{{ order.cancelReason || '' }}</template>
      </div>
    </div>

    <div class="card od__block" @click="router.push(`/partner/${order.partnerId}`)">
      <div class="od__partner">
        <van-image round width="44" height="44" :src="order.partner.avatar || ''" />
        <div>
          <div class="od__name">{{ order.partner.nickname }}</div>
          <div class="muted">{{ order.partner.city }}</div>
        </div>
        <van-icon name="arrow" color="#999" />
      </div>
    </div>

    <div class="card od__block">
      <div class="od__title">预约信息</div>
      <van-cell title="预约时间" :value="fmt(order.appointAt)" :border="false" />
      <van-cell title="碰面地点" :value="order.address || '未填写'" :border="false" />
      <van-cell title="备注" :value="order.remark || '-'" :border="false" />
    </div>

    <div class="card od__block">
      <div class="od__title">费用明细</div>
      <div v-for="i in order.items" :key="i.id" class="od__fee">
        <span>{{ i.name }} ×{{ i.num }}</span>
        <span>¥{{ i.subtotal }}</span>
      </div>
      <van-divider />
      <div v-if="order.discount > 0" class="od__fee">
        <span>优惠抵扣</span>
        <span class="price">-¥{{ order.discount.toFixed(0) }}</span>
      </div>
      <div class="od__fee od__fee--total">
        <span>实付</span>
        <span class="price">¥{{ order.totalAmount.toFixed(0) }}</span>
      </div>
    </div>

    <div class="card od__block">
      <div class="od__title">订单信息</div>
      <van-cell title="订单编号" :value="order.orderNo" :border="false" />
      <van-cell title="下单时间" :value="fmt(order.createdAt)" :border="false" />
      <van-cell v-if="order.paidAt" title="支付时间" :value="fmt(order.paidAt)" :border="false" />
    </div>

    <div class="od__bar safe-bottom">
      <van-button v-if="order.status !== 'cancelled'" round plain icon="chat-o" @click="chat">联系玩伴</van-button>
      <template v-if="order.status === 'pending_payment'">
        <van-button round plain @click="cancel">取消订单</van-button>
        <van-button round type="primary" class="od__bar-main" @click="showPay = true">立即支付</van-button>
      </template>
      <template v-else-if="['pending_accept', 'pending_service'].includes(order.status)">
        <van-button round plain @click="cancel">申请退款</van-button>
        <van-button round type="primary" class="od__bar-main" :disabled="!!order.urgedAt" @click="urge">
          {{ order.urgedAt ? '已催单' : '催服务' }}
        </van-button>
      </template>
      <template v-else-if="order.status === 'done' && !order.reviewed">
        <van-button round type="primary" class="od__bar-main" @click="review">评价订单</van-button>
      </template>
      <template v-else-if="order.status === 'done'">
        <van-button round plain block>已评价</van-button>
      </template>
    </div>

    <van-dialog v-model:show="showPay" title="选择支付方式" show-cancel-button :confirm-button-loading="paying" confirm-button-text="确认支付" @confirm="pay">
      <div class="od__pay">
        <van-radio-group v-model="payMethod">
          <van-cell clickable :border="false" :disabled="(store.user?.balance ?? 0) < order.totalAmount" @click="payMethod = 'balance'">
            <template #title>余额支付 <span class="muted">(¥{{ (store.user?.balance ?? 0).toFixed(0) }})</span></template>
            <template #right-icon><van-radio name="balance" checked-color="#ff5a5f" /></template>
          </van-cell>
          <van-cell title="微信支付（模拟）" icon="wechat-pay" clickable :border="false" @click="payMethod = 'mock'">
            <template #right-icon><van-radio name="mock" checked-color="#07c160" /></template>
          </van-cell>
        </van-radio-group>
        <div class="od__pay-amount">支付 <span class="price">¥{{ order.totalAmount.toFixed(0) }}</span></div>
        <div class="muted od__pay-hint">余额支付即时扣款；微信支付为模拟</div>
      </div>
    </van-dialog>
  </div>
</template>

<style scoped>
.od__status {
  padding: 20px 20px 24px;
  background: linear-gradient(135deg, #ff5a5f, #ff8e53);
  color: #fff;
}
.od__status-text {
  font-size: 20px;
  font-weight: 800;
}
.od__status-sub {
  margin-top: 4px;
  font-size: 12px;
  opacity: 0.85;
}
.od__block {
  margin: 12px 12px 0;
}
.od__partner {
  display: flex;
  gap: 12px;
  align-items: center;
}
.od__partner > div {
  flex: 1;
}
.od__name {
  font-weight: 700;
}
.od__title {
  font-weight: 700;
  margin-bottom: 6px;
}
.od__fee {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  padding: 4px 0;
}
.od__fee--total {
  font-weight: 700;
  font-size: 15px;
}
.od__bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  max-width: 750px;
  margin: 0 auto;
  display: flex;
  gap: 12px;
  padding: 10px 16px;
  background: #fff;
  box-shadow: 0 -2px 12px rgba(0, 0, 0, 0.06);
}
.od__bar-main {
  flex: 1;
}
.od__pay {
  padding: 8px 4px 16px;
}
.od__pay-amount {
  text-align: center;
  margin-top: 10px;
}
.od__pay-amount .price {
  font-size: 22px;
}
.od__pay-hint {
  text-align: center;
  margin-top: 4px;
}
</style>
