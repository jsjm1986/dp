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
const appointHour = ref<number | null>(null);
const showCalendar = ref(false);
const address = ref('');
const remark = ref('');
const agreed = ref(false);
const submitting = ref(false);
const showCoupons = ref(false);
const coupons = ref<Awaited<ReturnType<typeof api.myCoupons>>>([]);
const pickedCoupon = ref<Awaited<ReturnType<typeof api.myCoupons>>[number] | null>(null);

const chosen = computed(() =>
  (p.value?.services ?? [])
    .filter((s) => (qty.value[s.id] ?? 0) > 0)
    .map((s) => ({ ...s, num: qty.value[s.id] })),
);
const total = computed(() => chosen.value.reduce((sum, s) => sum + s.price * s.num, 0));
const discount = computed(() => {
  const c = pickedCoupon.value;
  if (!c || total.value < c.minSpend) return 0;
  return Math.min(c.amount, total.value);
});
const payable = computed(() => total.value - discount.value);
const usableCount = computed(() => coupons.value.filter((c) => c.usable).length);

async function openCoupons() {
  coupons.value = await api.myCoupons(total.value);
  showCoupons.value = true;
}

function pickCoupon(c: (typeof coupons.value)[number] | null) {
  pickedCoupon.value = c;
  showCoupons.value = false;
}
const minDate = new Date();
const maxDate = new Date(Date.now() + 30 * 86400_000);

function fmtDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 可选时段：10:00-23:00 整点；选今天时过滤掉不足 1 小时提前量的时段
const HOURS = Array.from({ length: 14 }, (_, i) => i + 10);
const isToday = computed(() => appointAt.value === fmtDate(new Date()));
// 玩伴当日已被预约的时段（含待支付占位，服务端为准）
const busyHours = ref<number[]>([]);
const busyAllDay = ref(false);
const slots = computed(() => {
  if (!appointAt.value || busyAllDay.value) return [];
  const minHour = new Date(Date.now() + 3600_000).getHours() + 1;
  const open = isToday.value ? HOURS.filter((h) => h >= minHour) : HOURS;
  return open.filter((h) => !busyHours.value.includes(h));
});

async function loadBusy() {
  busyAllDay.value = false; busyHours.value = [];
  if (!appointAt.value) return;
  try {
    const r = await api.partnerBusy(partnerId, appointAt.value);
    busyAllDay.value = r.allDay; busyHours.value = r.hours;
  } catch { /* 查询失败不阻塞下单，由服务端兜底校验 */ }
}

function onCalendarConfirm(values: Date[]) {
  appointAt.value = fmtDate(values[0]);
  appointHour.value = null;
  showCalendar.value = false;
  loadBusy();
}

