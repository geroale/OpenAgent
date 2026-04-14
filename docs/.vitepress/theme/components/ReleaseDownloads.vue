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

const releasesUrl =
  "https://api.github.com/repos/geroale/OpenAgent/releases?per_page=30";
const allReleasesUrl = "https://github.com/geroale/OpenAgent/releases";

const loading = ref(true);
const error = ref("");
const releases = ref<Release[]>([]);

// Matches the server standalone distributable — the tar.gz / zip archive
// (Linux + Windows users + CI install.sh) plus the signed + notarized
// + stapled .pkg installer (macOS Finder double-click users).
// Example filenames:
//   openagent-0.5.4-macos-arm64.tar.gz
//   openagent-0.5.4-macos-arm64.pkg
//   openagent-0.5.4-windows-x64.zip
// The leading `openagent-<digit>` guard prevents this from matching CLI
// artifacts (which start with `openagent-cli-`).
function isServerExecutableAsset(name: string) {
  return /^openagent-\d+\.\d+\.\d+-(macos|linux|windows)-(arm64|x64)\.(tar\.gz|zip|pkg)$/i.test(
    name,
  );
}

// Same for the CLI artifacts.
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

function formatDate(dateString: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "long",
  }).format(new Date(dateString));
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
  // Flag the .pkg as an installer so users know it's the Finder-friendly
  // "no Gatekeeper dialog" option, distinct from the raw tar.gz archive.
  if ((isServerExecutableAsset(name) || isCliExecutableAsset(name)) && /\.pkg$/i.test(name)) {
    return `macOS installer${arch}`;
  }
  if (isServerExecutableAsset(name) || isCliExecutableAsset(name)) {
    const plat = executablePlatformLabel(name);
    return `${plat}${arch}`;
  }
  if (/\.dmg$/i.test(name)) return `DMG${arch}`;
  if (/\.exe$/i.test(name)) return `Installer${arch}`;
  if (/\.msi$/i.test(name)) return `MSI${arch}`;
  if (/\.AppImage$/i.test(name)) return `AppImage${arch}`;
  if (/\.deb$/i.test(name)) return `DEB${arch}`;
  if (/\.rpm$/i.test(name)) return `RPM${arch}`;
  return name;
}

function assetPriority(name: string) {
  // Within a single platform we want the friendlier download first. On
  // macOS the stapled .pkg beats the bare tar.gz (no Gatekeeper dialog);
  // elsewhere the archive is the only option.
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

const desktopDownloads = computed(() => [
  {
    name: "macOS",
    match: findLatestMatch((asset) => isMacDesktopAsset(asset.name)),
  },
  {
    name: "Windows",
    match: findLatestMatch((asset) => isWindowsDesktopAsset(asset.name)),
  },
  {
    name: "Linux",
    match: findLatestMatch((asset) => isLinuxDesktopAsset(asset.name)),
  },
]);

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
</script>

<template>
  <div class="downloads-shell">
    <div v-if="loading" class="download-state">
      Loading releases…
    </div>

    <div v-else-if="error" class="download-state">
      <strong>Release lookup failed.</strong>
      <div class="download-note">{{ error }}</div>
      <div class="download-links">
        <a class="download-pill" :href="allReleasesUrl">Browse all releases</a>
      </div>
    </div>

    <template v-else>
      <div class="release-meta">
        <div class="download-note">
          Newest stable build per app. Server, CLI, and Desktop may be on different tags.
        </div>
        <div class="download-links">
          <a class="download-pill" :href="allReleasesUrl">All releases</a>
        </div>
      </div>

      <div class="download-grid">
        <article class="download-card download-card-wide">
          <div class="download-card-header">
            <div>
              <div class="download-kicker">1. Run the runtime</div>
              <h3>Agent Server</h3>
            </div>
            <div v-if="serverDownload" class="download-release-chip">
              {{ serverDownload.release.tag_name }}
            </div>
          </div>
          <div v-if="serverDownload" class="download-note">
            Published {{ formatDate(serverDownload.release.published_at) }}.
          </div>
          <div v-if="serverDownload" class="download-actions">
            <a
              v-for="asset in serverDownload.assets"
              :key="asset.browser_download_url"
              class="download-action"
              :href="asset.browser_download_url"
            >
              {{ assetLabel(asset.name) }}
              <span>{{ formatSize(asset.size) }}</span>
            </a>
          </div>
          <div v-if="serverDownload" class="download-links">
            <a class="download-pill" :href="serverDownload.release.html_url">Release notes</a>
          </div>
          <div v-else class="download-note">
            No recent stable server build. Browse all releases or build from source.
          </div>
        </article>

        <article class="download-card download-card-wide">
          <div class="download-card-header">
            <div>
              <div class="download-kicker">2. Add a terminal client</div>
              <h3>CLI Client</h3>
            </div>
            <div v-if="cliDownload" class="download-release-chip">
              {{ cliDownload.release.tag_name }}
            </div>
          </div>
          <div v-if="cliDownload" class="download-note">
            Published {{ formatDate(cliDownload.release.published_at) }}.
          </div>
          <div v-if="cliDownload" class="download-actions">
            <a
              v-for="asset in cliDownload.assets"
              :key="asset.browser_download_url"
              class="download-action"
              :href="asset.browser_download_url"
            >
              {{ assetLabel(asset.name) }}
              <span>{{ formatSize(asset.size) }}</span>
            </a>
          </div>
          <div v-if="cliDownload" class="download-links">
            <a class="download-pill" :href="cliDownload.release.html_url">Release notes</a>
          </div>
          <div v-else class="download-note">
            No recent stable CLI build. Browse all releases or build from source.
          </div>
        </article>

        <article class="download-card download-card-wide">
          <div class="download-card-header">
            <div>
              <div class="download-kicker">3. Add the visual client</div>
              <h3>Desktop App</h3>
            </div>
          </div>
          <div class="download-platform-list">
            <div
              v-for="platform in desktopDownloads"
              :key="platform.name"
              class="download-platform"
            >
              <div class="download-platform-header">
                <strong>{{ platform.name }}</strong>
                <span v-if="platform.match" class="download-release-chip">
                  {{ platform.match.release.tag_name }}
                </span>
              </div>
              <div v-if="platform.match" class="download-actions">
                <a
                  v-for="asset in platform.match.assets"
                  :key="asset.browser_download_url"
                  class="download-action"
                  :href="asset.browser_download_url"
                >
                  {{ assetLabel(asset.name) }}
                  <span>{{ formatSize(asset.size) }}</span>
                </a>
              </div>
              <div v-if="platform.match" class="download-note">
                Published {{ formatDate(platform.match.release.published_at) }}.
              </div>
              <div v-if="platform.match" class="download-links">
                <a class="download-pill" :href="platform.match.release.html_url">
                  Release notes
                </a>
              </div>
              <div v-else class="download-note">
                No recent {{ platform.name }} build.
              </div>
            </div>
          </div>
        </article>
      </div>
    </template>
  </div>
</template>
