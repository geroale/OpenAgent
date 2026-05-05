/**
 * Login screen — saved networks list + join/sign-in form.
 *
 * Two paths:
 *   1. "Sign in" — pick a saved account, enter the password, connect.
 *      Cert is refreshed under the hood; no other data needed.
 *   2. "Join with invite" — first-time on this device. Paste the
 *      ``oa1…`` ticket the network owner gave you, choose a handle,
 *      set a password. The ticket carries the network name, coordinator
 *      NodeId, invite code, and role — the renderer never sees those
 *      individually.
 */

import { colors, font, radius } from '../theme';
import Feather from '@expo/vector-icons/Feather';
import { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useConnection } from '../stores/connection';
import { useChat } from '../stores/chat';
import { useConfirm } from '../components/ConfirmDialog';
import Button from '../components/Button';
import Card from '../components/Card';
import Input from '../components/Input';
import { JarvisOrb, JarvisClock } from '../components/jarvis';

type Mode = 'signin' | 'join';

export default function LoginScreen() {
  const router = useRouter();
  const {
    accounts, isConnected, isConnecting, error, agentName,
    joinNetwork, connectAccount, removeAccount,
  } = useConnection();
  const createSession = useChat((s) => s.createSession);
  const getOrCreateVoiceSession = useChat((s) => s.getOrCreateVoiceSession);
  const confirm = useConfirm();

  // Default to the join form when no accounts exist; switch to sign-in
  // when the user has at least one network on this device.
  const [mode, setMode] = useState<Mode>(accounts.length > 0 ? 'signin' : 'join');

  // Sign-in form
  const [signinAccountId, setSigninAccountId] = useState<string | null>(null);
  const [signinPassword, setSigninPassword] = useState('');

  // Join form — one ticket string, optional handle (the user picks
  // theirs only for role=user tickets; role=device tickets carry the
  // bound handle and the loopback ignores ours), and a password.
  const [joinTicket, setJoinTicket] = useState('');
  const [joinHandle, setJoinHandle] = useState('');
  const [joinPassword, setJoinPassword] = useState('');

  // Only redirect when the user actually pressed "Sign in" / "Join" on
  // this screen and the connection then succeeded. The previous
  // "redirect whenever isConnected is true" logic bounced the user to
  // /(tabs)/chat the instant the screen mounted while a stale
  // ``isConnected: true`` was still latched (e.g. the header's + button
  // hadn't finished tearing down) — landing them on an empty chat.
  const attemptedRef = useRef(false);
  useEffect(() => {
    if (attemptedRef.current && isConnected && agentName) {
      attemptedRef.current = false;
      createSession();
      getOrCreateVoiceSession();
      router.replace('/(tabs)/chat');
    }
  }, [isConnected, agentName]);

  // Auto-select the first account when sign-in mode opens with one in
  // the list — saves the user a click on the common case.
  useEffect(() => {
    if (mode === 'signin' && signinAccountId === null && accounts.length > 0) {
      setSigninAccountId(accounts[0].id);
    }
  }, [mode, accounts.length]);

  const hasSaved = accounts.length > 0;

  const handleSignIn = () => {
    if (!signinAccountId || !signinPassword) return;
    attemptedRef.current = true;
    void connectAccount(signinAccountId, signinPassword);
    setSigninPassword('');
  };

  const handleJoin = () => {
    const ticket = joinTicket.trim();
    const handle = joinHandle.trim().toLowerCase();
    if (!ticket || !handle || !joinPassword) return;
    if (!ticket.startsWith('oa1')) return;
    attemptedRef.current = true;
    void joinNetwork({
      ticket,
      handle,
      password: joinPassword,
      isLocal: false,
    });
    setJoinPassword('');
  };

  const ErrorBox = ({ message }: { message: string }) => (
    <View style={styles.errorBox}>
      <Feather
        name="alert-triangle"
        size={14}
        color={colors.error}
        style={styles.errorIcon}
      />
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );

  const handleRemove = async (id: string, accName: string) => {
    const confirmed = await confirm({
      title: 'Remove network',
      message: `Forget "${accName}"? You'll need the invite + password again to rejoin.`,
      confirmLabel: 'Forget',
    });
    if (!confirmed) return;
    void removeAccount(id);
    if (signinAccountId === id) setSigninAccountId(null);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View
        style={styles.inner}
        // @ts-ignore
        {...(Platform.OS === 'web' ? { className: 'oa-slide-up' } : {})}
      >
        <View style={styles.wakeScene}>
          <JarvisOrb size={180} label="OPENAGENT" />
          <View style={styles.clockWrap}>
            <JarvisClock size="md" />
          </View>
        </View>

        {hasSaved && (
          <>
            <Text style={styles.sectionKicker}>Your networks</Text>
            <Card padded={false}>
              {accounts.map((acc, i) => {
                const selected = mode === 'signin' && signinAccountId === acc.id;
                return (
                  <TouchableOpacity
                    key={acc.id}
                    onPress={() => {
                      setMode('signin');
                      setSigninAccountId(acc.id);
                    }}
                    style={[
                      styles.accountRow,
                      i > 0 && styles.accountRowBorder,
                      selected && styles.accountRowSelected,
                    ]}
                  >
                    <View style={styles.accountInfo}>
                      <Text style={styles.accountName}>{acc.handle}@{acc.network || '…'}</Text>
                      <Text style={styles.accountHost}>{acc.name}</Text>
                    </View>
                    {selected && (
                      <Feather name="check" size={14} color={colors.accent} style={{ marginRight: 8 }} />
                    )}
                    <TouchableOpacity
                      style={styles.deleteBtn}
                      onPress={() => { void handleRemove(acc.id, acc.name); }}
                      hitSlop={8}
                    >
                      <Feather name="x" size={13} color={colors.textMuted} />
                    </TouchableOpacity>
                  </TouchableOpacity>
                );
              })}
            </Card>
          </>
        )}

        {/* Mode toggle. Shown when there are saved accounts so the user
            can flip to "join" without losing their list. With no saved
            accounts we hide the toggle and show join only. */}
        {hasSaved && (
          <View style={styles.tabs}>
            <TouchableOpacity
              onPress={() => setMode('signin')}
              style={[styles.tab, mode === 'signin' && styles.tabActive]}
            >
              <Text style={[styles.tabLabel, mode === 'signin' && styles.tabLabelActive]}>
                Sign in
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setMode('join')}
              style={[styles.tab, mode === 'join' && styles.tabActive]}
            >
              <Text style={[styles.tabLabel, mode === 'join' && styles.tabLabelActive]}>
                Join with invite
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {!hasSaved && (
          <Text style={[styles.sectionKicker, { marginTop: 12 }]}>Join a network</Text>
        )}
        {!hasSaved && (
          <Text style={styles.subtitle}>
            Connect to an OpenAgent network. Need an invite code from the network owner.
          </Text>
        )}

        {mode === 'signin' && hasSaved && (
          <Card>
            <Text style={styles.formHint}>
              Selected: <Text style={styles.formHintMono}>
                {accounts.find((a) => a.id === signinAccountId)?.handle}
                @{accounts.find((a) => a.id === signinAccountId)?.network}
              </Text>
            </Text>
            <Input
              label="Password"
              value={signinPassword}
              onChangeText={setSigninPassword}
              placeholder="••••••••"
              secureTextEntry
              containerStyle={{ marginTop: 12 }}
              onSubmitEditing={handleSignIn}
            />
            {error && <ErrorBox message={error} />}
            <Button
              variant="primary"
              size="md"
              fullWidth
              label={isConnecting ? 'Connecting…' : 'Sign in'}
              onPress={handleSignIn}
              disabled={isConnecting || !signinPassword || !signinAccountId}
              style={{ marginTop: 14 }}
            />
          </Card>
        )}

        {mode === 'join' && (
          <Card>
            <Input
              label="Invite ticket"
              value={joinTicket}
              onChangeText={setJoinTicket}
              placeholder="oa1abcdef… (paste from `openagent network invite`)"
              autoCapitalize="none"
              autoCorrect={false}
              mono
              containerStyle={{ marginTop: 0 }}
            />
            <Text style={styles.fieldHint}>
              The ticket carries the network name, coordinator address, and invite code in
              one string. Ask the network owner to run [openagent network invite] and send
              you the [oa1…] line.
            </Text>

            <Input
              label="Handle"
              value={joinHandle}
              onChangeText={setJoinHandle}
              placeholder="alice"
              autoCapitalize="none"
              autoCorrect={false}
              mono
              containerStyle={{ marginTop: 12 }}
            />
            <Text style={styles.fieldHint}>
              Choose the handle you want in this network. Ignored for device-pairing
              tickets (those are bound to an existing handle).
            </Text>

            <Input
              label="Password"
              value={joinPassword}
              onChangeText={setJoinPassword}
              placeholder="••••••••"
              secureTextEntry
              containerStyle={{ marginTop: 12 }}
              onSubmitEditing={handleJoin}
            />

            {error && <ErrorBox message={error} />}

            <Button
              variant="primary"
              size="md"
              fullWidth
              label={isConnecting ? 'Joining…' : 'Join network'}
              onPress={handleJoin}
              disabled={
                isConnecting || !joinTicket.trim().startsWith('oa1') ||
                !joinHandle || !joinPassword
              }
              style={{ marginTop: 14 }}
            />
          </Card>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: colors.bg,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  inner: {
    width: 460,
    maxWidth: '100%',
  },
  wakeScene: {
    alignItems: 'center',
    marginBottom: 32,
    marginTop: 8,
  },
  clockWrap: {
    marginTop: 12,
  },
  sectionKicker: {
    fontSize: 10, fontWeight: '600', color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 1,
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 14,
    marginTop: -4,
  },

  // Saved networks
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  accountRowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  accountRowSelected: {
    backgroundColor: colors.surface,
  },
  accountInfo: {
    flex: 1,
  },
  accountName: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.text,
    letterSpacing: -0.1,
    fontFamily: font.mono,
  },
  accountHost: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
    fontFamily: font.mono,
  },
  deleteBtn: {
    padding: 8,
  },

  // Mode tabs
  tabs: {
    flexDirection: 'row',
    marginTop: 24,
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  tab: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginRight: 8,
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: colors.accent,
    marginBottom: -1,
  },
  tabLabel: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '500',
  },
  tabLabelActive: {
    color: colors.text,
  },

  // Form
  fieldRow: { flexDirection: 'row' },
  fieldHint: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 6,
    lineHeight: 15,
  },
  formHint: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  formHintMono: {
    fontFamily: font.mono,
    color: colors.text,
  },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.errorSoft,
    borderWidth: 1,
    borderColor: colors.errorBorder,
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 12,
  },
  errorIcon: {
    marginTop: 1,
    marginRight: 8,
  },
  errorText: {
    flex: 1,
    color: colors.error,
    fontSize: 12.5,
    lineHeight: 17,
  },
});
