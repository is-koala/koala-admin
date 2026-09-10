import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Next 16.3.4 `pnpm dev` ajan görünce kökte AGENTS.md/CLAUDE.md yazıyor.
  // Bu depo o adı #18 rehberi için kullanıyor; üretimi kapatmazsak `next
  // dev` rehberi ezer ya da kirli bir diff bırakır. koala-admin#23.
  agentRules: false,
  // Dokploy imajı `node server.js` ile açılıyor; standalone çıktı olmadan o
  // dosya üretilmez ve imaj `node_modules`'ün tamamını taşımak zorunda kalır.
  output: "standalone",
  // Nothing here exposes `env` to the client on purpose: no `env` block, no
  // `NEXT_PUBLIC_*`. The API base URL stays a server-side value.
  poweredByHeader: false,
  typedRoutes: true,
};

export default nextConfig;
