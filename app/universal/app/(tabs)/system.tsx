import { colors, font, radius } from '../../theme';
/**
 * System screen — live host telemetry.
 *
 * Backed by the gateway's psutil-driven /api/system endpoint plus the
 * ``system_snapshot`` WebSocket push (one tick every ~2s). REST seeds
 * the first paint; WS keeps the screen live without polling.
 */

import Feather from '@expo/vector-icons/Feather';
import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
} from 'react-native';
import Card from '../../components/Card';
import CategorySidebar from '../../components/CategorySidebar';
import TabStrip from '../../components/TabStrip';
import ResponsiveSidebar from '../../components/ResponsiveSidebar';
import { useConnection } from '../../stores/connection';
import { useSystem } from '../../stores/system';
import { setBaseUrl } from '../../services/api';
import type { SystemSnapshot } from '../../../common/types';

type CategoryId = 'overview' | 'resources' | 'processes' | 'network';

const CATEGORIES = [
  { id: 'overview' as const, label: 'Overview', icon: 'activity' as const, description: 'Host snapshot' },
  { id: 'resources' as const, label: 'Resources', icon: 'bar-chart-2' as const, description: 'CPU, RAM, disk' },
  { id: 'processes' as const, label: 'Processes', icon: 'list' as const, description: 'Top consumers' },
  { id: 'network' as const, label: 'Network', icon: 'globe' as const, description: 'Throughput, sockets' },
];

type ProcessSort = 'cpu' | 'mem' | 'pid';

// ── Helpers ───────────────────────────────────────────────────────────

function pctColor(pct: number): string {
  if (pct >= 85) return colors.error;
  if (pct >= 60) return colors.warning;
  return colors.primary;
}

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;
const TB = GB * 1024;

function fmtBytes(n: number): string {
  if (!isFinite(n) || n <= 0) return '0 B';
  if (n >= TB) return `${(n / TB).toFixed(2)} TB`;
  if (n >= GB) return `${(n / GB).toFixed(1)} GB`;
  if (n >= MB) return `${(n / MB).toFixed(0)} MB`;
  if (n >= KB) return `${(n / KB).toFixed(0)} KB`;
  return `${n} B`;
}

function fmtRate(bytesPerSec: number): string {
  // Convert to bits/sec for the typical "Mbps" readout people expect on
  // a network card. Round to one decimal for sub-100Mbps, integer above.
  const bps = bytesPerSec * 8;
  if (bps >= 1e9) return `${(bps / 1e9).toFixed(2)} Gbps`;
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(bps >= 1e8 ? 0 : 1)} Mbps`;
  if (bps >= 1e3) return `${(bps / 1e3).toFixed(0)} Kbps`;
  return `${bps.toFixed(0)} bps`;
}

function fmtUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtBootTime(epoch: number): string {
  if (!epoch) return '—';
  const d = new Date(epoch * 1000);
  // Locale-stable yyyy-mm-dd HH:MM so it doesn't shift formats per OS.
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtFreqMhz(mhz: number): string {
  if (!mhz) return '—';
  if (mhz >= 1000) return `${(mhz / 1000).toFixed(2)} GHz`;
  return `${Math.round(mhz)} MHz`;
}

// ── Reusable bits ─────────────────────────────────────────────────────

interface BarProps {
  pct: number;
  label?: string;
  value?: string;
}

function UsageBar({ pct, label, value }: BarProps) {
  const clamped = Math.max(0, Math.min(100, pct));
  const tint = pctColor(clamped);
  return (
    <View style={styles.bar}>
      {(label || value) && (
        <View style={styles.barHeader}>
          <Text style={styles.barLabel}>{label}</Text>
          <Text style={styles.barValue}>{value ?? `${clamped.toFixed(0)}%`}</Text>
        </View>
      )}
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${clamped}%`, backgroundColor: tint }]} />
      </View>
    </View>
  );
}

interface StatProps {
  label: string;
  value: string;
  sub?: string;
  icon?: keyof typeof Feather.glyphMap;
  tint?: string;
}

