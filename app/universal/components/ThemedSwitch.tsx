import type { StyleProp, ViewStyle } from 'react-native';
import { Platform, Pressable, StyleSheet, Switch, View } from 'react-native';
import { colors } from '../theme';

interface ThemedSwitchProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export default function ThemedSwitch({
  value,
  onValueChange,
  disabled = false,
  style,
}: ThemedSwitchProps) {
  if (Platform.OS !== 'web') {
    return (
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: colors.border, true: colors.primary }}
        thumbColor={colors.surface}
      />
    );
  }

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      style={({ pressed }) => [
        styles.webRoot,
        disabled && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}
    >
      <View style={[styles.track, value ? styles.trackOn : styles.trackOff]}>
        <View style={[styles.thumb, value ? styles.thumbOn : styles.thumbOff]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  webRoot: {
    padding: 2,
    borderRadius: 999,
  },
  disabled: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.82,
  },
  track: {
    width: 40,
    height: 24,
    borderRadius: 999,
    padding: 3,
    justifyContent: 'center',
  },
  trackOn: {
    backgroundColor: colors.primary,
  },
  trackOff: {
    backgroundColor: colors.border,
  },
  thumb: {
    width: 18,
    height: 18,
    borderRadius: 999,
    backgroundColor: colors.surface,
    shadowColor: 'rgba(28, 22, 18, 0.22)',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 2,
  },
  thumbOn: {
    transform: [{ translateX: 16 }],
  },
  thumbOff: {
    transform: [{ translateX: 0 }],
  },
});
