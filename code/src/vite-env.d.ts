/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEMO_ADMIN_EMAIL?: string;
  readonly VITE_DEMO_ADMIN_PASSWORD?: string;
  readonly VITE_DEMO_PRESENTER_EMAIL?: string;
  readonly VITE_DEMO_PRESENTER_PASSWORD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