function StatTile({ label, value, sub, icon, tint }: StatProps) {
  return (
    <View style={styles.statTile}>
      <View style={styles.statHeader}>
        {icon && (
          <Feather
            name={icon}
            size={11}
            color={tint ?? colors.textMuted}
            style={{ marginRight: 6 }}
          />
        )}
        <Text style={styles.statLabel}>{label}</Text>
      </View>
      <Text style={[styles.statValue, tint ? { color: tint } : null]}>{value}</Text>
      {sub && <Text style={styles.statSub}>{sub}</Text>}
    </View>
  );
}

// ── Screen ────────────────────────────────────────────────────────────

export default function SystemScreen() {
  const connConfig = useConnection((s) => s.config);
  const snapshot = useSystem((s) => s.snapshot);
  const error = useSystem((s) => s.error);
  const startFeed = useSystem((s) => s.start);

  const [activeCategory, setActiveCategory] = useState<CategoryId>('overview');
  const [procSort, setProcSort] = useState<ProcessSort>('cpu');

  useEffect(() => {
    if (!connConfig) return;
    if (connConfig.sidecarPort) setBaseUrl('127.0.0.1', connConfig.sidecarPort);
    void startFeed();
    // No teardown — the store stays bound across screen mounts so
    // returning here doesn't reset the feed. The connection store
    // tears down the WS when the user disconnects or switches accounts.
  }, [connConfig, startFeed]);

  const sidebar = (
    <CategorySidebar<CategoryId>
      title="System"
      active={activeCategory}
      onChange={setActiveCategory}
      categories={CATEGORIES}
      footer={
        <View style={styles.sidebarFooter}>
          <Text style={styles.sidebarFooterLabel}>Uptime</Text>
          <Text style={styles.sidebarFooterValue}>
            {snapshot ? fmtUptime(snapshot.host.uptime_seconds) : '—'}
          </Text>
          <View style={styles.liveDotRow}>
            <View style={[
              styles.liveDot,
              { backgroundColor: snapshot ? colors.success : colors.textMuted },
            ]} />
            <Text style={styles.liveDotLabel}>
              {snapshot ? 'live' : (error ? 'offline' : 'connecting…')}
            </Text>
          </View>
        </View>
      }
    />
  );

  // Loading state — first snapshot hasn't arrived yet.
  if (!snapshot) {
    return (
      <ResponsiveSidebar sidebar={sidebar}>
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
          <Text style={styles.title}>System</Text>
          <Text style={styles.hint}>
            {error
              ? `Couldn't reach the gateway: ${error}. Live updates will resume on reconnect.`
              : 'Waiting for the first telemetry tick from the gateway…'}
          </Text>
        </ScrollView>
      </ResponsiveSidebar>
    );
  }

  const renderCategory = () => {
    switch (activeCategory) {
      case 'overview': return <Overview snap={snapshot} />;
      case 'resources': return <Resources snap={snapshot} />;
      case 'processes': return (
        <Processes
          snap={snapshot}
          sort={procSort}
          onSort={setProcSort}
        />
      );
      case 'network': return <Network snap={snapshot} />;
    }
  };

  return (
    <ResponsiveSidebar sidebar={sidebar}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {error && <Text style={styles.error}>{error}</Text>}
        {renderCategory()}
        <View style={{ height: 40 }} />
      </ScrollView>
    </ResponsiveSidebar>
  );
}

// ── Sub-views ─────────────────────────────────────────────────────────

