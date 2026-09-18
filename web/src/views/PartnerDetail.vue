<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showConfirmDialog, showToast } from 'vant';
import { api, type PartnerDetail } from '../api';
import { useUserStore } from '../stores/user';

const route = useRoute();
const router = useRouter();
const store = useUserStore();
const id = route.params.id as string;
const p = ref<PartnerDetail | null>(null);
const showPhone = ref(false);

const statusText: Record<string, string> = { available: '可接单', rest: '休息中', busy: '服务中' };

const baseInfo = computed(() => {
  if (!p.value) return [];
  return [
    { label: '年龄', value: p.value.age ? `${p.value.age}岁` : null },
    { label: '身高', value: p.value.height ? `${p.value.height}cm` : null },
    { label: '体重', value: p.value.weight ? `${p.value.weight}kg` : null },
    { label: '星座', value: p.value.constellation },
    { label: '学历', value: p.value.education },
    { label: '常驻地', value: `${p.value.city}${p.value.district ? '·' + p.value.district : ''}` },
  ].filter((i) => i.value);
});

async function load() {
  p.value = await api.partner(id);
}

async function toggleFollow() {
  if (!store.loggedIn) return router.push({ path: '/login', query: { redirect: route.fullPath } });
  const res = p.value!.followed ? await api.unfollow(id) : await api.follow(id);
  p.value!.followed = res.followed;
  p.value!.followerCount += res.followed ? 1 : -1;
  showToast(res.followed ? '已关注' : '已取消关注');
}

function contact() {
  showConfirmDialog({ title: '解锁微信号', message: '解锁后可查看Ta的微信号并添加好友（演示免费）' })
    .then(() => {
      showPhone.value = true;
    })
    .catch(() => {});
}

function book() {
  if (!store.loggedIn) return router.push({ path: '/login', query: { redirect: route.fullPath } });
  router.push(`/order/create/${id}`);
}

async function copyWx() {
  try {
    await navigator.clipboard.writeText(p.value?.wechatId || '');
    showToast('微信号已复制');
  } catch {
    showToast('复制失败');
  }
}

onMounted(load);
</script>

<template>
  <div v-if="p" class="page page--no-tab detail">
    <van-swipe class="detail__swipe" indicator-color="#fff">
      <van-swipe-item v-for="(img, i) in p.photos" :key="i">
        <img :src="img" class="detail__photo" alt="" />
      </van-swipe-item>
      <van-swipe-item v-if="!p.photos.length">
        <div class="detail__photo detail__photo--empty" />
      </van-swipe-item>
    </van-swipe>
    <van-nav-bar left-arrow :border="false" class="detail__nav" @click-left="$router.back()" />

    <div class="detail__main">
      <div class="detail__head card">
        <div class="detail__name-row">
          <span class="detail__name">{{ p.nickname }}</span>
          <span class="detail__status">
            <i class="status-dot" :class="`status-dot--${p.status}`" />{{ statusText[p.status] || '可接单' }}
          </span>
        </div>
        <div class="detail__badges">
          <span v-if="p.verified" class="detail__badge detail__badge--green"><van-icon name="certificate" /> 实名认证</span>
          <span class="detail__badge"><van-icon name="shield-o" /> 平台保障</span>
          <span class="detail__badge"><van-icon name="refund-o" /> 爽约包退</span>
          <span class="detail__badge"><van-icon name="leaf" /> 绿色服务</span>
        </div>
        <div class="detail__stats">
          <span>★{{ p.rating.toFixed(1) }}</span>
          <span class="muted">已服务{{ p.serviceCount }}单</span>
          <span class="muted">{{ p.viewCount }}访客</span>
          <span class="muted">{{ p.followerCount }}人关注</span>
        </div>
        <div v-if="p.bio" class="detail__bio">{{ p.bio }}</div>
        <div class="detail__tags">
          <span v-for="t in p.tags" :key="t" class="tag-chip">{{ t }}</span>
        </div>
      </div>

      <div class="card detail__block">
        <div class="detail__block-title">基本信息</div>
        <van-grid :column-num="3" :border="false">
          <van-grid-item v-for="i in baseInfo" :key="i.label">
            <div class="detail__info-value">{{ i.value }}</div>
            <div class="muted">{{ i.label }}</div>
          </van-grid-item>
        </van-grid>
      </div>

      <div class="card detail__block">
        <div class="detail__block-title">
          服务项目
          <span class="muted detail__block-more" @click="book">立即预约 ›</span>
        </div>
        <div v-for="s in p.services" :key="s.id" class="detail__svc">
          <div>
            <div class="detail__svc-name">{{ s.name }}</div>
            <div class="muted" v-if="s.miniNum > 1">{{ s.miniNum }}{{ s.unit }}起订</div>
          </div>
          <div class="price">¥{{ s.price }}/{{ s.unit }}</div>
        </div>
      </div>

      <div class="card detail__block">
        <div class="detail__block-title">评价（{{ p.reviewCount }}）</div>
        <template v-if="p.reviews.length">
          <div v-for="r in p.reviews" :key="r.id" class="detail__review">
            <van-image round width="28" height="28" :src="r.user.avatar || ''" />
            <div class="detail__review-body">
              <div class="detail__review-head">
                <span>{{ r.user.nickname }}</span>
                <span class="detail__review-stars">{{ '★'.repeat(r.rating) }}{{ '☆'.repeat(5 - r.rating) }}</span>
              </div>
              <div class="detail__review-text">{{ r.content }}</div>
            </div>
          </div>
        </template>
        <van-empty v-else description="暂无评价" image-size="60" />
      </div>
    </div>

    <div class="detail__bar safe-bottom">
      <div class="detail__bar-btn" @click="toggleFollow">
        <van-icon :name="p.followed ? 'like' : 'like-o'" :color="p.followed ? '#ff5a5f' : '#666'" size="22" />
        <span>{{ p.followed ? '已关注' : '关注' }}</span>
      </div>
      <div class="detail__bar-btn" @click="contact">
        <van-icon name="chat-o" color="#666" size="22" />
        <span>联系Ta</span>
      </div>
      <van-button round block type="primary" :disabled="p.status === 'rest'" class="detail__bar-book" @click="book">
        {{ p.status === 'rest' ? '休息中' : '立即预约' }}
      </van-button>
    </div>

    <van-dialog v-model:show="showPhone" title="Ta的微信号" confirm-button-text="一键复制" @confirm="copyWx">
      <div class="detail__wx">{{ p.wechatId || '对方暂未设置' }}</div>
    </van-dialog>
  </div>