async function submit() {
  if (!chosen.value.length) return showToast('请选择服务项目');
  if (!appointAt.value) return showToast('请选择预约日期');
  if (appointHour.value == null) return showToast('请选择预约时段');
  if (!slots.value.length) return showToast('今天已无可约时段，请改约明天');
  const appointDate = new Date(`${appointAt.value}T${String(appointHour.value).padStart(2, '0')}:00:00`);
  if (appointDate.getTime() <= Date.now()) return showToast('预约时间已过，请重新选择');
  if (!agreed.value) return showToast('请先阅读并同意《平台交易规则》');
  submitting.value = true;
  try {
    const order = await api.createOrder({
      partnerId,
      items: chosen.value.map((s) => ({ serviceId: s.id, num: s.num })),
      appointAt: appointDate.toISOString(),
      address: address.value || undefined,
      remark: remark.value || undefined,
      userCouponId: pickedCoupon.value && discount.value > 0 ? pickedCoupon.value.id : undefined,
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
      <div v-if="appointAt" class="oc__slots">
        <div v-if="!slots.length" class="muted oc__slots-empty">
          {{ busyAllDay ? '该日期玩伴已被全天预约，请换一天' : '该日期已无可约时段，请换一天' }}
        </div>
        <div
          v-for="h in slots"
          :key="h"
          class="oc__slot"
          :class="{ 'oc__slot--on': appointHour === h }"
          @click="appointHour = h"
        >
          {{ String(h).padStart(2, '0') }}:00
        </div>
      </div>
      <van-field v-model="address" label="碰面地点" placeholder="选填，如商场/地铁站" maxlength="200" />
      <van-field
        v-model="remark"
        label="备注"
        type="textarea"
        rows="2"
        maxlength="200"
        placeholder="想玩什么、有什么要求，告诉Ta"
      />
    </div>

    <div class="card oc__block">
      <div class="oc__title">费用明细</div>
      <div v-for="s in chosen" :key="s.id" class="oc__fee">
        <span class="muted">{{ s.name }} ×{{ s.num }}</span>
        <span>¥{{ (s.price * s.num).toFixed(0) }}</span>
      </div>
      <van-cell
        :title="pickedCoupon && discount > 0 ? pickedCoupon.title : '优惠券'"
        :value="pickedCoupon && discount > 0 ? `-¥${discount.toFixed(0)}` : usableCount ? `${usableCount}张可用` : '暂无可用'"
        is-link
        :border="false"
        class="oc__coupon"
        @click="openCoupons"
      />
      <van-divider v-if="chosen.length" />
      <div v-if="discount > 0" class="oc__fee">
        <span class="muted">优惠抵扣</span>
        <span class="oc__discount">-¥{{ discount.toFixed(0) }}</span>
      </div>
      <div class="oc__fee oc__fee--total">
        <span>合计</span>
        <span class="price">¥{{ payable.toFixed(0) }}</span>
      </div>
    </div>

    <div class="oc__agree">
      <van-checkbox v-model="agreed" icon-size="14" checked-color="#ff5a5f" />
      <span class="muted">我已阅读并同意《平台交易规则》，知晓服务边界与退款政策</span>
    </div>

    <div class="oc__bar safe-bottom">
      <div class="oc__bar-price">
        <span class="muted">合计</span>
        <span class="price oc__bar-num">¥{{ payable.toFixed(0) }}</span>
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

    <van-popup v-model:show="showCoupons" position="bottom" round class="oc__coupon-pop">
      <div class="oc__coupon-title">选择优惠券</div>
      <div class="oc__coupon-list">
        <div
          v-for="c in coupons.filter((x) => !x.used && !x.expired)"
          :key="c.id"
          class="oc__coupon-item"
          :class="{ 'oc__coupon-item--disabled': !c.usable }"
          @click="c.usable && pickCoupon(c)"
        >
          <div class="oc__coupon-amount"><i>¥</i>{{ c.amount }}</div>
          <div class="oc__coupon-info">
            <div>{{ c.title }}</div>
            <div class="muted">{{ c.minSpend > 0 ? `满${c.minSpend}可用` : '无门槛' }}</div>
          </div>
          <van-tag v-if="!c.usable" plain>未达门槛</van-tag>
          <van-icon v-else-if="pickedCoupon?.id === c.id" name="checked" color="#ff5a5f" size="20" />
        </div>
        <van-empty v-if="!coupons.filter((x) => !x.used && !x.expired).length" description="暂无优惠券" image-size="70" />
      </div>
      <van-button block plain round class="oc__coupon-none" @click="pickCoupon(null)">不使用优惠券</van-button>
    </van-popup>
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
.oc__coupon {
  padding: 0;
}
.oc__coupon-pop {
  padding: 16px 16px 32px;
}
.oc__coupon-title {
  font-weight: 700;
  text-align: center;
  margin-bottom: 12px;
}
.oc__coupon-list {
  max-height: 50vh;
  overflow-y: auto;
}
.oc__coupon-item {
  display: flex;
  align-items: center;
  gap: 12px;
  background: #fff5f5;
  border-radius: 10px;
  padding: 14px;
  margin-bottom: 10px;
}
.oc__coupon-item--disabled {
  background: #f5f6f8;
  opacity: 0.6;
}
.oc__coupon-amount {
  color: #ff5a5f;
  font-size: 26px;
  font-weight: 800;
}
.oc__coupon-amount i {
  font-size: 14px;
  font-style: normal;
}
.oc__coupon-info {
  flex: 1;
}
.oc__coupon-none {
  margin-top: 8px;
}
.oc__discount {
  color: #ff5a5f;
}
.oc__slots {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 4px 16px 14px;
}
.oc__slot {
  padding: 6px 12px;
  border-radius: 8px;
  background: #f5f6f8;
  font-size: 13px;
}
.oc__slot--on {
  background: #ffecec;
  color: #ff5a5f;
  font-weight: 700;
}
.oc__slots-empty {
  padding: 6px 0;
}
</style>