function Overview({ snap }: { snap: SystemSnapshot }) {
  const rootDisk = snap.disks[0];
  const rootPct = rootDisk ? rootDisk.percent : 0;
  return (
    <>
      <Text style={styles.title}>Overview</Text>
      <Text style={styles.hint}>
        Live snapshot of the host running the OpenAgent server. Updates every
        ~2 seconds over the gateway WebSocket.
      </Text>

      <View style={styles.statGrid}>
        <StatTile
          icon="cpu"
          label="CPU"
          value={`${snap.cpu.usage_pct.toFixed(0)}%`}
          sub={
            snap.cpu.temp_c != null
              ? `${snap.cpu.cores_logical} cores · ${snap.cpu.temp_c.toFixed(0)}°C`
              : `${snap.cpu.cores_logical} cores`
          }
          tint={pctColor(snap.cpu.usage_pct)}
        />
        <StatTile
          icon="layers"
          label="Memory"
          value={`${snap.memory.percent.toFixed(0)}%`}
          sub={`${fmtBytes(snap.memory.used_bytes)} / ${fmtBytes(snap.memory.total_bytes)}`}
          tint={pctColor(snap.memory.percent)}
        />
        <StatTile
          icon="hard-drive"
          label={rootDisk ? `Disk (${rootDisk.mount})` : 'Disk'}
          value={rootDisk ? `${rootPct.toFixed(0)}%` : '—'}
          sub={
            rootDisk
              ? `${fmtBytes(rootDisk.used_bytes)} / ${fmtBytes(rootDisk.total_bytes)}`
              : ''
          }
          tint={pctColor(rootPct)}
        />
        <StatTile
          icon="clock"
          label="Uptime"
          value={fmtUptime(snap.host.uptime_seconds)}
          sub={`since ${fmtBootTime(snap.host.boot_time)}`}
        />
      </View>

      <Text style={styles.sectionTitle}>Host</Text>
      <Card>
        <KvRow k="Hostname" v={snap.host.hostname} />
        <KvRow k="OS" v={snap.host.os} />
        <KvRow k="Kernel" v={snap.host.release} />
        <KvRow k="Arch" v={snap.host.arch} />
        <KvRow
          k="Load avg"
          v={snap.host.loadavg.map((n) => n.toFixed(2)).join(' · ')}
        />
        <KvRow k="Users" v={String(snap.host.users)} />
        <KvRow k="Python" v={snap.host.python_version} />
        <KvRow k="OpenAgent" v={`v${snap.host.openagent_version}`} last />
      </Card>
    </>
  );
}

function Resources({ snap }: { snap: SystemSnapshot }) {
  const swapPct = snap.swap.total_bytes > 0 ? snap.swap.percent : 0;
  return (
    <>
      <Text style={styles.sectionTitle}>CPU</Text>
      <Card>
        <Text style={styles.cardTitle}>{snap.cpu.model || 'CPU'}</Text>
        <Text style={styles.cardSub}>
          {snap.cpu.cores_physical || snap.cpu.cores_logical} cores
          {snap.cpu.cores_logical !== snap.cpu.cores_physical
            ? ` · ${snap.cpu.cores_logical} threads`
            : ''}
          {snap.cpu.freq_mhz ? ` · ${fmtFreqMhz(snap.cpu.freq_mhz)}` : ''}
          {snap.cpu.temp_c != null ? ` · ${snap.cpu.temp_c.toFixed(0)}°C` : ''}
        </Text>
        <View style={{ height: 12 }} />
        <UsageBar
          pct={snap.cpu.usage_pct}
          label="Total load"
          value={`${snap.cpu.usage_pct.toFixed(1)}%`}
        />
        {snap.cpu.per_core_pct.length > 0 && (
          <>
            <View style={{ height: 14 }} />
            <Text style={styles.label}>Per-core</Text>
            <View style={styles.coreGrid}>
              {snap.cpu.per_core_pct.map((p, i) => (
                <View key={i} style={styles.coreCell}>
                  <Text style={styles.coreLabel}>c{i}</Text>
                  <View style={styles.coreTrack}>
                    <View style={[styles.coreFill, {
                      height: `${Math.max(0, Math.min(100, p))}%`,
                      backgroundColor: pctColor(p),
                    }]} />
                  </View>
                  <Text style={styles.corePct}>{p.toFixed(0)}%</Text>
                </View>
              ))}
            </View>
          </>
        )}
      </Card>

      <Text style={styles.sectionTitle}>Memory</Text>
      <Card>
        <UsageBar
          pct={snap.memory.percent}
          label="RAM"
          value={`${fmtBytes(snap.memory.used_bytes)} / ${fmtBytes(snap.memory.total_bytes)}`}
        />
        <View style={{ height: 10 }} />
        <KvRow k="Available" v={fmtBytes(snap.memory.available_bytes)} />
        <KvRow k="Free" v={fmtBytes(snap.memory.free_bytes)} />
        {snap.memory.cached_bytes != null && (
          <KvRow k="Cached" v={fmtBytes(snap.memory.cached_bytes)} />
        )}
        <KvRow k="Used" v={fmtBytes(snap.memory.used_bytes)} last />
        {snap.swap.total_bytes > 0 && (
          <>
            <View style={{ height: 12 }} />
            <UsageBar
              pct={swapPct}
              label="Swap"
              value={`${fmtBytes(snap.swap.used_bytes)} / ${fmtBytes(snap.swap.total_bytes)}`}
            />
          </>
        )}
      </Card>

      <Text style={styles.sectionTitle}>Storage</Text>
      {snap.disks.length === 0 ? (
        <Card><Text style={styles.emptyText}>No disks reported.</Text></Card>
      ) : (
        snap.disks.map((d) => (
          <View key={d.mount} style={{ marginBottom: 10 }}>
            <Text style={styles.frameworkHeader}>
              {d.mount}
              <Text style={styles.frameworkSub}>  ·  {d.fs}{d.device ? `  ·  ${d.device}` : ''}</Text>
            </Text>
            <Card>
              <UsageBar
                pct={d.percent}
                label={`${fmtBytes(d.used_bytes)} / ${fmtBytes(d.total_bytes)} used`}
                value={`${d.percent.toFixed(0)}%`}
              />
            </Card>
          </View>
        ))
      )}
    </>
  );
}

