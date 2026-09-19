<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { showToast } from 'vant';
import { api, type PartnerProfile } from '../api';
import { useUserStore } from '../stores/user';

const router = useRouter();
const store = useUserStore();
const editMode = ref(false);

const city = ref('');
const district = ref('');
const age = ref<number | undefined>();
const realName = ref('');
const idCard = ref('');
const bio = ref('');
const tagInput = ref('');
const tags = ref<string[]>([]);
const photos = ref<string[]>([]);
const services = ref<Array<{ name: string; price: number | undefined; unit: string; miniNum: number }>>([]);
const uploading = ref(false);
const submitting = ref(false);
const showCityPicker = ref(false);
const cities = ['上海', '北京', '杭州', '成都', '广州', '深圳'];
const quickTags = ['城市漫步', '拍照陪玩', '美食探店', '剧本杀', '博物馆讲解', '运动陪伴', '喝茶聊天', '代排队'];

const units = ['小时', '次', '天', '半日'];

function addTag(t: string) {
  const v = t.trim();
  if (v && !tags.value.includes(v) && tags.value.length < 8) tags.value.push(v);
  tagInput.value = '';
}

function addService() {
  if (services.value.length >= 10) return;
  services.value.push({ name: '', price: undefined, unit: '小时', miniNum: 1 });
}

async function onUpload(file: File) {
  uploading.value = true;
  try {
    const res = await api.upload(file);
    photos.value.push(res.url);
  } finally {
    uploading.value = false;
  }
}

async function submit() {
  if (!city.value) return showToast('请选择常驻城市');
  if (!services.value.length) return showToast('请至少添加一个服务项目');
  for (const s of services.value) {
    if (!s.name.trim()) return showToast('服务项目名称不能为空');
    if (!s.price || s.price <= 0) return showToast(`「${s.name}」请填写价格`);
  }
  submitting.value = true;
  try {
    const payload = {
      city: city.value,
      district: district.value || undefined,
      age: age.value || undefined,
      bio: bio.value || undefined,
      tags: tags.value,
      photos: photos.value,
      realName: realName.value.trim() || undefined,
      idCard: idCard.value.trim() || undefined,
      services: services.value.map((s) => ({
        name: s.name.trim(),
        price: Number(s.price),
        unit: s.unit,
        miniNum: s.miniNum,
      })),
    };
    if (editMode.value) {
      await api.updatePartnerProfile(payload);
      // 服务端会把审核状态打回 pending——必须明确告知，否则用户以为资料立即生效
      showToast('资料已更新，需重新审核后生效');
      router.back();
    } else {
      await api.partnerApply(payload);
      showToast('已提交，等待平台审核');
      await store.refresh();
      router.replace('/partner/console');
    }
  } finally {
    submitting.value = false;
  }
}

onMounted(async () => {
  if (store.user?.partnerId) {
    editMode.value = true;
    const p: PartnerProfile = await api.partnerProfile();
    city.value = p.city;
    district.value = p.district ?? '';
    age.value = p.age ?? undefined;
    realName.value = p.realName ?? '';
    idCard.value = p.idCard ?? '';
    bio.value = p.bio ?? '';
    tags.value = p.tags ?? [];
    photos.value = p.photos ?? [];
    services.value = p.services.map((s) => ({ name: s.name, price: s.price, unit: s.unit, miniNum: s.miniNum }));
  }
});
</script>

