/**
 * MCPs — install form.
 *
 * Pushed onto the MCPs stack when the user clicks "Install" on a
 * marketplace tile. Params: ``name``, ``version``. The screen fetches
 * ``/api/marketplace/servers?name&version`` on mount, renders the
 * synthesised ``requirements`` (env vars, headers, URL placeholders),
 * then POSTs to ``/api/marketplace/install`` — the gateway handles the
 * package/remote → argv mapping and duplicate-name collision. On 409
 * the UI surfaces the ``suggested_name`` as a one-tap chip.
 *
 * Design goals: give every install a moment to breathe. Large type,
 * generous spacing, one primary call-to-action at the bottom-right.
 * The user should see *what's about to be written to their mcps table*
 * before they click Install.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity,
  ActivityIndicator, Platform,
} from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { StackActions } from '@react-navigation/native';
import { useConnection } from '../../../stores/connection';
import {
  setBaseUrl,
  getMarketplaceServer,
  installFromMarketplace,
  type MarketplaceServerDetail,
  type MarketplacePackage,
  type MarketplaceRemote,
  type MarketplaceField,
  type MarketplaceInstallError,
} from '../../../services/api';
import { colors, font, radius, tracking } from '../../../theme';
import Button from '../../../components/Button';

function defaultInstallName(registryName: string): string {
  if (!registryName) return 'mcp-marketplace';
  const tail = registryName.split('/').pop() || registryName;
  const slug = tail.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return slug || 'mcp-marketplace';
}

export default function InstallMcpScreen() {
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ name?: string; version?: string }>();
  const name = typeof params.name === 'string' ? params.name : '';
  const version = typeof params.version === 'string' ? params.version : 'latest';
  const config = useConnection((s) => s.config);

  // See the matching note in ``[name].tsx``: ``router.back()`` bubbles up
  // to the Tabs navigator and lands on chat when this stack only holds one
  // screen. ``POP_TO`` on the Stack directly pops to ``index`` or replaces
  // this screen with it.
  const backToList = useCallback(() => {
    navigation.dispatch(StackActions.popTo('index'));
  }, [navigation]);

  const [detail, setDetail] = useState<MarketplaceServerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [pickerKind, setPickerKind] = useState<'package' | 'remote'>('package');
  const [pickerIndex, setPickerIndex] = useState(0);
  const [installName, setInstallName] = useState(() => defaultInstallName(name));
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const [headerValues, setHeaderValues] = useState<Record<string, string>>({});
  const [placeholderValues, setPlaceholderValues] = useState<Record<string, string>>({});
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [suggestedName, setSuggestedName] = useState<string | null>(null);

  useEffect(() => {
    if (config) if (config.sidecarPort) setBaseUrl('127.0.0.1', config.sidecarPort);
  }, [config]);

  const load = useCallback(async () => {
    if (!name) {
      setFetchError('No server name provided.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setFetchError(null);
    try {
      const data = await getMarketplaceServer(name, version);
      setDetail(data);
      const hasPackage = data.requirements.packages.length > 0;
      const initialKind: 'package' | 'remote' = hasPackage ? 'package' : 'remote';
      setPickerKind(initialKind);
      setPickerIndex(0);
      setInstallName(defaultInstallName(name));
      // Pre-fill defaults so straightforward installs are one click.
      const env: Record<string, string> = {};
      const headers: Record<string, string> = {};
      if (hasPackage) {
        for (const f of data.requirements.packages[0].env_required) {
          if (f.default) env[f.name] = f.default;
        }
      } else if (data.requirements.remotes.length > 0) {
        for (const f of data.requirements.remotes[0].header_required) {
          if (f.default) headers[f.name] = f.default;
        }
      }
      setEnvValues(env);
      setHeaderValues(headers);
      setPlaceholderValues({});
    } catch (e: any) {
      setFetchError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [name, version]);

  useEffect(() => {
    if (config) load();
  }, [config, load]);

  // Reset per-choice defaults whenever the user flips which
  // package/remote they're about to install.
  useEffect(() => {
    if (!detail) return;
    const env: Record<string, string> = {};
    const headers: Record<string, string> = {};
    if (pickerKind === 'package') {
      const pkg = detail.requirements.packages[pickerIndex];
      if (pkg) for (const f of pkg.env_required) if (f.default) env[f.name] = f.default;
    } else {
      const remote = detail.requirements.remotes[pickerIndex];
      if (remote) for (const f of remote.header_required) if (f.default) headers[f.name] = f.default;
    }
    setEnvValues(env);
    setHeaderValues(headers);
    setPlaceholderValues({});
  }, [pickerKind, pickerIndex, detail]);

  const currentPackage: MarketplacePackage | null = useMemo(() => {
    if (!detail || pickerKind !== 'package') return null;
    return detail.requirements.packages[pickerIndex] ?? null;
  }, [detail, pickerKind, pickerIndex]);

  const currentRemote: MarketplaceRemote | null = useMemo(() => {
    if (!detail || pickerKind !== 'remote') return null;
    return detail.requirements.remotes[pickerIndex] ?? null;
  }, [detail, pickerKind, pickerIndex]);

  const placeholders = useMemo(() => {
    if (currentPackage) return currentPackage.placeholders;
    if (currentRemote) return currentRemote.placeholders;
    return [];
  }, [currentPackage, currentRemote]);

  const doInstall = async () => {
    if (!detail) return;
    setInstalling(true);
    setInstallError(null);
    setSuggestedName(null);
    try {
      await installFromMarketplace({
        name,
        version,
        choice: { kind: pickerKind, index: pickerIndex },
        install_name: installName.trim() || undefined,
        env: envValues,
        headers: headerValues,
        placeholders: placeholderValues,
      });
      backToList();
    } catch (e: any) {
      const err = e as MarketplaceInstallError;
      if (err && err.status === 409) {
        setInstallError(err.error);
        if (err.suggested_name) setSuggestedName(err.suggested_name);
      } else {
        setInstallError(err?.error || (e as Error)?.message || String(e));
      }
    } finally {
      setInstalling(false);
    }
  };

  const server = detail?.server as any;

  return (
    <View style={styles.root}>
      {/* Breadcrumb + close */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={backToList} style={styles.topBarBtn} hitSlop={8}>
          <Feather name="arrow-left" size={14} color={colors.textSecondary} />
          <Text style={styles.topBarText}>Marketplace</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={load} style={styles.topBarBtn} hitSlop={8} disabled={loading}>
          <Feather name="refresh-cw" size={13} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.loadingText}>Fetching server manifest…</Text>
          </View>
        ) : fetchError ? (
          <ErrorBlock message={fetchError} onRetry={load} />
        ) : detail && server ? (
          <>
            <Text style={styles.eyebrow}>INSTALL · MODEL CONTEXT PROTOCOL</Text>
            <Text style={styles.title}>{server.title || server.name}</Text>
            <Text style={styles.registryName}>{server.name}{server.version ? `  ·  v${server.version}` : ''}</Text>

            {server.description && (
              <Text style={styles.description}>{server.description}</Text>
            )}

            {/* Divider */}
            <View style={styles.rule} />

            {/* Choice picker */}
            {(detail.requirements.packages.length + detail.requirements.remotes.length) > 1 && (
              <Section label="Transport">
                <View style={styles.pickerRow}>
                  {detail.requirements.packages.length > 0 && (
                    <ChoiceChip
                      label={`Local · ${detail.requirements.packages.length}`}
                      icon="terminal"
                      active={pickerKind === 'package'}
                      onPress={() => { setPickerKind('package'); setPickerIndex(0); }}
                    />
                  )}
                  {detail.requirements.remotes.length > 0 && (
                    <ChoiceChip
                      label={`Remote · ${detail.requirements.remotes.length}`}
                      icon="cloud"
                      active={pickerKind === 'remote'}
                      onPress={() => { setPickerKind('remote'); setPickerIndex(0); }}
                    />
                  )}
                </View>
              </Section>
            )}

            {pickerKind === 'package' && detail.requirements.packages.length > 1 && (
              <Section label="Package variant">
                <View style={styles.pickerRow}>
                  {detail.requirements.packages.map((p, i) => (
                    <ChoiceChip
                      key={`pkg-${i}`}
                      label={`${p.runtime}${p.version ? ` ${p.version}` : ''}`}
                      mono
                      active={pickerIndex === i}
                      muted={!p.supported}
                      onPress={() => setPickerIndex(i)}
                    />
                  ))}
                </View>
              </Section>
            )}

            {/* Runtime / endpoint summary */}
            {currentPackage && (
              <SummaryBlock>
                <SummaryRow label="Runtime" value={currentPackage.runtime} />
                {currentPackage.identifier && (
                  <SummaryRow
                    label="Identifier"
                    value={currentPackage.identifier + (currentPackage.version ? `@${currentPackage.version}` : '')}
                  />
                )}
                {!currentPackage.supported && (
                  <SummaryRow
                    label="Warning"
                    value="Unsupported runtime — OpenAgent can't assemble an install command."
                    tone="warn"
                  />
                )}
              </SummaryBlock>
            )}
            {currentRemote && (
              <SummaryBlock>
                <SummaryRow label="Transport" value={currentRemote.transport || 'streamable-http'} />
                <SummaryRow label="Endpoint" value={currentRemote.url || '—'} />
              </SummaryBlock>
            )}

            {/* Required fields */}
            {currentPackage && currentPackage.env_required.length > 0 && (
              <FieldSection
                label="Environment variables"
                description="These are passed to the stdio subprocess at launch."
                fields={currentPackage.env_required}
                values={envValues}
                onChange={(n, v) => setEnvValues((prev) => ({ ...prev, [n]: v }))}
              />
            )}

            {currentRemote && currentRemote.header_required.length > 0 && (
              <FieldSection
                label="HTTP headers"
                description="Sent with every request to the remote server."
                fields={currentRemote.header_required}
                values={headerValues}
                onChange={(n, v) => setHeaderValues((prev) => ({ ...prev, [n]: v }))}
              />
            )}

            {placeholders.length > 0 && (
              <Section
                label="Placeholders"
                description="The server's manifest embeds these tokens in its install command or URL."
              >
                {placeholders.map((ph) => (
                  <LabeledInput
                    key={ph.token}
                    label={`{${ph.token}}`}
                    description={ph.description}
                    value={placeholderValues[ph.token] || ''}
                    onChange={(v) => setPlaceholderValues((prev) => ({ ...prev, [ph.token]: v }))}
                    placeholder={`Value for {${ph.token}}`}
                  />
                ))}
              </Section>
            )}

            <Section label="Install name" description="Used as the primary key in your mcps table.">
              <LabeledInput
                label=""
                value={installName}
                onChange={setInstallName}
                placeholder={defaultInstallName(name)}
              />
              {suggestedName && (
                <TouchableOpacity
                  style={styles.suggestionChip}
                  onPress={() => { setInstallName(suggestedName); setSuggestedName(null); setInstallError(null); }}
                >
                  <Feather name="corner-down-right" size={11} color={colors.primary} />
                  <Text style={styles.suggestionText}>Use suggested: {suggestedName}</Text>
                </TouchableOpacity>
              )}
            </Section>

            {installError && <ErrorInline message={installError} />}

            <View style={styles.footer}>
              <Button variant="ghost" size="md" label="Cancel" onPress={backToList} />
              <Button
                variant="primary"
                size="md"
                label={installing ? 'Installing…' : 'Install MCP'}
                icon={installing ? undefined : 'download'}
                iconPosition="right"
                onPress={doInstall}
                disabled={installing || (currentPackage ? !currentPackage.supported : false)}
              />
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────

function Section({
  label, description, children,
}: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      {description && <Text style={styles.sectionDesc}>{description}</Text>}
      <View style={{ marginTop: 8 }}>{children}</View>
    </View>
  );
}

