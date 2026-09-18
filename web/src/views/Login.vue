<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showToast } from 'vant';
import { api } from '../api';
import { useUserStore } from '../stores/user';

const mobile = ref('');
const code = ref('');
const agreed = ref(false);
const sending = ref(false);
const countdown = ref(0);
const loading = ref(false);
const store = useUserStore();
const router = useRouter();
const route = useRoute();

async function send() {
  if (!/^1[3-9]\d{9}$/.test(mobile.value)) return showToast('请输入正确的手机号');
  sending.value = true;
  try {
    const res = await api.sendSms(mobile.value);
    countdown.value = 60;
    const timer = setInterval(() => {
      if (--countdown.value <= 0) clearInterval(timer);
    }, 1000);
    // 开发环境验证码直接回显
    code.value = res.devCode;
    showToast(`验证码已发送（开发环境：${res.devCode}）`);
  } finally {
    sending.value = false;
  }
}

async function submit() {
  if (!agreed.value) return showToast('请先阅读并同意协议');
  if (!code.value) return showToast('请输入验证码');
  loading.value = true;
  try {
    const res = await api.login(mobile.value, code.value);
    store.setAuth(res.token, res.user);
    showToast('登录成功');
    router.replace((route.query.redirect as string) || '/home');
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login">
    <div class="login__hero">
      <div class="login__logo">城市玩伴</div>
      <div class="login__slogan">找个本地人，带你玩点不一样的</div>
    </div>
    <div class="login__form">
      <van-field
        v-model="mobile"
        type="tel"
        maxlength="11"
        placeholder="请输入手机号"
        left-icon="phone-o"
      />
      <van-field v-model="code" type="digit" maxlength="6" placeholder="请输入验证码" left-icon="shield-o">
        <template #button>
          <van-button
            size="small"
            type="primary"
            plain
            :disabled="sending || countdown > 0"
            @click="send"
          >
            {{ countdown > 0 ? `${countdown}s后重发` : '获取验证码' }}
          </van-button>
        </template>
      </van-field>
      <van-button block round type="primary" size="large" :loading="loading" class="login__btn" @click="submit">
        登录 / 注册
      </van-button>
      <div class="login__agree">
        <van-checkbox v-model="agreed" icon-size="14" checked-color="#ff5a5f" />
        <span class="muted">我已阅读并同意《用户协议》《隐私政策》和《平台交易规则》</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login {
  min-height: 100vh;
  background: linear-gradient(180deg, #ffe9ea 0%, var(--dp-bg) 40%);
}
.login__hero {
  padding: 72px 24px 40px;
}
.login__logo {
  font-size: 34px;
  font-weight: 800;
  color: var(--dp-primary);
  letter-spacing: 2px;
}
.login__slogan {
  margin-top: 8px;
  color: var(--dp-text-2);
  font-size: 14px;
}
.login__form {
  padding: 0 20px;
}
.login__form :deep(.van-field) {
  border-radius: 12px;
  margin-bottom: 14px;
}
.login__btn {
  margin-top: 12px;
}
.login__agree {
  margin-top: 16px;
  display: flex;
  align-items: flex-start;
  gap: 6px;
}
</style>
