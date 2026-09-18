import { createPinia } from 'pinia';
import { createApp } from 'vue';
import 'vant/lib/index.css';
import App from './App.vue';
import router from './router';
import './style.css';

createApp(App).use(createPinia()).use(router).mount('#app');
