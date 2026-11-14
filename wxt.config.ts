import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react', '@wxt-dev/i18n/module'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  webExt: {
    disabled: true,
  },
  manifest: {
    name: '__MSG_appName__',
    description: '__MSG_appDesc__',
    version: '0.1.0',
    default_locale: 'zh_CN',
    action: {
      default_title: '__MSG_appName__',
    },
    permissions: [
      'storage',
      'sidePanel',
      'tabs',
      'scripting',
      'userScripts',
    ],
    host_permissions: ['<all_urls>'],
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'; style-src 'self' 'unsafe-inline';",
    },
  },
});
