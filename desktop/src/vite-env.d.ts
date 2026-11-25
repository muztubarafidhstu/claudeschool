/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_LICENSE_API?: string;
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  readonly VITE_GOOGLE_CLIENT_SECRET?: string;
  readonly VITE_PREVIEW_BUILD?: string;
  readonly VITE_DEV_EMERGENCY_SECRET?: string;
}
declare module '*.sql?raw' { const s: string; export default s; }
declare module '*.pem?raw' { const s: string; export default s; }
