<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { showConfirmDialog, showToast } from 'vant';
import { api } from '../api';
import { useUserStore } from '../stores/user';
import ReportSheet from '../components/ReportSheet.vue';

interface Msg {
  id: string;
  senderId: string;
  content: string;
  createdAt: string;
}

const route = useRoute();
const store = useUserStore();
const peerId = computed(() => route.params.peerId as string);
const orderId = computed(() => (route.query.orderId as string) || undefined);

const peer = ref<{ id: string; nickname: string; avatar: string | null } | null>(null);
const items = ref<Msg[]>([]);
const draft = ref('');
const sending = ref(false);
const blocked = ref(false);
const listEl = ref<HTMLElement>();
let timer: ReturnType<typeof setInterval> | undefined;

async function load(first = false) {
  const res = await api.chatMessages(peerId.value);
  const grew = res.items.length > items.value.length;
  peer.value = res.peer;
  items.value = res.items;
  if (first || grew) scrollBottom();
}

async function send() {
  const content = draft.value.trim();
  if (!content || sending.value) return;
  sending.value = true;
  try {
    await api.sendMessage({ peerId: peerId.value, content, orderId: orderId.value });
    draft.value = '';
    await load();
    scrollBottom();
  } finally {
    sending.value = false;
  }
}

function scrollBottom() {
  nextTick(() => {
    if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight;
  });
}

function fmt(t: string) {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const menuOpen = ref(false);
const reportOpen = ref(false);

function onMenuSelect(action: { name: string }) {
  menuOpen.value = false;
  if (action.name === '举报对方') reportOpen.value = true;
  else toggleBlock();
}

async function toggleBlock() {
  if (!blocked.value) {
    try {
      await showConfirmDialog({ title: '拉黑对方', message: '拉黑后将无法互相发消息，确认拉黑？' });
    } catch { return; }
  }
  const res = blocked.value
    ? await api.unblockUser(peerId.value)
    : await api.blockUser(peerId.value);
  blocked.value = res.blocked;
  showToast(res.blocked ? '已拉黑' : '已解除');
}

onMounted(async () => {
  load(true);
  timer = setInterval(() => load(), 5000);
  try {
    const blocks = await api.myBlocks();
    blocked.value = blocks.some((b) => b.id === peerId.value);
  } catch { /* ignore */ }
});
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <div class="chat">
    <van-nav-bar :title="peer?.nickname || '聊天'" left-arrow @click-left="$router.back()">
      <template #right>
        <van-icon name="ellipsis" size="18" @click="menuOpen = true" />
      </template>
    </van-nav-bar>
    <van-action-sheet
      v-model:show="menuOpen"
      :actions="[{ name: blocked ? '解除拉黑' : '拉黑对方' }, { name: '举报对方' }]"
      cancel-text="取消"
      @select="onMenuSelect"
    />
    <ReportSheet v-model:show="reportOpen" target-type="user" :target-id="peerId" />

    <div ref="listEl" class="chat__list">
      <div
        v-for="m in items"
        :key="m.id"
        class="chat__row"
        :class="{ 'chat__row--me': m.senderId === store.user?.id }"
      >
        <van-image
          round
          width="38"
          height="38"
          :src="m.senderId === store.user?.id ? store.user?.avatar || '' : peer?.avatar || ''"
        />
        <div class="chat__bubble-wrap">
          <div class="chat__bubble">{{ m.content }}</div>
          <div class="chat__time">{{ fmt(m.createdAt) }}</div>
        </div>
      </div>
      <van-empty v-if="!items.length" description="打个招呼吧" />
    </div>

    <div class="chat__input">
      <van-field
        v-model="draft"
        placeholder="说点什么…"
        maxlength="500"
        @keyup.enter="send"
      />
      <van-button type="primary" size="small" round :loading="sending" :disabled="!draft.trim()" @click="send">
        发送
      </van-button>
    </div>
  </div>
</template>

<style scoped>
.chat {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #f5f6f8;
}
.chat__list {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}
.chat__row {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
  align-items: flex-start;
}
.chat__row--me {
  flex-direction: row-reverse;
}
.chat__bubble-wrap {
  max-width: 70%;
}
.chat__row--me .chat__bubble-wrap {
  text-align: right;
}
.chat__bubble {
  display: inline-block;
  padding: 10px 13px;
  border-radius: 12px;
  background: #fff;
  font-size: 15px;
  line-height: 1.45;
  text-align: left;
  word-break: break-word;
}
.chat__row--me .chat__bubble {
  background: #ff5a5f;
  color: #fff;
}
.chat__time {
  font-size: 10px;
  color: #aaa;
  margin-top: 3px;
}
.chat__input {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px calc(8px + env(safe-area-inset-bottom));
  background: #fff;
}
.chat__input .van-field {
  background: #f5f6f8;
  border-radius: 20px;
  padding: 8px 14px;
}
</style>
