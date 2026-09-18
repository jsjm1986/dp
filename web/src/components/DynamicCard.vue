<script setup lang="ts">
import { api, type Dynamic } from '../api';
import { useUserStore } from '../stores/user';
import { showImagePreview, showToast } from 'vant';
import { useRouter } from 'vue-router';

const props = defineProps<{ item: Dynamic }>();
const emit = defineEmits<{ changed: [item: Dynamic]; comment: [id: string] }>();
const store = useUserStore();
const router = useRouter();

async function toggleLike() {
  if (!store.loggedIn) return showToast('请先登录');
  const res = props.item.liked
    ? await api.unlikeDynamic(props.item.id)
    : await api.likeDynamic(props.item.id);
  emit('changed', { ...props.item, liked: res.liked, likeCount: res.likeCount });
}

function goPartner() {
  if (props.item.author.partnerId) router.push(`/partner/${props.item.author.partnerId}`);
}

function preview(i: number) {
  showImagePreview({ images: props.item.images, startPosition: i });
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600000)}小时前`;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
</script>

<template>
  <div class="dcard card">
    <div class="dcard__head">
      <van-image round width="40" height="40" :src="item.author.avatar || ''" @click="goPartner" />
      <div class="dcard__who">
        <div class="dcard__name">
          {{ item.author.nickname }}
          <span v-if="item.author.partnerId" class="dcard__badge">玩伴</span>
        </div>
        <div class="muted">{{ fmtTime(item.createdAt) }}<template v-if="item.city"> · {{ item.city }}</template></div>
      </div>
    </div>
    <div class="dcard__content">{{ item.content }}</div>
    <div v-if="item.images.length" class="dcard__imgs" :class="{ 'dcard__imgs--single': item.images.length === 1 }">
      <van-image
        v-for="(img, i) in item.images"
        :key="i"
        :src="img"
        fit="cover"
        lazy-load
        @click="preview(i)"
      />
    </div>
    <div class="dcard__foot">
      <span class="dcard__act" :class="{ 'dcard__act--on': item.liked }" @click="toggleLike">
        <van-icon :name="item.liked ? 'like' : 'like-o'" /> {{ item.likeCount || '赞' }}
      </span>
      <span class="dcard__act" @click="$emit('comment', item.id)">
        <van-icon name="comment-o" /> {{ item.commentCount || '评论' }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.dcard {
  margin-bottom: 12px;
}
.dcard__head {
  display: flex;
  gap: 10px;
  align-items: center;
}
.dcard__name {
  font-weight: 600;
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.dcard__badge {
  font-size: 10px;
  color: var(--dp-primary);
  border: 1px solid var(--dp-primary);
  border-radius: 6px;
  padding: 0 4px;
}
.dcard__content {
  margin-top: 10px;
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
}
.dcard__imgs {
  margin-top: 10px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
.dcard__imgs :deep(.van-image) {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 8px;
  overflow: hidden;
}
.dcard__imgs--single :deep(.van-image) {
  aspect-ratio: 4 / 3;
}
.dcard__foot {
  margin-top: 12px;
  display: flex;
  gap: 28px;
}
.dcard__act {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: var(--dp-text-2);
}
.dcard__act--on {
  color: var(--dp-primary);
}
</style>
