import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { useConnection } from '../stores/connection';
import { useChat } from '../stores/chat';
import { ConfirmProvider } from '../components/ConfirmDialog';
import Header from '../components/Header';
import { colors } from '../theme';

export default function RootLayout() {
  const ws = useConnection((s) => s.ws);
  const handleServerMessage = useChat((s) => s.handleServerMessage);
  const loadAccounts = useConnection((s) => s.loadAccounts);

  useEffect(() => { loadAccounts(); }, []);

  useEffect(() => {
    if (!ws) return;
    return ws.onMessage((msg) => {
      if (msg.type === 'status' || msg.type === 'response' || msg.type === 'error') {
        handleServerMessage(msg);
      }
    });
  }, [ws, handleServerMessage]);

  return (
    <ConfirmProvider>
      <View style={styles.root}>
        {Platform.OS === 'web' && <Header />}
        <View style={styles.content}>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="(tabs)" />
          </Stack>
        </View>
      </View>
    </ConfirmProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1 },
});
