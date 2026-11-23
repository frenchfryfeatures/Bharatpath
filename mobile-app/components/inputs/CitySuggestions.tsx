/**
 * Indian city suggestions under a city field (2026-11-23).
 *
 * Reads the curated catalogue (`GET /reference/cities`, public so sign-up can
 * use it) as the person types. Suggestions only: any town can still be typed,
 * because the catalogue cannot list every place someone lives. Rendered
 * inline under the field -- not a floating dropdown -- so the keyboard and
 * the system navigation bar can never hide it.
 */
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { apiRequest } from '@/services/api/client';

export interface CityChoice {
  key: string;
  label: string;
  /** Two-letter state code, e.g. MH. */
  state_code?: string | null;
}

/** The term being typed: for a comma-separated list, the last entry. */
export function cityQuery(value: string, list = false): string {
  const text = list ? value.split(',').pop() ?? '' : value;
  return text.trim();
}

export function CitySuggestions({
  value,
  onPick,
  list = false,
  visible = true,
}: {
  value: string;
  onPick: (city: string) => void;
  /** The field holds comma-separated places; a pick replaces the last one. */
  list?: boolean;
  visible?: boolean;
}) {
  const query = cityQuery(value, list);
  const [items, setItems] = useState<CityChoice[]>([]);

  useEffect(() => {
    if (!visible || query.length < 2) {
      setItems([]);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      apiRequest<{ items: CityChoice[] }>(`/reference/cities?q=${encodeURIComponent(query)}&limit=8`)
        .then((page) => { if (active) setItems(page.items ?? []); })
        .catch(() => { if (active) setItems([]); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [query, visible]);

  // Hide once the field already says exactly one of them.
  const exact = items.some((item) => item.label.toLowerCase() === query.toLowerCase());
  if (!visible || !items.length || exact) return null;

  const pick = (label: string) => {
    if (!list) return onPick(label);
    const parts = value.split(',').map((part) => part.trim()).filter(Boolean);
    parts.pop();
    onPick([...parts, label].join(', '));
  };

  return (
    <ScrollView
      horizontal
      keyboardShouldPersistTaps="handled"
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      accessibilityLabel="City suggestions"
    >
      {items.map((item) => (
        <Pressable
          key={item.key}
          onPress={() => pick(item.label)}
          accessibilityRole="button"
          accessibilityLabel={`Use ${item.label}${item.state_code ? `, ${item.state_code}` : ''}`}
          style={({ pressed }) => [styles.chip, pressed && { opacity: 0.75 }]}
        >
          <Text style={styles.label} numberOfLines={1}>
            {item.label}
            {item.state_code ? <Text style={styles.state}>{`  ${item.state_code}`}</Text> : null}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: 8, paddingTop: 8, alignItems: 'center' },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: '#F1EAF7',
    borderWidth: 1,
    borderColor: '#C9BEEB',
    maxWidth: 260,
  },
  label: { fontFamily: 'GeneralSans-Semibold', fontSize: 13, lineHeight: 16, color: '#4A3E8F' },
  state: { fontFamily: 'GeneralSans-Regular', fontSize: 12, color: '#5F6B80' },
});
