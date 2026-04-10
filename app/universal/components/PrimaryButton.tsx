import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import type { StyleProp, TextStyle, TouchableOpacityProps, ViewStyle } from 'react-native';
import { TouchableOpacity, StyleSheet, Text } from 'react-native';
import { colors, primaryGradientStops } from '../theme';

interface PrimaryButtonProps extends TouchableOpacityProps {
  label?: string;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

export default function PrimaryButton({
  label,
  children,
  disabled,
  style,
  contentStyle,
  textStyle,
  activeOpacity = 0.92,
  ...props
}: PrimaryButtonProps) {
  return (
    <TouchableOpacity
      activeOpacity={activeOpacity}
      disabled={disabled}
      style={[styles.touchable, disabled && styles.disabled, style]}
      {...props}
    >
      <LinearGradient
        colors={[...primaryGradientStops]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.gradient, contentStyle]}
      >
        {children ?? <Text style={[styles.label, textStyle]}>{label}</Text>}
      </LinearGradient>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  touchable: {
    borderRadius: 10,
    overflow: 'hidden',
  },
  disabled: {
    opacity: 0.45,
  },
  gradient: {
    minHeight: 40,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
  },
  label: {
    color: colors.textInverse,
    fontSize: 14,
    fontWeight: '700',
  },
});
