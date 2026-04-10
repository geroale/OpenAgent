import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";

import ReleaseDownloads from "./components/ReleaseDownloads.vue";
import "./custom.css";

const theme: Theme = {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("ReleaseDownloads", ReleaseDownloads);
  },
};

export default theme;
