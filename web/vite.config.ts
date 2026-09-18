import { VantResolver } from '@vant/auto-import-resolver';
import vue from '@vitejs/plugin-vue';
import * as pxToViewportPkg from 'postcss-px-to-viewport-8-plugin';
import { defineConfig } from 'vite';
import Components from 'unplugin-vue-components/vite';

import type { AcceptedPlugin } from 'postcss';

type PxToViewport = (options: Record<string, unknown>) => unknown;
const pxToViewport = ((pxToViewportPkg as { default?: unknown }).default ??
  pxToViewportPkg) as PxToViewport;

export default defineConfig({
  plugins: [
    vue(),
    Components({ resolvers: [VantResolver()] }),
  ],
  css: {
    postcss: {
      plugins: [
        pxToViewport({
          unitToConvert: 'px',
          viewportWidth: 375,
          unitPrecision: 5,
          propList: ['*'],
          viewportUnit: 'vw',
          fontViewportUnit: 'vw',
          selectorBlackList: ['.ignore-vw'],
          minPixelValue: 1,
          mediaQuery: false,
          replace: true,
          landscape: false,
        }) as AcceptedPlugin,
      ],
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/uploads': 'http://localhost:3000',
    },
  },
});