function Processes({
  snap,
  sort,
  onSort,
}: {
  snap: SystemSnapshot;
  sort: ProcessSort;
  onSort: (s: ProcessSort) => void;
}) {
  const sorted = useMemo(() => {
    const list = [...snap.processes];
    if (sort === 'cpu') list.sort((a, b) => b.cpu_pct - a.cpu_pct);
    else if (sort === 'mem') list.sort((a, b) => b.rss_bytes - a.rss_bytes);
    else list.sort((a, b) => a.pid - b.pid);
    return list;
  }, [snap.processes, sort]);

  return (
    <>
      <Text style={styles.sectionTitle}>Processes</Text>
      <Text style={styles.hint}>
        Top {snap.processes.length} processes by resource consumption. Refreshes live with each tick.
      </Text>

      <TabStrip
        tabs={[
          { id: 'cpu', label: 'CPU' },
          { id: 'mem', label: 'Memory' },
          { id: 'pid', label: 'PID' },
        ]}
        active={sort}
        onChange={(v) => onSort(v as ProcessSort)}
        size="sm"
        style={{ marginBottom: 12 }}
      />

      <Card padded={false}>
        <View style={styles.procHeaderRow}>
          <Text style={[styles.procCell, styles.procHeaderText, { flex: 0.7 }]}>PID</Text>
          <Text style={[styles.procCell, styles.procHeaderText, { flex: 2.2 }]}>Process</Text>
          <Text style={[styles.procCell, styles.procHeaderText, { flex: 1 }]}>User</Text>
          <Text style={[styles.procCell, styles.procHeaderText, { flex: 0.8, textAlign: 'right' }]}>CPU</Text>
          <Text style={[styles.procCell, styles.procHeaderText, { flex: 0.9, textAlign: 'right' }]}>RSS</Text>
        </View>
        {sorted.length === 0 ? (
          <Text style={styles.emptyText}>No processes reported.</Text>
        ) : (
          sorted.map((p, i) => (
            <View key={p.pid} style={[styles.procRow, i > 0 && styles.procRowBorder]}>
              <Text style={[styles.procCell, { flex: 0.7 }]}>{p.pid}</Text>
              <View style={{ flex: 2.2 }}>
                <Text style={styles.procName} numberOfLines={1}>{p.name || '—'}</Text>
                <Text style={styles.procMeta}>{p.threads} threads · {p.status || '—'}</Text>
              </View>
              <Text style={[styles.procCell, { flex: 1 }]} numberOfLines={1}>
                {p.user || '—'}
              </Text>
              <Text
                style={[
                  styles.procCell,
                  { flex: 0.8, textAlign: 'right', color: pctColor(p.cpu_pct) },
                ]}
              >
                {p.cpu_pct.toFixed(1)}%
              </Text>
              <Text style={[styles.procCell, { flex: 0.9, textAlign: 'right' }]}>
                {fmtBytes(p.rss_bytes)}
              </Text>
            </View>
          ))
        )}
      </Card>
    </>
  );
}

