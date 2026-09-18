<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api';

interface Conv {
  peer: { id: string; nickname: string; avatar: string | null };
  lastMessage: { content: string; createdAt: string; fromMe: boolean };
  unread: number;
}

const router = useRouter();
const list = ref<Conv[]>([]);
const loading = ref(false);
let timer: ReturnType<typeof setInterval> | undefined;

async function load() {
  try {
    list.value = await api.conversations();
  } finally {
    loading.value = false;
  }
}

function fmt(t: string) {
  const d = new Date(t);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    : `${d.getMonth() + 1}/${d.getDate()}`;
}

onMounted(() => {
  load();
  timer = setInterval(load, 8000);
});
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <div class="page">
    <van-nav-bar title="消息" />

    <van-list :loading="loading">
      <van-cell
        v-for="c in list"
        :key="c.peer.id"
        class="conv"
        @click="router.push(`/chat/${c.peer.id}`)"
      >
        <template #icon>
          <van-badge :content="c.unread || ''" :show-zero="false" class="conv__badge">
            <van-image round width="48" height="48" :src="c.peer.avatar || ''" />
          </van-badge>
        </template>
        <template #title>
          <span class="conv__name">{{ c.peer.nickname }}</span>
        </template>
        <template #label>
          <span class="conv__msg">{{ c.lastMessage.fromMe ? '我：' : '' }}{{ c.lastMessage.content }}</span>
        </template>
        <template #right-icon>
          <span class="conv__time">{{ fmt(c.lastMessage.createdAt) }}</span>
        </template>
      </van-cell>
      <van-empty v-if="!loading && !list.length" description="暂无消息，去和玩伴聊聊吧" />
    </van-list>
  </div>
</template>

<style scoped>
.conv__badge {
  margin-right: 12px;
}
.conv__name {
  font-weight: 600;
  font-size: 15px;
}
.conv__msg {
  display: block;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.conv__time {
  color: #999;
  font-size: 12px;
}
</style>
