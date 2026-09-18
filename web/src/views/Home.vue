<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, type PartnerCard } from '../api';

const router = useRouter();
import PartnerCardView from '../components/PartnerCard.vue';

const city = ref(localStorage.getItem('dp_city') || '上海');

function openBanner(b: { link: string | null }) {
  if (!b.link) return;
  if (b.link.startsWith('http')) window.open(b.link, '_blank');
  else router.push(b.link);
}
const cities = ref<string[]>([]);
const banners = ref<Array<{ id: string; image: string; link: string | null }>>([]);
const recommend = ref<PartnerCard[]>([]);
const newest = ref<PartnerCard[]>([]);
const showCityPicker = ref(false);
const keyword = ref('');
const loading = ref(true);

async function load() {
  loading.value = true;
  try {
    const res = await api.home();
    banners.value = res.banners;
    recommend.value = res.recommend;
    newest.value = res.newest;
    cities.value = res.cities;
  } finally {
    loading.value = false;
  }
}

function pickCity(c: string) {
  city.value = c;
  localStorage.setItem('dp_city', c);
  showCityPicker.value = false;
}

onMounted(load);
</script>

<template>
  <div class="page home">
    <div class="home__bar">
      <span class="home__city" @click="showCityPicker = true">
        <van-icon name="location-o" /> {{ city }}
      </span>
      <van-search
        v-model="keyword"
        shape="round"
        background="transparent"
        placeholder="搜索玩伴 / 技能"
        readonly
        @click="$router.push('/partners')"
      />
    </div>

    <van-swipe class="home__swipe" :autoplay="3500" indicator-color="#ff5a5f" lazy-render>
      <van-swipe-item v-for="b in banners" :key="b.id">
        <img :src="b.image" class="home__banner" alt="" @click="openBanner(b)" />
      </van-swipe-item>
    </van-swipe>

    <div class="home__quick">
      <div class="home__quick-item" @click="$router.push('/partners?sort=rating')">
        <van-icon name="medal-o" size="26" color="#ff5a5f" /><span>高分玩伴</span>
      </div>
      <div class="home__quick-item" @click="$router.push('/partners?sort=newest')">
        <van-icon name="new-o" size="26" color="#ff9f2a" /><span>最近新人</span>
      </div>
      <div class="home__quick-item" @click="$router.push('/partners?sort=distance')">
        <van-icon name="location-o" size="26" color="#07c160" /><span>附近的人</span>
      </div>
      <div class="home__quick-item" @click="$router.push('/dynamics')">
        <van-icon name="fire-o" size="26" color="#7232dd" /><span>玩伴动态</span>
      </div>
    </div>

    <div class="home__section">
      <div class="home__section-title">
        <span>🔥 人气推荐</span>
        <span class="muted" @click="$router.push('/partners')">查看全部 ›</span>
      </div>
      <PartnerCardView v-for="p in recommend" :key="p.id" :partner="p" />
    </div>

    <div class="home__section">
      <div class="home__section-title">
        <span>✨ 最新入驻</span>
        <span class="muted" @click="$router.push('/partners?sort=newest')">查看全部 ›</span>
      </div>
      <PartnerCardView v-for="p in newest" :key="p.id" :partner="p" />
    </div>

    <van-popup v-model:show="showCityPicker" position="bottom" round>
      <div class="home__picker">
        <div class="home__picker-title">选择城市</div>
        <van-grid :column-num="3" :border="false">
          <van-grid-item v-for="c in cities" :key="c" @click="pickCity(c)">
            <span :class="{ 'home__city--on': c === city }">{{ c }}</span>
          </van-grid-item>
        </van-grid>
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
.home__bar {
  display: flex;
  align-items: center;
  padding: 8px 8px 0;
  background: #fff;
}
.home__city {
  flex-shrink: 0;
  font-size: 14px;
  font-weight: 600;
  padding: 0 4px 0 8px;
  display: flex;
  align-items: center;
  gap: 2px;
}
.home__bar :deep(.van-search) {
  flex: 1;
  padding: 4px 8px 8px 0;
}
.home__swipe {
  margin: 10px 12px 0;
  border-radius: 12px;
  overflow: hidden;
}
.home__banner {
  width: 100%;
  height: 160px;
  object-fit: cover;
  display: block;
}
.home__quick {
  margin: 12px;
  background: #fff;
  border-radius: var(--dp-radius);
  display: flex;
  padding: 14px 0;
}
.home__quick-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--dp-text-2);
}
.home__section {
  padding: 0 12px;
}
.home__section-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 16px;
  font-weight: 700;
  margin: 14px 2px 12px;
}
.home__picker {
  padding: 20px 16px 30px;
}
.home__picker-title {
  font-weight: 700;
  margin-bottom: 16px;
  text-align: center;
}
.home__city--on {
  color: var(--dp-primary);
  font-weight: 700;
}
</style>
