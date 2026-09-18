<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showToast } from 'vant';
import { api, type Order } from '../api';

const route = useRoute();
const router = useRouter();
const orderId = route.params.orderId as string;
const order = ref<Order | null>(null);
const rating = ref(5);
const content = ref('');
const submitting = ref(false);

const quickTags = ['人很nice', '准时靠谱', '拍照好看', '会聊天', '路线专业', '下次还约'];

function addTag(t: string) {
  content.value = content.value ? `${content.value}，${t}` : t;
}

async function submit() {
  submitting.value = true;
  try {
    await api.reviewOrder(orderId, rating.value, content.value || undefined);
    showToast('评价成功');
    router.replace('/orders');
  } finally {
    submitting.value = false;
  }
}

onMounted(async () => {
  order.value = await api.order(orderId);
});
</script>

<template>
  <div v-if="order" class="page page--no-tab">
    <van-nav-bar title="评价订单" left-arrow :border="false" @click-left="$router.back()" fixed placeholder />
    <div class="card rv__partner">
      <van-image round width="48" height="48" :src="order.partner.avatar || ''" />
      <div>
        <div class="rv__name">{{ order.partner.nickname }}</div>
        <div class="muted">{{ order.items.map((i) => i.name).join('、') }}</div>
      </div>
    </div>

    <div class="card rv__block">
      <div class="rv__title">服务评分</div>
      <van-rate v-model="rating" size="30" color="#ff9f2a" />
    </div>

    <div class="card rv__block">
      <div class="rv__title">说说这次体验</div>
      <div class="rv__tags">
        <span v-for="t in quickTags" :key="t" class="tag-chip" @click="addTag(t)">{{ t }}</span>
      </div>
      <van-field
        v-model="content"
        type="textarea"
        rows="4"
        maxlength="500"
        show-word-limit
        placeholder="玩伴服务怎么样？分享给其他人参考"
      />
    </div>

    <div class="rv__submit">
      <van-button round block type="primary" size="large" :loading="submitting" @click="submit">
        提交评价
      </van-button>
    </div>
  </div>
</template>

<style scoped>
.rv__partner {
  margin: 12px;
  display: flex;
  gap: 12px;
  align-items: center;
}
.rv__name {
  font-weight: 700;
  font-size: 16px;
}
.rv__block {
  margin: 0 12px 12px;
}
.rv__title {
  font-weight: 700;
  margin-bottom: 12px;
}
.rv__tags {
  margin-bottom: 8px;
}
.rv__submit {
  margin: 24px 16px;
}
</style>
