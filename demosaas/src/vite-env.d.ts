/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly demo_saas_VITE_API_URL?: string;
  readonly demo_saas_VITE_API_KEY?: string;
  readonly demo_saas_VITE_ACCOUNT_ID?: string;
  readonly demo_saas_VITE_ACCOUNT_NUMBER?: string;
  readonly demo_saas_VITE_ACCOUNT_NAME?: string;
  readonly demo_saas_VITE_ACCOUNT_SEGMENT?: string;
  readonly demo_saas_VITE_ACCOUNT_CSM_NAME?: string;
  readonly demo_saas_VITE_ACCOUNT_ATTENTION_LABEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