<template>
  <div class="page page--no-tab">
    <van-nav-bar :title="editMode ? '编辑玩伴资料' : '申请成为玩伴'" left-arrow :border="false" @click-left="$router.back()" fixed placeholder />

    <div class="pa__hero">
      <div class="pa__hero-title">把你的城市，变成别人的旅行</div>
      <div class="pa__hero-sub">自由定价 · 灵活接单 · 平台担保结算</div>
    </div>

    <div class="card pa__block">
      <div class="pa__title">基本信息</div>
      <van-cell title="常驻城市" :value="city || '请选择'" is-link @click="showCityPicker = true" />
      <van-field v-model="district" label="常驻区域" placeholder="如 徐汇区" maxlength="30" />
      <van-field v-model.number="age" type="digit" label="年龄" placeholder="如 24" maxlength="2" />
      <van-field v-model="realName" label="真实姓名" placeholder="实名认证，仅平台审核可见" maxlength="20" />
      <van-field v-model="idCard" label="身份证号" placeholder="实名认证，仅平台审核可见" maxlength="18" />
      <van-field
        v-model="bio"
        label="个人介绍"
        type="textarea"
        rows="3"
        maxlength="200"
        show-word-limit
        placeholder="介绍你自己：擅长什么、能提供什么体验"
      />
    </div>

    <div class="card pa__block">
      <div class="pa__title">技能标签（{{ tags.length }}/8）</div>
      <div class="pa__tags">
        <span v-for="t in tags" :key="t" class="tag-chip" @click="tags.splice(tags.indexOf(t), 1)">{{ t }} ×</span>
      </div>
      <van-field v-model="tagInput" placeholder="输入标签后回车添加" maxlength="20" @keydown.enter.prevent="addTag(tagInput)" />
      <div class="pa__quick">
        <span v-for="t in quickTags" :key="t" class="pa__quick-tag" @click="addTag(t)">{{ t }}</span>
      </div>
    </div>

    <div class="card pa__block">
      <div class="pa__title">相册（{{ photos.length }}/9）</div>
      <div class="pa__photos">
        <van-image v-for="(img, i) in photos" :key="i" :src="img" fit="cover" class="pa__photo" @click="photos.splice(i, 1)" />
        <van-uploader v-if="photos.length < 9" :after-read="(f: any) => onUpload(f.file)" :disabled="uploading">
          <div class="pa__photo-add"><van-icon name="plus" size="22" color="#999" /></div>
        </van-uploader>
      </div>
      <div class="muted">点击图片可删除</div>
    </div>

    <div class="card pa__block">
      <div class="pa__title">
        服务项目
        <van-button size="mini" type="primary" plain icon="plus" @click="addService">添加</van-button>
      </div>
      <div v-for="(s, i) in services" :key="i" class="pa__svc">
        <div class="pa__svc-head">
          <van-field v-model="s.name" placeholder="服务名称，如 城市陪同漫步" maxlength="30" />
          <van-icon name="cross" color="#999" @click="services.splice(i, 1)" />
        </div>
        <div class="pa__svc-row">
          <van-field v-model.number="s.price" type="digit" label="价格" placeholder="99" />
          <div class="pa__svc-units">
            <span
              v-for="u in units"
              :key="u"
              class="pa__unit"
              :class="{ 'pa__unit--on': s.unit === u }"
              @click="s.unit = u"
            >{{ u }}</span>
          </div>
        </div>
        <div class="pa__svc-row">
          <span class="pa__svc-label">最低起订</span>
          <van-stepper v-model="s.miniNum" min="1" max="10" theme="round" button-size="20" />
          <span class="muted">{{ s.unit }}</span>
        </div>
      </div>
      <van-empty v-if="!services.length" description="还没有服务项目，点右上角添加" image-size="60" />
    </div>

    <div class="pa__submit">
      <van-button round block type="primary" size="large" :loading="submitting" @click="submit">
        {{ editMode ? '保存修改' : '提交入驻' }}
      </van-button>
      <div class="muted pa__tip">提交即表示同意《玩伴服务协议》，请确保提供绿色合规的陪伴服务</div>
    </div>

    <van-popup v-model:show="showCityPicker" position="bottom" round>
      <div class="pa__picker">
        <div class="pa__picker-title">选择常驻城市</div>
        <van-grid :column-num="3" :border="false">
          <van-grid-item v-for="c in cities" :key="c" @click="city = c; showCityPicker = false">
            <span :class="{ 'pa__city--on': c === city }">{{ c }}</span>
          </van-grid-item>
        </van-grid>
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
.pa__hero {
  padding: 20px 20px 16px;
  background: linear-gradient(135deg, #fff0f1, #fff);
}
.pa__hero-title {
  font-size: 18px;
  font-weight: 800;
}
.pa__hero-sub {
  margin-top: 4px;
  font-size: 12px;
  color: var(--dp-text-2);
}
.pa__block {
  margin: 12px;
}
.pa__title {
  font-weight: 700;
  margin-bottom: 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.pa__tags {
  margin-bottom: 4px;
}
.pa__quick {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.pa__quick-tag {
  font-size: 11px;
  color: var(--dp-text-2);
  border: 1px dashed #ccc;
  border-radius: 10px;
  padding: 2px 8px;
}
.pa__photos {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 6px;
}
.pa__photo {
  width: 100%;
  aspect-ratio: 3 / 4;
  border-radius: 8px;
  overflow: hidden;
}
.pa__photo-add {
  width: 100%;
  aspect-ratio: 3 / 4;
  border-radius: 8px;
  border: 1px dashed #ddd;
  display: flex;
  align-items: center;
  justify-content: center;
}
.pa__svc {
  border: 1px solid #f0f0f0;
  border-radius: 10px;
  padding: 10px;
  margin-bottom: 10px;
}
.pa__svc-head {
  display: flex;
  align-items: center;
}
.pa__svc-head :deep(.van-field) {
  padding: 0;
}
.pa__svc-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
}
.pa__svc-row :deep(.van-field) {
  padding: 0;
  flex: 1;
}
.pa__svc-label {
  font-size: 13px;
  color: var(--dp-text-2);
}
.pa__svc-units {
  display: flex;
  gap: 6px;
}
.pa__unit {
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 12px;
  background: #f5f5f5;
  color: var(--dp-text-2);
}
.pa__unit--on {
  background: rgba(255, 90, 95, 0.1);
  color: var(--dp-primary);
  font-weight: 700;
}
.pa__submit {
  margin: 20px 16px 30px;
}
.pa__tip {
  text-align: center;
  margin-top: 10px;
}
.pa__picker {
  padding: 20px 16px 30px;
}
.pa__picker-title {
  font-weight: 700;
  text-align: center;
  margin-bottom: 16px;
}
.pa__city--on {
  color: var(--dp-primary);
  font-weight: 700;
}
</style>
