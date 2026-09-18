<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api, type PartnerCard } from '../api';
import PartnerCardView from '../components/PartnerCard.vue';

const route = useRoute();
const keyword = ref('');
const city = ref(localStorage.getItem('dp_city') || '');
const sort = ref((route.query.sort as string) || 'default');
const items = ref<PartnerCard[]>([]);
const page = ref(1);
const total = ref(0);
const loading = ref(false);
const finished = ref(false);
const showCityPicker = ref(false);
const cities = ref(['', '上海', '北京', '杭州', '成都', '广州', '深圳']);
const locating = ref(false);
const myPos = ref<{ lat: number; lng: number } | null>(null);

const sorts = [
  { label: '默认排序', value: 'default' },
  { label: '评分最高', value: 'rating' },
  { label: '最近新人', value: 'newest' },
  { label: '离我最近', value: 'distance' },
];

async function load(reset = false) {
  if (reset) {
    page.value = 1;
    items.value = [];
    finished.value = false;
  }
  loading.value = true;
  try {
    const res = await api.partners({
      page: page.value,
      pageSize: 10,
      sort: sort.value,
      ...(city.value ? { city: city.value } : {}),
      ...(keyword.value ? { keyword: keyword.value } : {}),
      ...(myPos.value ? { lat: myPos.value.lat, lng: myPos.value.lng } : {}),
    });
    total.value = res.total;
    items.value = reset ? res.items : [...items.value, ...res.items];
    finished.value = items.value.length >= res.total;
    page.value += 1;
  } finally {
    loading.value = false;
  }
}

function pickSort(v: string) {
  sort.value = v;
  if (v === 'distance' && !myPos.value) locate();
  load(true);
}

function locate() {
  if (!navigator.geolocation) return;
  locating.value = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      myPos.value = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      locating.value = false;
      if (sort.value === 'distance') load(true);
    },
    () => (locating.value = false),
    { timeout: 5000 },
  );
}

function pickCity(c: string) {
  city.value = c;
  if (c) localStorage.setItem('dp_city', c);
  showCityPicker.value = false;
  load(true);
}

// 搜索防抖：仅 watch 驱动加载（不再同时绑 @update），300ms 合并键击
let kwTimer: ReturnType<typeof setTimeout> | undefined;
watch(keyword, () => {
  clearTimeout(kwTimer);
  kwTimer = setTimeout(() => load(true), 300);
});
// 路由 query 变化（首页快捷入口跳不同 sort）需响应
watch(
  () => route.query.sort,
  (v) => {
    if (v && v !== sort.value) pickSort(v as string);
  },
);
onMounted(() => {
  locate();
  load(true);
});
</script>

<template>
  <div class="page partners">
    <van-nav-bar title="玩伴" fixed placeholder :border="false" />
    <div class="partners__filters">
      <van-search
        v-model="keyword"
        shape="round"
        placeholder="搜索昵称 / 技能标签"
      />
      <div class="partners__bar">
        <span
          v-for="s in sorts"
          :key="s.value"
          class="partners__sort"
          :class="{ 'partners__sort--on': sort === s.value }"
          @click="pickSort(s.value)"
        >
          {{ s.label }}
          <van-loading v-if="s.value === 'distance' && locating" size="12" />
        </span>
        <span class="partners__sort partners__sort--city" @click="showCityPicker = true">
          <van-icon name="location-o" />{{ city || '全国' }}
        </span>
      </div>
    </div>

    <div class="partners__list">
      <van-list
        :loading="loading"
        :finished="finished"
        finished-text="没有更多了"
        @load="load()"
      >
        <PartnerCardView v-for="p in items" :key="p.id" :partner="p" />
        <van-empty v-if="!loading && !items.length" description="附近暂无玩伴，换个城市看看" />
      </van-list>
    </div>

    <van-popup v-model:show="showCityPicker" position="bottom" round>
      <div class="partners__picker">
        <div class="partners__picker-title">选择城市</div>
        <van-grid :column-num="3" :border="false">
          <van-grid-item v-for="c in cities" :key="c" @click="pickCity(c)">
            <span :class="{ 'partners__city--on': c === city }">{{ c || '全国' }}</span>
          </van-grid-item>
        </van-grid>
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
.partners__filters {
  background: #fff;
  position: sticky;
  top: 46px;
  z-index: 10;
}
.partners__bar {
  display: flex;
  align-items: center;
  padding: 0 12px 10px;
  gap: 16px;
  font-size: 13px;
  color: var(--dp-text-2);
}
.partners__sort {
  display: flex;
  align-items: center;
  gap: 3px;
}
.partners__sort--on {
  color: var(--dp-primary);
  font-weight: 700;
}
.partners__sort--city {
  margin-left: auto;
  color: var(--dp-primary);
}
.partners__list {
  padding: 12px;
}
.partners__picker {
  padding: 20px 16px 30px;
}
.partners__picker-title {
  font-weight: 700;
  margin-bottom: 16px;
  text-align: center;
}
.partners__city--on {
  color: var(--dp-primary);
  font-weight: 700;
}
</style>