function SummaryBlock({ children }: { children: React.ReactNode }) {
  return <View style={styles.summary}>{children}</View>;
}

function SummaryRow({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, tone === 'warn' && styles.summaryValueWarn]}>{value}</Text>
    </View>
  );
}

function ChoiceChip({
  label, icon, active, muted, mono, onPress,
}: {
  label: string;
  icon?: keyof typeof Feather.glyphMap;
  active: boolean;
  muted?: boolean;
  mono?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[
        styles.choiceChip,
        active && styles.choiceChipActive,
        muted && styles.choiceChipMuted,
      ]}
    >
      {icon && <Feather name={icon} size={12} color={active ? colors.primary : colors.textSecondary} />}
      <Text
        style={[
          styles.choiceChipLabel,
          active && styles.choiceChipLabelActive,
          mono && { fontFamily: font.mono },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function FieldSection({
  label, description, fields, values, onChange,
}: {
  label: string;
  description?: string;
  fields: MarketplaceField[];
  values: Record<string, string>;
  onChange: (name: string, v: string) => void;
}) {
  return (
    <Section label={label} description={description}>
      {fields.map((f) => (
        <View key={f.name} style={styles.field}>
          <View style={styles.fieldHeader}>
            <Text style={styles.fieldName}>{f.name}</Text>
            {f.isRequired && <Badge label="required" tone="required" />}
            {f.isSecret && <Badge label="secret" tone="secret" />}
          </View>
          {f.description && <Text style={styles.fieldDescription}>{f.description}</Text>}
          <TextInput
            style={styles.input}
            value={values[f.name] || ''}
            onChangeText={(v) => onChange(f.name, v)}
            placeholder={f.default || (f.isSecret ? '••••••••' : f.value_template || `Set ${f.name}`)}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry={f.isSecret}
          />
        </View>
      ))}
    </Section>
  );
}

function LabeledInput({
  label, description, value, onChange, placeholder, secure,
}: {
  label: string;
  description?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  secure?: boolean;
}) {
  return (
    <View style={{ marginBottom: 6 }}>
      {label ? <Text style={styles.fieldName}>{label}</Text> : null}
      {description ? <Text style={styles.fieldDescription}>{description}</Text> : null}
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry={secure}
      />
    </View>
  );
}

function Badge({ label, tone }: { label: string; tone: 'required' | 'secret' }) {
  const isReq = tone === 'required';
  return (
    <View style={[styles.badge, isReq ? styles.badgeRequired : styles.badgeSecret]}>
      <Text style={[styles.badgeText, isReq ? styles.badgeTextRequired : styles.badgeTextSecret]}>
        {label}
      </Text>
    </View>
  );
}

function ErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.errorBlock}>
      <Feather name="cloud-off" size={22} color={colors.error} />
      <Text style={styles.errorBlockTitle}>Couldn't reach the registry</Text>
      <Text style={styles.errorBlockMessage}>{message}</Text>
      <Button variant="secondary" size="sm" label="Try again" icon="refresh-cw" onPress={onRetry} />
    </View>
  );
}

