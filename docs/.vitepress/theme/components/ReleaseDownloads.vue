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
  assets: ReleaseAsset[];
};

const latestStableReleaseUrl =
  "https://api.github.com/repos/geroale/OpenAgent/releases/latest";
const allReleasesUrl = "https://github.com/geroale/OpenAgent/releases";

const loading = ref(true);
const error = ref("");
const release = ref<Release | null>(null);

function formatSize(size: number) {
  if (size >= 1024 * 1024 * 1024) {
    return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

function classifyAsset(name: string) {
  if (/\.(dmg|zip)$/i.test(name)) return "macOS";
  if (/\.(exe|msi)$/i.test(name)) return "Windows";
  if (/\.(AppImage|deb|rpm|tar\.gz)$/i.test(name)) return "Linux";
  return "Other";
}

const groups = computed(() => {
  const source = release.value?.assets ?? [];
  const grouped = new Map<string, ReleaseAsset[]>();

  for (const asset of source) {
    const group = classifyAsset(asset.name);
    if (group === "Other") continue;
    const assets = grouped.get(group) ?? [];
    assets.push(asset);
    grouped.set(group, assets);
  }

  return ["macOS", "Windows", "Linux"]
    .filter((group) => grouped.has(group))
    .map((group) => ({ name: group, assets: grouped.get(group) ?? [] }));
});

const publishedAt = computed(() => {
  if (!release.value?.published_at) return "";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "long",
  }).format(new Date(release.value.published_at));
});

onMounted(async () => {
  try {
    const response = await fetch(latestStableReleaseUrl, {
      headers: {
        Accept: "application/vnd.github+json",
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub API returned ${response.status}`);
    }

    release.value = (await response.json()) as Release;
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
      Fetching the latest stable desktop release from GitHub Releases.
    </div>

    <div v-else-if="error" class="download-state">
      <strong>Release lookup failed.</strong>
      <div class="download-note">{{ error }}</div>
      <div class="download-links">
        <a class="download-pill" :href="allReleasesUrl">Browse all releases</a>
      </div>
    </div>

    <template v-else-if="release">
      <div class="release-meta">
        <strong>{{ release.tag_name }}</strong>
        <div class="download-note">
          Latest stable release published {{ publishedAt }}.
        </div>
        <div class="download-links">
          <a class="download-pill" :href="release.html_url">Release notes</a>
          <a class="download-pill" :href="allReleasesUrl">All releases</a>
        </div>
      </div>

      <div v-if="groups.length" class="download-grid">
        <article v-for="group in groups" :key="group.name" class="download-card">
          <h3>{{ group.name }}</h3>
          <div class="download-note">
            Electron build artifacts uploaded by the release workflow.
          </div>
          <ul>
            <li v-for="asset in group.assets" :key="asset.browser_download_url">
              <a :href="asset.browser_download_url">{{ asset.name }}</a>
              <div class="download-note">{{ formatSize(asset.size) }}</div>
            </li>
          </ul>
        </article>
      </div>

      <div v-else class="download-state">
        <strong>No desktop binaries were attached to this release yet.</strong>
        <div class="download-note">
          The repository is ready to surface them here once electron-builder uploads
          the release artifacts.
        </div>
      </div>
    </template>
  </div>
</template>
