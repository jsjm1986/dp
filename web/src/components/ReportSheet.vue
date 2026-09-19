<script setup lang="ts">
import { ref } from 'vue';
import { showToast } from 'vant';
import { api } from '../api';

const props = defineProps<{
  targetType: 'user' | 'partner' | 'dynamic' | 'comment' | 'order';
  targetId: string;
}>();
const emit = defineEmits<{ done: [] }>();
const show = defineModel<boolean>('show', { default: false });

const REASONS = ['色情低俗', '诈骗引流', '骚扰辱骂', '虚假信息', '违禁服务', '其他'];
const reason = ref('');
const detail = ref('');
const submitting = ref(false);

async function submit() {
  if (!reason.value) return showToast('请选择举报原因');
  submitting.value = true;
  try {
    await api.report({ targetType: props.targetType, targetId: props.targetId, reason: reason.value, detail: detail.value.trim() || undefined });
    showToast('已提交，平台将尽快处理');
    show.value = false;
    reason.value = '';
    detail.value = '';
    emit('done');
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <van-popup v-model:show="show" position="bottom" round>
    <div class="rpt">
      <div class="rpt__title">举报</div>
      <div class="rpt__reasons">
        <span
          v-for="r in REASONS"
          :key="r"
          class="rpt__reason"
          :class="{ 'rpt__reason--on': reason === r }"
          @click="reason = r"
        >{{ r }}</span>
      </div>
      <van-field v-model="detail" type="textarea" rows="2" maxlength="200" placeholder="补充说明（选填）" class="rpt__field" />
      <van-button block round type="danger" :loading="submitting" @click="submit">提交举报</van-button>
    </div>
  </van-popup>
</template>

<style scoped>
.rpt {
  padding: 18px 16px calc(16px + env(safe-area-inset-bottom));
}
.rpt__title {
  font-size: 16px;
  font-weight: 700;
  text-align: center;
  margin-bottom: 14px;
}
.rpt__reasons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.rpt__reason {
  padding: 6px 14px;
  border-radius: 999px;
  background: #f4f5f7;
  font-size: 13px;
}
.rpt__reason--on {
  background: #ff5a5f;
  color: #fff;
}
.rpt__field {
  margin: 12px 0;
  background: #f7f8fa;
  border-radius: 10px;
}
</style>
