<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showToast } from 'vant';
import { api, type PartnerDetail } from '../api';

const route = useRoute();
const router = useRouter();
const partnerId = route.params.partnerId as string;
const p = ref<PartnerDetail | null>(null);
const qty = ref<Record<string, number>>({});
const appointAt = ref('');
const showCalendar = ref(false);
const address = ref('');
const remark = ref('');
const agreed = ref(false);
const submitting = ref(false);

const chosen = computed(() =>
  (p.value?.services ?? [])
    .filter((s) => (qty.value[s.id] ?? 0) > 0)
    .map((s) => ({ ...s, num: qty.value[s.id] })),
);
const total = computed(() => chosen.value.reduce((sum, s) => sum + s.price * s.num, 0));
const minDate = new Date();
const maxDate = new Date(Date.now() + 30 * 86400_000);

function fmtDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function onCalendarConfirm(values: Date[]) {
  appointAt.value = fmtDate(values[0]);
  showCalendar.value = false;
}

async function submit() {
  if (!chosen.value.length) return showToast('请选择服务项目');
  if (!appointAt.value) return showToast('请选择预约日期');
  if (!agreed.value) return showToast('请先阅读并同意《平台交易规则》');
  submitting.value = true;
  try {
    const order = await api.createOrder({
      partnerId,
      items: chosen.value.map((s) => ({ serviceId: s.id, num: s.num })),
      appointAt: new Date(`${appointAt.value}T10:00:00`).toISOString(),
      address: address.value || undefined,
      remark: remark.value || undefined,
    });
    showToast('下单成功，请支付');
    router.replace(`/order/${order.id}`);
  } finally {
    submitting.value = false;
  }
}

onMounted(async () => {
  p.value = await api.partner(partnerId);
});
</script>

<template>
  <div v-if="p" class="page page--no-tab">
    <van-nav-bar title="预约下单" left-arrow :border="false" @click-left="$router.back()" fixed placeholder />

    <div class="card oc__partner">
      <van-image round width="44" height="44" :src="p.avatar || ''" />
      <div>
        <div class="oc__name">{{ p.nickname }}</div>
        <div class="muted">{{ p.city }}{{ p.district ? '·' + p.district : '' }} · ★{{ p.rating.toFixed(1) }}</div>
      </div>
    </div>

    <div class="card oc__block">
      <div class="oc__title">选择服务</div>
      <div v-for="s in p.services" :key="s.id" class="oc__svc">
        <div class="oc__svc-info">
          <div>{{ s.name }}</div>
          <div class="muted">¥{{ s.price }}/{{ s.unit }}<template v-if="s.miniNum > 1"> · {{ s.miniNum }}{{ s.unit }}起订</template></div>
        </div>
        <van-stepper
          :model-value="qty[s.id] ?? 0"
          min="0"
          :max="20"
          theme="round"
          button-size="22"
          @update:model-value="(v: number) => (qty[s.id] = v)"
        />
      </div>
    </div>

    <div class="card oc__block">
      <van-cell title="预约日期" :value="appointAt || '请选择'" is-link @click="showCalendar = true" />
      <van-field v-model="address" label="碰面地点" placeholder="选填，如商场/地铁站" />
      <van-field
        v-model="remark"
        label="备注"
        type="textarea"
        rows="2"
        placeholder="想玩什么、有什么要求，告诉Ta"
      />
    </div>

    <div class="card oc__block">
      <div class="oc__title">费用明细</div>
      <div v-for="s in chosen" :key="s.id" class="oc__fee">
        <span class="muted">{{ s.name }} ×{{ s.num }}</span>
        <span>¥{{ (s.price * s.num).toFixed(0) }}</span>
      </div>
      <van-divider v-if="chosen.length" />
      <div class="oc__fee oc__fee--total">
        <span>合计</span>
        <span class="price">¥{{ total.toFixed(0) }}</span>
      </div>
    </div>

    <div class="oc__agree">
      <van-checkbox v-model="agreed" icon-size="14" checked-color="#ff5a5f" />
      <span class="muted">我已阅读并同意《平台交易规则》，知晓服务边界与退款政策</span>
    </div>

    <div class="oc__bar safe-bottom">
      <div class="oc__bar-price">
        <span class="muted">合计</span>
        <span class="price oc__bar-num">¥{{ total.toFixed(0) }}</span>
      </div>
      <van-button round type="primary" :loading="submitting" class="oc__bar-btn" @click="submit">
        提交订单
      </van-button>
    </div>

    <van-calendar
      v-model:show="showCalendar"
      :min-date="minDate"
      :max-date="maxDate"
      @confirm="onCalendarConfirm"
    />
  </div>
</template>

<style scoped>
.oc__partner {
  margin: 12px;
  display: flex;
  gap: 12px;
  align-items: center;
}
.oc__name {
  font-weight: 700;
  font-size: 16px;
}
.oc__block {
  margin: 0 12px 12px;
}
.oc__title {
  font-weight: 700;
  margin-bottom: 8px;
}
.oc__svc {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  border-top: 1px solid #f5f5f5;
}
.oc__svc:first-of-type {
  border-top: none;
}
.oc__fee {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  padding: 4px 0;
}
.oc__fee--total {
  font-size: 15px;
  font-weight: 700;
}
.oc__agree {
  margin: 0 16px 90px;
  display: flex;
  gap: 6px;
  align-items: flex-start;
}
.oc__bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  max-width: 750px;
  margin: 0 auto;
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  box-shadow: 0 -2px 12px rgba(0, 0, 0, 0.06);
}
.oc__bar-num {
  font-size: 22px;
  margin-left: 6px;
}
.oc__bar-btn {
  width: 140px;
}
</style>