function ErrorInline({ message }: { message: string }) {
  return (
    <View style={styles.errorInline}>
      <Feather name="alert-triangle" size={13} color={colors.error} />
      <Text style={styles.errorInlineText}>{message}</Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  topBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 18, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: colors.borderLight,
    backgroundColor: colors.surface,
  },
  topBarBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 6, paddingVertical: 4,
  },
  topBarText: { fontSize: 12, color: colors.textSecondary, fontWeight: '500' },

  scrollContent: {
    paddingHorizontal: 28,
    paddingTop: 28,
    paddingBottom: 48,
    maxWidth: 760,
    width: '100%',
    alignSelf: 'center',
  },

  eyebrow: {
    fontSize: 10, color: colors.primary, fontWeight: '700',
    letterSpacing: tracking.wider, textTransform: 'uppercase',
  },
  title: {
    fontSize: 32, color: colors.text,
    fontFamily: font.serif, fontStyle: 'italic',
    marginTop: 4, letterSpacing: tracking.tight, lineHeight: 38,
  },
  registryName: {
    fontSize: 13, color: colors.textSecondary,
    fontFamily: font.mono, marginTop: 4,
  },
  description: {
    fontSize: 14, color: colors.textSecondary,
    lineHeight: 21, marginTop: 14, maxWidth: 620,
  },
  rule: {
    height: 1, backgroundColor: colors.borderLight,
    marginVertical: 26,
  },

  section: { marginBottom: 22 },
  sectionLabel: {
    fontSize: 10, fontWeight: '700',
    color: colors.textMuted, letterSpacing: tracking.wider,
    textTransform: 'uppercase', marginBottom: 2,
  },
  sectionDesc: {
    fontSize: 12, color: colors.textMuted,
    lineHeight: 17, marginTop: 2,
  },

  pickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  choiceChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
  },
  choiceChipActive: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  choiceChipMuted: { opacity: 0.5 },
  choiceChipLabel: {
    fontSize: 12, color: colors.textSecondary, fontWeight: '500',
  },
  choiceChipLabelActive: { color: colors.primary, fontWeight: '600' },

  summary: {
    borderWidth: 1, borderColor: colors.borderLight,
    borderRadius: radius.lg,
    paddingVertical: 4, paddingHorizontal: 14,
    backgroundColor: colors.surface,
    marginBottom: 22,
  },
  summaryRow: {
    flexDirection: 'row',
    paddingVertical: 9,
    borderBottomWidth: 1, borderBottomColor: colors.borderLight,
    gap: 14,
  },
  summaryLabel: {
    width: 90,
    fontSize: 10.5,
    color: colors.textMuted,
    fontWeight: '600',
    letterSpacing: tracking.wide,
    textTransform: 'uppercase',
    paddingTop: 2,
  },
  summaryValue: {
    flex: 1, fontSize: 12.5, color: colors.text,
    fontFamily: font.mono, lineHeight: 18,
  },
  summaryValueWarn: { color: colors.warning },

  field: { marginBottom: 14 },
  fieldHeader: {
    flexDirection: 'row', alignItems: 'center',
    gap: 6, marginBottom: 2,
  },
  fieldName: {
    fontSize: 13, color: colors.text,
    fontFamily: font.mono, fontWeight: '600',
  },
  fieldDescription: {
    fontSize: 11.5, color: colors.textMuted,
    marginVertical: 3, lineHeight: 16,
  },
  input: {
    backgroundColor: colors.inputBg,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 12, paddingVertical: 9,
    color: colors.text, fontSize: 13, fontFamily: font.mono,
    marginTop: 4,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },

  badge: {
    paddingHorizontal: 5, paddingVertical: 1,
    borderRadius: radius.xs,
  },
  badgeRequired: { backgroundColor: colors.errorSoft },
  badgeSecret: { backgroundColor: colors.mutedSoft },
  badgeText: {
    fontSize: 9, fontWeight: '700',
    letterSpacing: tracking.wide, textTransform: 'uppercase',
  },
  badgeTextRequired: { color: colors.error },
  badgeTextSecret: { color: colors.textMuted },

  suggestionChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    alignSelf: 'flex-start', marginTop: 8,
    paddingHorizontal: 10, paddingVertical: 5,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
  },
  suggestionText: { fontSize: 11.5, color: colors.primary, fontFamily: font.mono },

  errorBlock: {
    alignItems: 'center', paddingVertical: 48, gap: 10,
  },
  errorBlockTitle: {
    fontSize: 15, fontFamily: font.serif, fontStyle: 'italic',
    color: colors.text, marginTop: 6,
  },
  errorBlockMessage: {
    fontSize: 12, color: colors.textMuted,
    textAlign: 'center', maxWidth: 420, lineHeight: 18, marginBottom: 4,
  },
  errorInline: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    marginVertical: 10, padding: 10,
    borderRadius: radius.md,
    backgroundColor: colors.errorSoft,
    borderWidth: 1, borderColor: colors.errorBorder,
  },
  errorInlineText: { flex: 1, fontSize: 12, color: colors.error, lineHeight: 17 },

  loadingBox: {
    alignItems: 'center', paddingVertical: 72, gap: 10,
  },
  loadingText: { fontSize: 12, color: colors.textMuted },

  footer: {
    flexDirection: 'row', justifyContent: 'flex-end', gap: 8,
    marginTop: 18, paddingTop: 18,
    borderTopWidth: 1, borderTopColor: colors.borderLight,
  },
});
