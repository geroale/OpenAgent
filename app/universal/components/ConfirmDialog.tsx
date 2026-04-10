import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View, Platform } from 'react-native';
import { colors } from '../theme';
import PrimaryButton from './PrimaryButton';

type ConfirmOptions = {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

type ConfirmRequest = ConfirmOptions & {
  resolve: (value: boolean) => void;
};

type ConfirmFn = (options: ConfirmOptions | string) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);

  const close = useCallback((value: boolean) => {
    setRequest((current) => {
      current?.resolve(value);
      return null;
    });
  }, []);

  const confirm = useCallback<ConfirmFn>((options) => {
    const normalized = typeof options === 'string' ? { message: options } : options;

    if (Platform.OS !== 'web') {
      return new Promise((resolve) => {
        Alert.alert(
          normalized.title ?? 'Confirm',
          normalized.message,
          [
            {
              text: normalized.cancelLabel ?? 'Cancel',
              style: 'cancel',
              onPress: () => resolve(false),
            },
            {
              text: normalized.confirmLabel ?? 'Confirm',
              onPress: () => resolve(true),
            },
          ],
          { cancelable: true, onDismiss: () => resolve(false) },
        );
      });
    }

    return new Promise((resolve) => {
      setRequest({
        title: normalized.title ?? 'Confirm',
        message: normalized.message,
        confirmLabel: normalized.confirmLabel ?? 'Confirm',
        cancelLabel: normalized.cancelLabel ?? 'Cancel',
        resolve,
      });
    });
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        animationType="fade"
        transparent
        visible={!!request}
        onRequestClose={() => close(false)}
      >
        <View style={styles.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => close(false)} />
          <View style={styles.dialog}>
            <Text style={styles.title}>{request?.title}</Text>
            <Text style={styles.message}>{request?.message}</Text>
            <View style={styles.actions}>
              <Pressable onPress={() => close(false)} style={styles.cancelBtn}>
                <Text style={styles.cancelText}>{request?.cancelLabel}</Text>
              </Pressable>
              <PrimaryButton
                style={styles.confirmBtn}
                contentStyle={styles.confirmBtnInner}
                onPress={() => close(true)}
              >
                <Text style={styles.confirmText}>{request?.confirmLabel}</Text>
              </PrimaryButton>
            </View>
          </View>
        </View>
      </Modal>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const confirm = useContext(ConfirmContext);
  if (!confirm) {
    throw new Error('useConfirm must be used within ConfirmProvider');
  }
  return confirm;
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: 'rgba(12, 8, 4, 0.28)',
  },
  dialog: {
    width: 420,
    maxWidth: '100%',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.14,
    shadowRadius: 32,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 8,
  },
  message: {
    fontSize: 14,
    lineHeight: 21,
    color: colors.textSecondary,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 18,
  },
  cancelBtn: {
    minHeight: 40,
    paddingHorizontal: 14,
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cancelText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  confirmBtn: {},
  confirmBtnInner: {
    minHeight: 40,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  confirmText: {
    color: colors.textInverse,
    fontSize: 14,
    fontWeight: '700',
  },
});
