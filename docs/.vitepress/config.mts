import { defineConfig } from "vitepress";

const repo = "https://github.com/geroale/OpenAgent";
const site = "https://openagent.uno/";
const base = "/";


export default defineConfig({
  title: "OpenAgent",
  description:
    "Persistent AI agent framework with MCP tools, long-term memory, and multi-channel support.",
  lang: "en-US",
  base,
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ["link", { rel: "icon", href: `${base}favicon/favicon.ico`, sizes: "any" }],
    ["link", { rel: "icon", href: `${base}favicon/favicon.svg`, type: "image/svg+xml" }],
    ["link", { rel: "apple-touch-icon", href: `${base}favicon/apple-touch-icon.png` }],
    ["link", { rel: "manifest", href: `${base}favicon/site.webmanifest` }],
    ["meta", { name: "theme-color", content: "#ef4136" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:site_name", content: "OpenAgent" }],
    ["meta", { property: "og:title", content: "OpenAgent" }],
    [
      "meta",
      {
        property: "og:description",
        content:
          "Persistent AI agent framework with MCP tools, long-term memory, and multi-channel support.",
      },
    ],
    ["meta", { property: "og:url", content: site }],
    ["meta", { property: "og:image", content: `${site}brand/openagent-logo.png` }],
    ["meta", { name: "twitter:card", content: "summary_large_image" }],
    ["meta", { name: "twitter:title", content: "OpenAgent" }],
    [
      "meta",
      {
        name: "twitter:description",
        content:
          "Persistent AI agent framework with MCP tools, long-term memory, and multi-channel support.",
      },
    ],
    ["meta", { name: "twitter:image", content: `${site}brand/openagent-logo.png` }],
  ],
  themeConfig: {
    logo: "/brand/openagent-icon.png",
    siteTitle: "OpenAgent",
    nav: [
      { text: "Home", link: "/" },
      { text: "Downloads", link: "/downloads" },
      { text: "Web App", link: "https://openagent.uno/app/" },
      { text: "Docs", link: "/guide/" },
      { text: "Examples", link: "/examples/" },
      { text: "GitHub", link: repo },
    ],
    sidebar: {
      "/guide/": [
        {
          text: "Documentation",
          items: [
            { text: "Overview", link: "/guide/" },
            { text: "Apps & Distribution", link: "/guide/apps" },
            { text: "Getting Started", link: "/guide/getting-started" },
            { text: "Models", link: "/guide/models" },
            { text: "MCP Tools", link: "/guide/mcp" },
            { text: "Channels", link: "/guide/channels" },
            { text: "Memory & Vault", link: "/guide/memory" },
            { text: "Scheduler & Dream Mode", link: "/guide/scheduler" },
            { text: "Desktop App", link: "/guide/desktop-app" },
            { text: "Architecture", link: "/guide/services" },
            { text: "Deployment", link: "/guide/deployment" },
            { text: "Config Reference", link: "/guide/config-reference" },
          ],
        },
      ],
      "/examples/": [
        {
          text: "Examples",
          items: [
            { text: "Overview", link: "/examples/" },
            { text: "Example Config", link: "/examples/openagent-yaml" },
            { text: "systemd Service", link: "/examples/workspace-mcp-service" },
          ],
        },
      ],
    },
    socialLinks: [{ icon: "github", link: repo }],
    search: {
      provider: "local",
    },
    editLink: {
      pattern: "https://github.com/geroale/OpenAgent/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },
    footer: {
      message: "MIT Licensed",
      copyright: "Copyright 2026 OpenAgent",
    },
  },
});
