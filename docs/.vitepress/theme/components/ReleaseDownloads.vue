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

function isAgentAsset(name: string) {
  return /^openagent[_-]framework.*(\.whl|\.tar\.gz)$/i.test(name);
}

function isCliAsset(name: string) {
  return /^openagent[_-]cli.*(\.whl|\.tar\.gz)$/i.test(name);
}

function isMacDesktopAsset(name: string) {
  return /\.(dmg|zip)$/i.test(name);
}

function isWindowsDesktopAsset(name: string) {
  return /\.(exe|msi)$/i.test(name);
}

function isLinuxDesktopAsset(name: string) {
  return /\.(AppImage|deb|rpm)$/i.test(name);
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

function assetLabel(name: string) {
  if (/\.whl$/i.test(name)) return "Python wheel";
  if (/\.tar\.gz$/i.test(name)) return "Source tarball";
  if (/\.dmg$/i.test(name)) return "Download DMG";
  if (/\.zip$/i.test(name)) return "Download ZIP";
  if (/\.exe$/i.test(name)) return "Download installer";
  if (/\.msi$/i.test(name)) return "Download MSI";
  if (/\.AppImage$/i.test(name)) return "Download AppImage";
  if (/\.deb$/i.test(name)) return "Download DEB";
  if (/\.rpm$/i.test(name)) return "Download RPM";
  return name;
}

function assetPriority(name: string) {
  if (/\.dmg$/i.test(name)) return 0;
  if (/\.exe$/i.test(name)) return 0;
  if (/\.AppImage$/i.test(name)) return 0;
  if (/\.whl$/i.test(name)) return 0;
  if (/\.zip$/i.test(name)) return 1;
  if (/\.msi$/i.test(name)) return 1;
  if (/\.deb$/i.test(name)) return 1;
  if (/\.rpm$/i.test(name)) return 2;
  if (/\.tar\.gz$/i.test(name)) return 2;
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

const agentDownload = computed(() =>
  findLatestMatch((asset) => isAgentAsset(asset.name)),
);

const cliDownload = computed(() =>
  findLatestMatch((asset) => isCliAsset(asset.name)),
);

const desktopDownloads = computed(() => [
  {
    name: "macOS",
    summary: "Open the DMG and move OpenAgent to Applications.",
    match: findLatestMatch((asset) => isMacDesktopAsset(asset.name)),
  },
  {
    name: "Windows",
    summary: "Run the installer and complete the setup flow.",
    match: findLatestMatch((asset) => isWindowsDesktopAsset(asset.name)),
  },
  {
    name: "Linux",
    summary: "Pick the AppImage or distro package that fits your machine.",
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
      Fetching recent GitHub releases and resolving the newest download for each app.
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
        <strong>Latest available downloads per app</strong>
        <div class="download-note">
          These cards scan recent stable releases and pick the newest tag that actually
          contains each artifact family. The Agent Server, CLI Client, and Desktop App can
          therefore point to different releases without hiding macOS, Windows, or Linux
          downloads.
        </div>
        <div class="download-links">
          <a class="download-pill" :href="allReleasesUrl">All releases</a>
        </div>
      </div>

      <div class="download-grid">
        <article class="download-card">
          <div class="download-card-header">
            <div>
              <div class="download-kicker">1. Run the runtime</div>
              <h3>Agent Server</h3>
            </div>
            <div v-if="agentDownload" class="download-release-chip">
              {{ agentDownload.release.tag_name }}
            </div>
          </div>
          <div class="download-note">
            Python package assets for the persistent OpenAgent runtime in
            <code>openagent/</code>.
          </div>
          <div v-if="agentDownload" class="download-note">
            Latest package release published
            {{ formatDate(agentDownload.release.published_at) }}.
          </div>
          <div v-if="agentDownload" class="download-actions">
            <a
              v-for="asset in agentDownload.assets"
              :key="asset.browser_download_url"
              class="download-action"
              :href="asset.browser_download_url"
            >
              {{ assetLabel(asset.name) }}
              <span>{{ formatSize(asset.size) }}</span>
            </a>
          </div>
          <div v-if="agentDownload" class="download-links">
            <a class="download-pill" :href="agentDownload.release.html_url">Release notes</a>
          </div>
          <div v-else class="download-note">
            No recent stable release contains an Agent Server package yet. Browse all
            releases or use the install command shown above.
          </div>
        </article>

        <article class="download-card">
          <div class="download-card-header">
            <div>
              <div class="download-kicker">2. Add a terminal client</div>
              <h3>CLI Client</h3>
            </div>
            <div v-if="cliDownload" class="download-release-chip">
              {{ cliDownload.release.tag_name }}
            </div>
          </div>
          <div class="download-note">
            Separate Python package assets for the terminal client that connects to a
            running OpenAgent Gateway.
          </div>
          <div v-if="cliDownload" class="download-note">
            Latest CLI release published {{ formatDate(cliDownload.release.published_at) }}.
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
            No recent stable release contains a CLI package yet. Browse all releases or use
            the install command documented above.
          </div>
        </article>

        <article class="download-card">
          <div class="download-card-header">
            <div>
              <div class="download-kicker">3. Add the visual client</div>
              <h3>Desktop App</h3>
            </div>
          </div>
          <div class="download-note">
            Platform-specific Electron installers that connect to a running Agent Server.
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
              <div class="download-note">{{ platform.summary }}</div>
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
                Latest {{ platform.name }} build published
                {{ formatDate(platform.match.release.published_at) }}.
              </div>
              <div v-if="platform.match" class="download-links">
                <a class="download-pill" :href="platform.match.release.html_url">
                  Release notes
                </a>
              </div>
              <div v-else class="download-note">
                No recent {{ platform.name }} desktop installer is attached yet. Browse all
                releases or build from source.
              </div>
            </div>
          </div>
        </article>
      </div>
    </template>
  </div>
</template>
