import React, { useEffect, useState } from 'react';
import { AppState, View, Text, TextInput, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DropdownSelect } from './DropdownSelect';
import { apiRequest, getBaseUrl } from '@/services/api/client';
import type { CareerDetails } from '@/services/api/career';
import { chooseTaxonomy, taxonomyPath, taxonomyState, writeTaxonomyText, type TaxonomyKey, type TaxonomyOption } from '@/services/api/taxonomyState';

/** How long a saved option list is used without a network read. */
const FRESH_FOR_MS = 6 * 60 * 60 * 1000;

export function TaxonomyField({ fieldKey, details, onChange, label, invalid = false }: {
  fieldKey: TaxonomyKey; details: CareerDetails; onChange: (details: CareerDetails) => void; label: string; invalid?: boolean;
}) {
  const state = taxonomyState(details, fieldKey);
  const path = taxonomyPath(fieldKey, state.parentId);
  const [loaded, setLoaded] = useState<{ path: string; items: TaxonomyOption[] }>({path: '', items: []});
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    const listener = AppState.addEventListener('change', (value) => { if (value === 'active') setRefresh((v) => v + 1); });
    return () => listener.remove();
  }, []);
  useEffect(() => {
    if (state.disabled || state.freeText) return;
    let active = true;
    const key = `taxonomy:v1:${getBaseUrl()}:${path}`;
    setLoading(true); setError(false);
    void (async () => {
      try {
        const saved = await AsyncStorage.getItem(key);
        const cached = saved ? JSON.parse(saved) : null;
        if (active && Array.isArray(cached?.items) && Date.now() - cached.at < 7 * 86400000) {
          setLoaded({path, items: cached.items});
          // Reference lists change rarely: a copy under six hours old is used
          // as is, without asking the server again (2026-11-23).
          if (Date.now() - cached.at < FRESH_FOR_MS) { setLoading(false); return; }
        }
      } catch { /* A corrupt or unavailable device cache must not block a network read. */ }
      try {
        const items: TaxonomyOption[] = [];
        for (;;) {
          const page = await apiRequest<{items: TaxonomyOption[]; has_more: boolean}>(`${path}${path.includes('?') ? '&' : '?'}offset=${items.length}`);
          if (!active) return;
          items.push(...page.items);
          if (!page.has_more || !page.items.length) break;
        }
        if (active) { setLoaded({path, items}); setError(false); }
        await AsyncStorage.setItem(key, JSON.stringify({items, at: Date.now()})).catch(() => {});
      } catch { if (active) setError(true); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [path, state.disabled, state.freeText, refresh]);
  const items = loaded.path === path ? loaded.items : [];
  const duplicate = state.other && items.find((item) => item.name.trim().toLocaleLowerCase() === String(details[fieldKey] || '').trim().toLocaleLowerCase());
  const choose = (value: string) => onChange(chooseTaxonomy(details, fieldKey, value === '__other__' ? 'other' : items.find((item) => item.id === value) || null));
  return <View style={styles.wrap}>
    {!state.freeText && <DropdownSelect searchable modalTitle={label} invalid={invalid} disabled={state.disabled}
      placeholder={state.disabled ? 'Choose the preceding field first' : 'Select'} selectedLabel={state.id ? String(details[fieldKey] || '') : undefined}
      value={state.other ? '__other__' : state.id} options={[{value: '', label: 'Select'}, ...items.map((item) => ({value: item.id, label: item.name})), {value: '__other__', label: 'Others'}]}
      onOpen={() => setRefresh((v) => v + 1)} onChange={choose} />}
    {(state.other || state.freeText) && <TextInput accessibilityLabel={`Other ${label}`} maxLength={160}
      style={[styles.input, invalid && styles.invalid]} placeholder={`Enter ${label.toLowerCase()}`} placeholderTextColor="#9AA1AE"
      value={String(details[fieldKey] || '')} onChangeText={(text) => onChange(writeTaxonomyText(details, fieldKey, text))} />}
    {loading && !state.freeText && !state.disabled && <ActivityIndicator accessibilityLabel="Refreshing options" color="#5F4DB2" />}
    {!!duplicate && <Pressable onPress={() => choose(duplicate.id)}><Text style={styles.help}>This option already exists. Choose {duplicate.name}.</Text></Pressable>}
    {error && !state.freeText && !state.disabled && <Pressable accessibilityRole="button" onPress={() => setRefresh((v) => v + 1)}><Text style={styles.error}>Options could not be refreshed. Tap to retry.</Text></Pressable>}
    {!loading && !error && !state.disabled && !state.freeText && !items.length && <Text style={styles.help}>No options yet. Choose Others to enter your answer.</Text>}
  </View>;
}
const styles = StyleSheet.create({
  wrap: {gap: 8}, input: {minHeight: 52, borderWidth: 1, borderColor: '#DDD6C7', borderRadius: 14, backgroundColor: '#FFFFFF', paddingHorizontal: 14, paddingVertical: 13, color: '#0A1931', fontFamily: 'GeneralSans-Regular', fontSize: 16},
  invalid: {borderColor: '#A33A2B'}, help: {fontFamily: 'GeneralSans-Regular', fontSize: 13, color: '#5F4DB2'}, error: {fontFamily: 'GeneralSans-Regular', fontSize: 13, color: '#A33A2B'},
});
