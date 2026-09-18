<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { showToast } from 'vant';
import { api } from '../api';
import { useUserStore } from '../stores/user';

const content = ref('');
const images = ref<string[]>([]);
const uploading = ref(false);
const submitting = ref(false);
const store = useUserStore();
const router = useRouter();

async function onUpload(file: File) {
  uploading.value = true;
  try {
    const res = await api.upload(file);
    images.value.push(res.url);
  } finally {
    uploading.value = false;
  }
}

async function submit() {
  if (!content.value.trim() && !images.value.length) return showToast('写点内容或上传图片');
  submitting.value = true;
  try {
    await api.createDynamic({
      content: content.value.trim(),
      images: images.value,
      city: store.user?.city ?? undefined,
    });
    showToast('发布成功');
    router.replace('/dynamics');
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="page page--no-tab">
    <van-nav-bar title="发动态" left-arrow :border="false" @click-left="$router.back()" fixed placeholder />
    <div class="pub__body">
      <van-field
        v-model="content"
        type="textarea"
        rows="6"
        maxlength="1000"
        show-word-limit
        placeholder="分享你的陪伴日常、城市攻略、出片记录..."
      />
      <div class="pub__imgs">
        <van-image v-for="(img, i) in images" :key="i" :src="img" fit="cover" class="pub__img" @click="images.splice(i, 1)" />
        <van-uploader v-if="images.length < 9" :after-read="(f: any) => onUpload(f.file)" :disabled="uploading">
          <div class="pub__add">
            <van-icon v-if="!uploading" name="plus" size="24" color="#999" />
            <van-loading v-else size="20" />
          </div>
        </van-uploader>
      </div>
      <van-button round block type="primary" size="large" :loading="submitting" class="pub__btn" @click="submit">
        发布
      </van-button>
    </div>
  </div>
</template>

<style scoped>
.pub__body {
  padding: 12px;
}
.pub__body :deep(.van-field) {
  border-radius: 12px;
}
.pub__imgs {
  margin-top: 14px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.pub__img {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 8px;
  overflow: hidden;
}
.pub__add {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 8px;
  border: 1px dashed #ddd;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fff;
}
.pub__btn {
  margin-top: 24px;
}
</style>