function Network({ snap }: { snap: SystemSnapshot }) {
  const n = snap.network;
  return (
    <>
      <Text style={styles.sectionTitle}>Network</Text>
      <Text style={styles.hint}>
        Throughput on the primary interface. Rates are computed across consecutive snapshots.
      </Text>

      <View style={styles.statGrid}>
        <StatTile
          icon="download"
          label="Inbound"
          value={fmtRate(n.rx_bps)}
          sub={`${fmtBytes(n.rx_bytes_total)} total`}
          tint={colors.primary}
        />
        <StatTile
          icon="upload"
          label="Outbound"
          value={fmtRate(n.tx_bps)}
          sub={`${fmtBytes(n.tx_bytes_total)} total`}
          tint={colors.primaryMuted}
        />
        <StatTile
          icon="share-2"
          label="Sockets"
          value={n.connections > 0 ? String(n.connections) : '—'}
          sub={n.connections === 0 ? 'requires elevated privs' : 'inet connections'}
        />
        <StatTile
          icon="wifi"
          label="Interface"
          value={n.primary_iface || '—'}
          sub={n.ipv4 || ''}
        />
      </View>

      <Text style={styles.sectionTitle}>Interface</Text>
      <Card>
        <KvRow k="Name" v={n.primary_iface || '—'} />
        <KvRow k="IPv4" v={n.ipv4 || '—'} />
        <KvRow k="IPv6" v={n.ipv6 || '—'} />
        <KvRow k="RX rate" v={fmtRate(n.rx_bps)} />
        <KvRow k="TX rate" v={fmtRate(n.tx_bps)} />
        <KvRow k="RX total" v={fmtBytes(n.rx_bytes_total)} />
        <KvRow k="TX total" v={fmtBytes(n.tx_bytes_total)} last />
      </Card>
    </>
  );
}

