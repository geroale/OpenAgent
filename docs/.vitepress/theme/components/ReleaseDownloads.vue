<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

type ReleaseAsset = {
  name: string;
  browser_download_url: string;
  size: number;
};

type Release = {
  tag_name: string;
  html_url: string;
  published_at: string;
  body: string;
  draft: boolean;
  prerelease: boolean;
  assets: ReleaseAsset[];
};

type ReleaseMatch = {
  release: Release;
  assets: ReleaseAsset[];
};

type Target = "server" | "cli" | "desktop";

const props = defineProps<{ target?: Target }>();

const releasesUrl =
  "https://api.github.com/repos/geroale/OpenAgent/releases?per_page=30";
const allReleasesUrl = "https://github.com/geroale/OpenAgent/releases";

const loading = ref(true);
const error = ref("");
const releases = ref<Release[]>([]);

function isServerExecutableAsset(name: string) {
  return /^openagent-\d+\.\d+\.\d+-(macos|linux|windows)-(arm64|x64)\.(tar\.gz|zip|pkg)$/i.test(
    name,
  );
}

function isCliExecutableAsset(name: string) {
  return /^openagent-cli-\d+\.\d+\.\d+-(macos|linux|windows)-(arm64|x64)\.(tar\.gz|zip|pkg)$/i.test(
    name,
  );
}

function isMacDesktopAsset(name: string) {
  return /\.dmg$/i.test(name) && !/blockmap/i.test(name);
}

function isWindowsDesktopAsset(name: string) {
  return /\.(exe|msi)$/i.test(name) && !/blockmap/i.test(name);
}

function isLinuxDesktopAsset(name: string) {
  return /\.(AppImage|deb|rpm)$/i.test(name) && !/blockmap/i.test(name);
}

function formatSize(size: number) {
  if (size >= 1024 * 1024 * 1024) {
    return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

function archLabel(name: string): string {
  const isMac = /\b(macos|mac|darwin)\b/i.test(name);
  if (/arm64/i.test(name)) {
    return isMac ? " (Apple Silicon)" : " (ARM64)";
  }
  if (/x64|amd64/i.test(name) && !/arm/i.test(name)) {
    return isMac ? " (Intel)" : " (64-bit)";
  }
  if (/universal/i.test(name)) return " (Universal)";
  return "";
}

function executablePlatformLabel(name: string): string {
  if (/macos/i.test(name)) return "macOS";
  if (/linux/i.test(name)) return "Linux";
  if (/windows/i.test(name)) return "Windows";
  return "";
}

function assetLabel(name: string) {
  const arch = archLabel(name);
  if ((isServerExecutableAsset(name) || isCliExecutableAsset(name)) && /\.pkg$/i.test(name)) {
    return `macOS installer${arch}`;
  }
  if (isServerExecutableAsset(name) || isCliExecutableAsset(name)) {
    const plat = executablePlatformLabel(name);
    return `${plat}${arch}`;
  }
  if (/\.dmg$/i.test(name)) return `macOS${arch}`;
  if (/\.exe$/i.test(name)) return `Windows${arch}`;
  if (/\.msi$/i.test(name)) return `Windows MSI${arch}`;
  if (/\.AppImage$/i.test(name)) return `Linux AppImage${arch}`;
  if (/\.deb$/i.test(name)) return `Linux .deb${arch}`;
  if (/\.rpm$/i.test(name)) return `Linux .rpm${arch}`;
  return name;
}

function assetPriority(name: string) {
  if (/macos.*\.pkg$/i.test(name)) return -1;
  if (/\.dmg$/i.test(name)) return 0;
  if (/\.exe$/i.test(name)) return 0;
  if (/\.AppImage$/i.test(name)) return 0;
  if (/\.tar\.gz$/i.test(name)) return 1;
  if (/\.zip$/i.test(name)) return 1;
  if (/\.msi$/i.test(name)) return 2;
  if (/\.deb$/i.test(name)) return 2;
  if (/\.rpm$/i.test(name)) return 3;
  return 9;
}

function findLatestMatch(
  matcher: (asset: ReleaseAsset) => boolean,
): ReleaseMatch | null {
  for (const release of stableReleases.value) {
    const assets = release.assets
      .filter(matcher)
      .sort((left, right) => assetPriority(left.name) - assetPriority(right.name));
    if (assets.length) {
      return { release, assets };
    }
  }
  return null;
}

const stableReleases = computed(() =>
  releases.value.filter((release) => !release.draft && !release.prerelease),
);

const serverDownload = computed(() =>
  findLatestMatch((asset) => isServerExecutableAsset(asset.name)),
);

const cliDownload = computed(() =>
  findLatestMatch((asset) => isCliExecutableAsset(asset.name)),
);

const desktopAssets = computed(() => {
  const match = findLatestMatch(
    (asset) =>
      isMacDesktopAsset(asset.name) ||
      isWindowsDesktopAsset(asset.name) ||
      isLinuxDesktopAsset(asset.name),
  );
  return match;
});

onMounted(async () => {
  try {
    const response = await fetch(releasesUrl, {
      headers: {
        Accept: "application/vnd.github+json",
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub API returned ${response.status}`);
    }

    releases.value = (await response.json()) as Release[];
  } catch (err) {
    error.value =
      err instanceof Error ? err.message : "Unable to load release metadata.";
  } finally {
    loading.value = false;
  }
});

const activeMatch = computed<ReleaseMatch | null>(() => {
  if (props.target === "server") return serverDownload.value;
  if (props.target === "cli") return cliDownload.value;
  if (props.target === "desktop") return desktopAssets.value;
  return null;
});
</script>

<template>
  <div class="downloads-inline">
    <div v-if="loading" class="downloads-inline-state">Loading latest release…</div>

    <div v-else-if="error" class="downloads-inline-state">
      Release lookup failed.
      <a :href="allReleasesUrl">Browse all releases</a>
    </div>

    <template v-else-if="activeMatch">
      <a
        v-for="asset in activeMatch.assets"
        :key="asset.browser_download_url"
        class="download-chip"
        :href="asset.browser_download_url"
      >
        <span class="download-chip-label">{{ assetLabel(asset.name) }}</span>
        <span class="download-chip-size">{{ formatSize(asset.size) }}</span>
      </a>
      <a class="download-chip download-chip-ghost" :href="activeMatch.release.html_url">
        {{ activeMatch.release.tag_name }} notes
      </a>
    </template>

    <div v-else class="downloads-inline-state">
      No recent build. <a :href="allReleasesUrl">Browse all releases</a>.
    </div>
  </div>
</template>
