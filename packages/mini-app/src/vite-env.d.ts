/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_BOT_USERNAME: string;
  readonly VITE_ESCROW_CONTRACT_ADDRESS: string;
  readonly VITE_USDT_MASTER: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