function KvRow({ k, v, last }: { k: string; v: string; last?: boolean }) {
  return (
    <View style={[styles.kvRow, last && styles.kvRowLast]}>
      <Text style={styles.kvKey}>{k}</Text>
      <Text style={styles.kvVal}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sidebarFooter: {
    borderTopWidth: 1, borderTopColor: colors.borderLight,
    paddingVertical: 10, paddingHorizontal: 10, marginTop: 8,
  },
  sidebarFooterLabel: {
    fontSize: 9, color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 1, fontWeight: '600',
  },
  sidebarFooterValue: {
    fontSize: 12, color: colors.text, fontWeight: '600',
    marginTop: 2, fontFamily: font.mono,
  },
  liveDotRow: {
    flexDirection: 'row', alignItems: 'center',
    marginTop: 8, gap: 6,
  },
  liveDot: {
    width: 6, height: 6, borderRadius: 3,
  },
  liveDotLabel: {
    fontSize: 9, color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 1, fontWeight: '600',
  },

  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 24, maxWidth: 720, width: '100%', alignSelf: 'center' },

  title: {
    fontSize: 20, fontWeight: '500', color: colors.text, marginBottom: 4,
    fontFamily: font.display, letterSpacing: -0.4,
  },
  sectionTitle: {
    fontSize: 18, fontWeight: '500', color: colors.text,
    marginTop: 18, marginBottom: 8,
    fontFamily: font.display, letterSpacing: -0.3,
  },
  hint: { fontSize: 12, color: colors.textMuted, marginBottom: 14, lineHeight: 17 },
  error: { color: colors.error, fontSize: 12, marginBottom: 10 },

  label: {
    fontSize: 10, fontWeight: '600', color: colors.textSecondary,
    marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5,
  },

  cardTitle: {
    fontSize: 14, fontWeight: '600', color: colors.text,
    fontFamily: font.mono, letterSpacing: -0.1,
  },
  cardSub: {
    fontSize: 11, color: colors.textMuted, marginTop: 3, fontFamily: font.mono,
  },

  // ── Stat grid ────────────────────────
  statGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
    gap: 10, marginBottom: 6,
  },
  statTile: {
    flexBasis: '47%', flexGrow: 1, minWidth: 140,
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    padding: 14,
  },
  statHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  statLabel: {
    fontSize: 10, color: colors.textMuted, fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 1,
  },
  statValue: {
    fontSize: 22, fontWeight: '600', color: colors.text,
    fontFamily: font.mono, letterSpacing: -0.4,
  },
  statSub: {
    fontSize: 11, color: colors.textMuted, marginTop: 3, fontFamily: font.mono,
  },

  // ── Key/value rows ───────────────────
  kvRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.borderLight,
  },
  kvRowLast: { borderBottomWidth: 0 },
  kvKey: {
    fontSize: 11, color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: '600',
  },
  kvVal: { fontSize: 12, color: colors.text, fontFamily: font.mono },

  // ── Usage bar ────────────────────────
  bar: { width: '100%' },
  barHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 5,
  },
  barLabel: {
    fontSize: 11, color: colors.textSecondary, fontWeight: '500',
  },
  barValue: { fontSize: 11, color: colors.text, fontFamily: font.mono },
  barTrack: {
    height: 6, backgroundColor: colors.inputBg,
    borderRadius: 3, overflow: 'hidden',
    borderWidth: 1, borderColor: colors.borderLight,
  },
  barFill: { height: '100%', borderRadius: 3 },

  // ── Per-core grid ────────────────────
  coreGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  coreCell: {
    width: 38, alignItems: 'center',
    paddingVertical: 6, paddingHorizontal: 2,
    backgroundColor: colors.inputBg, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.borderLight,
  },
  coreLabel: {
    fontSize: 9, color: colors.textMuted,
    fontFamily: font.mono, marginBottom: 4,
  },
  coreTrack: {
    width: 8, height: 38, backgroundColor: colors.bg,
    borderRadius: 2, overflow: 'hidden',
    justifyContent: 'flex-end', marginBottom: 4,
  },
  coreFill: { width: '100%' },
  corePct: { fontSize: 9, color: colors.textSecondary, fontFamily: font.mono },

  // ── Process table ────────────────────
  procHeaderRow: {
    flexDirection: 'row',
    paddingHorizontal: 12, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: colors.borderLight,
  },
  procRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 9,
  },
  procRowBorder: { borderTopWidth: 1, borderTopColor: colors.borderLight },
  procCell: { fontSize: 12, color: colors.text, fontFamily: font.mono },
  procHeaderText: {
    color: colors.textMuted, fontSize: 10,
    fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6,
  },
  procName: { fontSize: 12, color: colors.text, fontFamily: font.mono, fontWeight: '600' },
  procMeta: { fontSize: 10, color: colors.textMuted, marginTop: 2, fontFamily: font.mono },

  // ── Section header ──
  frameworkHeader: {
    fontSize: 11, color: colors.textMuted, marginBottom: 4, marginTop: 4,
    textTransform: 'uppercase', letterSpacing: 1, fontWeight: '700',
  },
  frameworkSub: {
    fontSize: 10, color: colors.textMuted, fontWeight: '400',
    textTransform: 'none', letterSpacing: 0, fontFamily: font.mono,
  },
  emptyText: {
    padding: 12, fontSize: 12, color: colors.textMuted, textAlign: 'center',
  },
});
