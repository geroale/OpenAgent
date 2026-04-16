/**
 * CategorySidebar — left-rail navigation used by screens that break
 * their content into sections (Settings, Model, MCPs). Renders a small
 * uppercase header, a list of tappable categories (icon + label + short
 * description), and an optional pinned footer (used by Model to show
 * the monthly budget).
 */

import type { ReactNode } from 'react';
import Feather from '@expo/vector-icons/Feather';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { colors, radius } from '../theme';

export interface CategoryItem<T extends string = string> {
  id: T;
  label: string;
  icon: keyof typeof Feather.glyphMap;
  description?: string;
}

interface Props<T extends string> {
  title: string;
  categories: CategoryItem<T>[];
  active: T;
  onChange: (id: T) => void;
  footer?: ReactNode;
}

export default function CategorySidebar<T extends string>({
  title,
  categories,
  active,
  onChange,
  footer,
}: Props<T>) {
  return (
    <View style={styles.inner}>
      <Text style={styles.title}>{title}</Text>
      <ScrollView style={styles.list}>
        {categories.map((cat) => {
          const isActive = cat.id === active;
          return (
            <TouchableOpacity
              key={cat.id}
              style={[styles.item, isActive && styles.itemActive]}
              onPress={() => onChange(cat.id)}
              activeOpacity={0.7}
            >
              {isActive && <View style={styles.activeBar} />}
              <Feather
                name={cat.icon}
                size={14}
                color={isActive ? colors.text : colors.textMuted}
                style={styles.icon}
              />
              <View style={styles.textWrap}>
                <Text
                  style={[styles.label, isActive && styles.labelActive]}
                  numberOfLines={1}
                >
                  {cat.label}
                </Text>
                {cat.description && (
                  <Text style={styles.desc} numberOfLines={1}>
                    {cat.description}
                  </Text>
                )}
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      {footer}
    </View>
  );
}

const styles = StyleSheet.create({
  inner: { flex: 1, padding: 10 },
  title: {
    fontSize: 10, fontWeight: '600', color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 1,
    paddingHorizontal: 8, paddingVertical: 6, marginBottom: 4,
  },
  list: { flex: 1 },
  item: {
    position: 'relative',
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 7, paddingHorizontal: 10,
    borderRadius: radius.sm, marginBottom: 1,
  },
  itemActive: { backgroundColor: colors.hover },
  activeBar: {
    position: 'absolute', left: 0, top: 8, bottom: 8, width: 2,
    backgroundColor: colors.primary, borderRadius: 1,
  },
  icon: { marginRight: 10 },
  textWrap: { flex: 1 },
  label: { fontSize: 12.5, color: colors.textSecondary, fontWeight: '400' },
  labelActive: { color: colors.text, fontWeight: '500' },
  desc: { fontSize: 10.5, color: colors.textMuted, marginTop: 1 },
});
