<script setup lang="ts">
import type { PartnerCard } from '../api';

defineProps<{ partner: PartnerCard }>();

const statusText: Record<string, string> = {
  available: '可接单',
  rest: '休息中',
  busy: '服务中',
};
</script>

<template>
  <div class="pcard card" @click="$router.push(`/partner/${partner.id}`)">
    <div class="pcard__cover">
      <img :src="partner.cover || partner.avatar || ''" :alt="partner.nickname" loading="lazy" />
      <span class="pcard__status">
        <i class="status-dot" :class="`status-dot--${partner.status}`" />{{ statusText[partner.status] || '可接单' }}
      </span>
    </div>
    <div class="pcard__body">
      <div class="pcard__name">
        {{ partner.nickname }}
        <van-icon v-if="partner.verified" name="certificate" color="#07c160" size="14" />
        <van-icon v-if="partner.gender === 'female'" name="like" color="#ff5a5f" size="12" />
      </div>
      <div class="pcard__meta">
        <span v-if="partner.age">{{ partner.age }}岁</span>
        <span>{{ partner.city }}<template v-if="partner.district">·{{ partner.district }}</template></span>
        <span v-if="partner.distance != null">距您{{ partner.distance }}km</span>
      </div>
      <div class="pcard__tags">
        <span v-for="t in partner.tags.slice(0, 3)" :key="t" class="tag-chip">{{ t }}</span>
      </div>
      <div class="pcard__foot">
        <span class="pcard__rating">★{{ partner.rating.toFixed(1) }}</span>
        <span class="muted">已服务{{ partner.serviceCount }}单 · {{ partner.followerCount }}人关注</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pcard {
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
}
.pcard__cover {
  position: relative;
  width: 108px;
  height: 136px;
  flex-shrink: 0;
  border-radius: 10px;
  overflow: hidden;
  background: #eee;
}
.pcard__cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.pcard__status {
  position: absolute;
  left: 6px;
  bottom: 6px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 8px;
}
.pcard__body {
  flex: 1;
  min-width: 0;
}
.pcard__name {
  font-size: 16px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 4px;
}
.pcard__meta {
  margin-top: 4px;
  font-size: 12px;
  color: var(--dp-text-2);
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.pcard__tags {
  margin-top: 8px;
}
.pcard__foot {
  margin-top: 8px;
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.pcard__rating {
  color: #ff9f2a;
  font-weight: 700;
  font-size: 14px;
}
</style>