</template>

<style scoped>
.detail {
  position: relative;
}
.detail__swipe {
  height: 300px;
  background: #ddd;
}
.detail__photo {
  width: 100%;
  height: 300px;
  object-fit: cover;
}
.detail__photo--empty {
  background: linear-gradient(135deg, #ffd1dc, #e0c3fc);
}
.detail__nav {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  background: transparent;
}
.detail__main {
  margin: -20px 12px 0;
  position: relative;
}
.detail__head {
  padding: 16px;
}
.detail__name-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.detail__name {
  font-size: 20px;
  font-weight: 800;
}
.detail__status {
  font-size: 12px;
  color: var(--dp-text-2);
}
.detail__badges {
  margin-top: 10px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.detail__badge {
  font-size: 10px;
  color: #b8860b;
  background: #fdf3e0;
  padding: 2px 7px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 2px;
}
.detail__badge--green {
  color: #07c160;
  background: #e8f8ee;
}
.detail__stats {
  margin-top: 10px;
  display: flex;
  gap: 12px;
  font-size: 13px;
}
.detail__stats > span:first-child {
  color: #ff9f2a;
  font-weight: 700;
}
.detail__bio {
  margin-top: 10px;
  font-size: 13px;
  color: var(--dp-text-2);
  line-height: 1.6;
}
.detail__tags {
  margin-top: 10px;
}
.detail__block {
  margin-top: 12px;
}
.detail__block-title {
  font-weight: 700;
  font-size: 15px;
  margin-bottom: 10px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.detail__block-more {
  font-weight: 400;
}
.detail__info-value {
  font-weight: 600;
  font-size: 14px;
  margin-bottom: 2px;
}
.detail__svc {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 0;
  border-top: 1px solid #f5f5f5;
}
.detail__svc:first-of-type {
  border-top: none;
}
.detail__svc-name {
  font-size: 14px;
}
.detail__review {
  display: flex;
  gap: 10px;
  padding: 10px 0;
  border-top: 1px solid #f5f5f5;
}
.detail__review:first-of-type {
  border-top: none;
}
.detail__review-head {
  display: flex;
  gap: 10px;
  font-size: 13px;
}
.detail__review-stars {
  color: #ff9f2a;
}
.detail__review-text {
  margin-top: 4px;
  font-size: 13px;
  color: var(--dp-text-2);
}
.detail__bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  max-width: 750px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  gap: 16px;
  background: #fff;
  padding: 10px 16px;
  box-shadow: 0 -2px 12px rgba(0, 0, 0, 0.06);
}
.detail__bar-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  font-size: 10px;
  color: var(--dp-text-2);
  gap: 2px;
}
.detail__bar-book {
  flex: 1;
}
.detail__wx {
  padding: 24px;
  text-align: center;
  font-size: 18px;
  font-weight: 700;
}
</style>
