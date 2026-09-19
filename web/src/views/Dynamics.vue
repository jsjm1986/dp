<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, type CommentRow, type Dynamic } from '../api';
import DynamicCard from '../components/DynamicCard.vue';
import { useUserStore } from '../stores/user';
import { showToast } from 'vant';

const store = useUserStore();
const items = ref<Dynamic[]>([]);
const tab = ref<'recommend' | 'follow'>('recommend');
const page = ref(1);
const loading = ref(false);
const finished = ref(false);

const commentFor = ref<string | null>(null);
const showComments = computed({
  get: () => commentFor.value !== null,
  set: (v: boolean) => {
    if (!v) commentFor.value = null;
  },
});
const comments = ref<CommentRow[]>([]);
const commentText = ref('');
const sendingComment = ref(false);

async function load(reset = false) {
  if (loading.value && !reset) return;
  if (reset) {
    page.value = 1;
    items.value = [];
    finished.value = false;
  }
  loading.value = true;
  try {
    const res = await api.dynamics(page.value, tab.value === 'follow' ? 'follow' : undefined);
    items.value = reset ? res.items : [...items.value, ...res.items];
    finished.value = items.value.length >= res.total;
    page.value += 1;
  } finally {
    loading.value = false;
  }
}

function onChanged(updated: Dynamic) {
  const i = items.value.findIndex((d) => d.id === updated.id);
  if (i >= 0) items.value[i] = updated;
}

async function openComments(id: string) {
  if (!store.loggedIn) return showToast('请先登录');
  commentFor.value = id;
  commentText.value = '';
  comments.value = await api.comments(id);
}

async function sendComment() {
  if (!commentText.value.trim() || !commentFor.value) return;
  sendingComment.value = true;
  try {
    const res = await api.comment(commentFor.value, commentText.value.trim());
    comments.value.push(res);
    commentText.value = '';
    const i = items.value.findIndex((d) => d.id === commentFor.value);
    if (i >= 0) items.value[i] = { ...items.value[i], commentCount: res.commentCount };
  } finally {
    sendingComment.value = false;
  }
}

function onTabChange(name: string | number) {
  tab.value = name as 'recommend' | 'follow';
  load(true);
}

onMounted(() => load(true));
</script>

<template>
  <div class="page dynamics">
    <van-nav-bar title="玩伴动态" fixed placeholder :border="false">
      <template #right>
        <van-icon name="edit" size="20" @click="$router.push('/dynamic/publish')" />
      </template>
    </van-nav-bar>

    <van-tabs :active="tab" sticky offset-top="46" @change="onTabChange">
      <van-tab title="推荐" name="recommend" />
      <van-tab title="关注" name="follow" />
    </van-tabs>

    <div class="dynamics__list">
      <van-list :loading="loading" :finished="finished" finished-text="没有更多了" @load="load()">
        <DynamicCard
          v-for="d in items"
          :key="d.id"
          :item="d"
          @changed="onChanged"
          @comment="openComments"
        />
        <van-empty v-if="!loading && !items.length" :description="tab === 'follow' ? '关注的玩伴还没发动态' : '还没有动态，来发第一条吧'" />
      </van-list>
    </div>

    <van-popup v-model:show="showComments" position="bottom" round :style="{ height: '60%' }">
      <div class="comments">
        <div class="comments__title">评论</div>
        <div class="comments__list">
          <div v-for="c in comments" :key="c.id" class="comments__item">
            <van-image round width="28" height="28" :src="c.user.avatar || ''" />
            <div>
              <div class="muted">{{ c.user.nickname }}</div>
              <div class="comments__text">{{ c.content }}</div>
            </div>
          </div>
          <van-empty v-if="!comments.length" description="还没有评论" image-size="60" />
        </div>
        <div class="comments__input">
          <van-field v-model="commentText" placeholder="说点什么..." />
          <van-button type="primary" size="small" :loading="sendingComment" @click="sendComment">发送</van-button>
        </div>
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
.dynamics__list {
  padding: 12px;
}
.comments {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.comments__title {
  text-align: center;
  font-weight: 700;
  padding: 16px 0 8px;
}
.comments__list {
  flex: 1;
  overflow-y: auto;
  padding: 0 16px;
}
.comments__item {
  display: flex;
  gap: 10px;
  padding: 10px 0;
}
.comments__text {
  margin-top: 2px;
  font-size: 14px;
}
.comments__input {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 8px 12px;
  border-top: 1px solid #f0f0f0;
}
.comments__input :deep(.van-field) {
  background: #f5f5f5;
  border-radius: 18px;
}
</style>
