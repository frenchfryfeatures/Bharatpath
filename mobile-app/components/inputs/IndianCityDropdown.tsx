/**
 * Shared Indian City Dropdown (single-select & multi-select).
 *
 * Backed by `country-state-city` (all Indian cities & states offline, zero
 * latency) with major Indian metros prioritized when browsing and instant
 * search across city names, state names, and common aliases (e.g. Bangalore /
 * Bengaluru, Gurgaon / Gurugram).
 *
 * Used uniformly across:
 *  - Job Filters (multi-select)
 *  - Job Preferences -> Preferred work locations (multi-select)
 *  - Onboarding / Profile Details -> Current city (single-select) & Preferred locations (multi-select)
 */
import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { City, State } from 'country-state-city';
import { CaretDown, Check, MagnifyingGlass, MapPin, X } from 'phosphor-react-native';
import { AppModal as Modal } from '@/components/layout/AppModal';
import { Colors, Radii } from '@/theme/tokens';

export interface IndianCityOption {
  name: string;
  stateName: string;
  stateCode: string;
  key: string;
  searchKey: string;
}

const PRIORITY_CITIES = [
  'Bengaluru',
  'Mumbai',
  'New Delhi',
  'Delhi',
  'Noida',
  'Gurugram',
  'Hyderabad',
  'Pune',
  'Chennai',
  'Kolkata',
  'Ahmedabad',
  'Jaipur',
  'Chandigarh',
  'Indore',
  'Kochi',
  'Lucknow',
  'Surat',
  'Nagpur',
  'Coimbatore',
  'Bhopal',
  'Visakhapatnam',
  'Vadodara',
  'Kanpur',
  'Patna',
  'Thane',
  'Navi Mumbai',
  'Faridabad',
  'Ghaziabad',
  'Greater Noida',
];

const CITY_ALIASES: Record<string, string[]> = {
  bengaluru: ['bangalore', 'blr'],
  bangalore: ['bengaluru', 'blr'],
  gurugram: ['gurgaon'],
  gurgaon: ['gurugram'],
  mumbai: ['bombay'],
  chennai: ['madras'],
  kolkata: ['calcutta'],
  kochi: ['cochin'],
  thiruvananthapuram: ['trivandrum'],
  pune: ['poona'],
  varanasi: ['banaras', 'benares'],
  prayagraj: ['allahabad'],
  vadodara: ['baroda'],
  visakhapatnam: ['vizag'],
  mysuru: ['mysore'],
  mangaluru: ['mangalore'],
  'new delhi': ['delhi', 'ncr'],
  delhi: ['new delhi', 'ncr'],
};

let cachedIndianCities: IndianCityOption[] | null = null;

function getAllIndianCities(): IndianCityOption[] {
  if (cachedIndianCities) return cachedIndianCities;

  const stateMap = new Map<string, string>();
  for (const st of State.getStatesOfCountry('IN')) {
    stateMap.set(st.isoCode, st.name);
  }

  const seen = new Set<string>();
  const raw: IndianCityOption[] = [];

  const pushCity = (name: string, stateCode: string) => {
    const clean = name.trim();
    if (!clean) return;
    const dedupeKey = `${clean.toLowerCase()}|${stateCode.toLowerCase()}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    const stateName = stateMap.get(stateCode) || stateCode;
    const aliases = CITY_ALIASES[clean.toLowerCase()] || [];
    raw.push({
      name: clean,
      stateName,
      stateCode,
      key: dedupeKey,
      searchKey: `${clean} ${stateName} ${stateCode} ${aliases.join(' ')}`.toLowerCase(),
    });
  };

  // Ensure common modern Indian names are always present alongside library names.
  pushCity('Bengaluru', 'KA');
  pushCity('Gurugram', 'HR');
  pushCity('Noida', 'UP');
  pushCity('Greater Noida', 'UP');
  pushCity('Navi Mumbai', 'MH');
  pushCity('New Delhi', 'DL');
  pushCity('Delhi', 'DL');

  const libraryCities = City.getCitiesOfCountry('IN') || [];
  for (const c of libraryCities) {
    pushCity(c.name, c.stateCode);
  }

  const priorityRank = new Map<string, number>();
  PRIORITY_CITIES.forEach((name, idx) => priorityRank.set(name.toLowerCase(), idx));

  raw.sort((a, b) => {
    const ra = priorityRank.get(a.name.toLowerCase());
    const rb = priorityRank.get(b.name.toLowerCase());
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return a.name.localeCompare(b.name);
  });

  cachedIndianCities = raw;
  return cachedIndianCities;
}

export interface IndianCityDropdownProps {
  multiple?: boolean;
  /** Single-select value (when multiple is false). */
  value?: string;
  /** Single-select change handler. */
  onChange?: (city: string) => void;
  /** Multi-select values (when multiple is true). */
  values?: string[];
  /** Multi-select change handler. */
  onChangeValues?: (cities: string[]) => void;
  placeholder?: string;
  modalTitle?: string;
  maxSelections?: number;
  invalid?: boolean;
  disabled?: boolean;
  compact?: boolean;
}

export function IndianCityDropdown({
  multiple = false,
  value = '',
  onChange,
  values = [],
  onChangeValues,
  placeholder,
  modalTitle,
  maxSelections,
  invalid = false,
  disabled = false,
  compact = false,
}: IndianCityDropdownProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const allCities = useMemo(() => (open ? getAllIndianCities() : []), [open]);

  const filtered = useMemo(() => {
    if (!open) return [];
    const q = query.trim().toLowerCase();
    if (!q) return allCities.slice(0, 80);
    const startsWith: IndianCityOption[] = [];
    const contains: IndianCityOption[] = [];
    for (const item of allCities) {
      if (item.name.toLowerCase().startsWith(q)) {
        startsWith.push(item);
      } else if (item.searchKey.includes(q)) {
        contains.push(item);
      }
      if (startsWith.length + contains.length >= 120) break;
    }
    return [...startsWith, ...contains].slice(0, 80);
  }, [allCities, open, query]);

  const normalizedSelected = useMemo(
    () => new Set(values.map((v) => v.trim().toLowerCase())),
    [values],
  );

  const atLimit = Boolean(multiple && maxSelections && values.length >= maxSelections);

  const handleOpen = () => {
    if (disabled) return;
    Keyboard.dismiss();
    setQuery('');
    setOpen(true);
  };

  const toggleMulti = (cityName: string) => {
    const exists = normalizedSelected.has(cityName.toLowerCase());
    if (exists) {
      onChangeValues?.(values.filter((v) => v.toLowerCase() !== cityName.toLowerCase()));
    } else {
      if (atLimit) return;
      onChangeValues?.([...values, cityName]);
    }
  };

  const selectSingle = (cityName: string) => {
    onChange?.(cityName);
    setOpen(false);
  };

  const triggerLabel = multiple
    ? values.length > 0
      ? values.length === 1
        ? values[0]
        : `${values.length} cities selected`
      : placeholder || 'Select Indian cities'
    : value?.trim() || placeholder || 'Select city';

  const hasValue = multiple ? values.length > 0 : Boolean(value?.trim());

  return (
    <View style={styles.wrap}>
      <Pressable
        disabled={disabled}
        onPress={handleOpen}
        accessibilityRole="button"
        accessibilityLabel={modalTitle || (multiple ? 'Select Indian cities' : 'Select city')}
        style={({ pressed }) => [
          styles.trigger,
          compact && styles.triggerCompact,
          invalid && styles.triggerInvalid,
          disabled && styles.triggerDisabled,
          pressed && styles.triggerPressed,
        ]}
      >
        <MapPin size={16} color={hasValue ? '#5F4DB2' : '#5F6B80'} weight="bold" />
        <Text
          style={[styles.triggerText, !hasValue && styles.triggerPlaceholder]}
          numberOfLines={1}
        >
          {triggerLabel}
        </Text>
        {!multiple && Boolean(value?.trim()) && !disabled ? (
          <Pressable
            hitSlop={8}
            onPress={(e) => {
              e.stopPropagation();
              onChange?.('');
            }}
            accessibilityRole="button"
            accessibilityLabel="Clear city"
          >
            <X size={15} color="#5F6B80" weight="bold" />
          </Pressable>
        ) : (
          <CaretDown size={16} color="#5F6B80" weight="bold" />
        )}
      </Pressable>

      {multiple && values.length > 0 && (
        <View style={styles.chips} accessibilityLabel="Selected cities">
          {values.map((city) => (
            <View key={city} style={styles.chip}>
              <Text style={styles.chipText} numberOfLines={1}>
                {city}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${city}`}
                hitSlop={8}
                onPress={() =>
                  onChangeValues?.(values.filter((c) => c.toLowerCase() !== city.toLowerCase()))
                }
              >
                <X size={13} color="#4A3E8F" weight="bold" />
              </Pressable>
            </View>
          ))}
        </View>
      )}

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.overlay}
        >
          <TouchableWithoutFeedback onPress={() => setOpen(false)}>
            <View style={styles.backdrop} />
          </TouchableWithoutFeedback>

          <View style={styles.sheet}>
            <View style={styles.dragHandle} />
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle}>
                  {modalTitle || (multiple ? 'Select Indian cities' : 'Select Indian city')}
                </Text>
                {multiple && maxSelections ? (
                  <Text style={styles.sheetSubtitle}>
                    {values.length} of {maxSelections} selected
                  </Text>
                ) : multiple && values.length > 0 ? (
                  <Text style={styles.sheetSubtitle}>
                    {values.length} {values.length === 1 ? 'city' : 'cities'} selected
                  </Text>
                ) : null}
              </View>
              <Pressable
                onPress={() => setOpen(false)}
                hitSlop={12}
                style={styles.closeBtn}
                accessibilityRole="button"
                accessibilityLabel="Close city selector"
              >
                <X size={18} color={Colors.navy} weight="bold" />
              </Pressable>
            </View>

            <View style={styles.searchWrap}>
              <MagnifyingGlass size={16} color="#5F6B80" weight="bold" />
              <TextInput
                style={styles.searchInput}
                placeholder="Search any Indian city or state..."
                placeholderTextColor="#8A93A5"
                value={query}
                onChangeText={setQuery}
                autoCorrect={false}
                autoCapitalize="words"
                accessibilityLabel="Search Indian cities"
              />
              {query.length > 0 && (
                <Pressable hitSlop={8} onPress={() => setQuery('')} accessibilityRole="button">
                  <X size={15} color="#5F6B80" weight="bold" />
                </Pressable>
              )}
            </View>

            <FlatList
              data={filtered}
              keyExtractor={(item) => item.key}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
              initialNumToRender={20}
              maxToRenderPerBatch={20}
              windowSize={5}
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={
                <View style={styles.emptyWrap}>
                  <Text style={styles.emptyText}>No matching Indian city found.</Text>
                </View>
              }
              renderItem={({ item }) => {
                const isSelected = multiple
                  ? normalizedSelected.has(item.name.toLowerCase())
                  : value.trim().toLowerCase() === item.name.toLowerCase();
                const rowDisabled = multiple && !isSelected && atLimit;
                return (
                  <Pressable
                    disabled={rowDisabled}
                    onPress={() => (multiple ? toggleMulti(item.name) : selectSingle(item.name))}
                    style={({ pressed }) => [
                      styles.optionRow,
                      isSelected && styles.optionRowSelected,
                      rowDisabled && { opacity: 0.45 },
                      pressed && !rowDisabled && styles.optionRowPressed,
                    ]}
                  >
                    <View style={styles.optionCopy}>
                      <Text
                        style={[
                          styles.optionLabel,
                          isSelected && styles.optionLabelSelected,
                        ]}
                      >
                        {item.name}
                      </Text>
                      <Text style={styles.optionState}>{item.stateName}</Text>
                    </View>
                    {multiple ? (
                      <View
                        style={[styles.checkbox, isSelected && styles.checkboxChecked]}
                      >
                        {isSelected && <Check size={13} color="#FFFFFF" weight="bold" />}
                      </View>
                    ) : (
                      isSelected && <Check size={18} color="#5F4DB2" weight="bold" />
                    )}
                  </Pressable>
                );
              }}
            />

            {multiple && (
              <View style={styles.sheetFooter}>
                {values.length > 0 && (
                  <Pressable
                    style={styles.clearAllBtn}
                    onPress={() => onChangeValues?.([])}
                    accessibilityRole="button"
                  >
                    <Text style={styles.clearAllText}>Clear all</Text>
                  </Pressable>
                )}
                <Pressable
                  style={styles.doneBtn}
                  onPress={() => setOpen(false)}
                  accessibilityRole="button"
                >
                  <Text style={styles.doneBtnText}>Done</Text>
                </Pressable>
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 8,
  },
  trigger: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#DDD6C7',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  triggerCompact: {
    minHeight: 46,
    borderRadius: 12,
  },
  triggerInvalid: {
    borderColor: '#D9383A',
    backgroundColor: '#FFF7F7',
  },
  triggerDisabled: {
    opacity: 0.55,
  },
  triggerPressed: {
    backgroundColor: '#FAF7F2',
  },
  triggerText: {
    flex: 1,
    fontFamily: 'GeneralSans-Medium',
    fontSize: 15,
    color: Colors.navy,
  },
  triggerPlaceholder: {
    fontFamily: 'GeneralSans-Regular',
    color: '#8A93A5',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F1EAF7',
    borderWidth: 1,
    borderColor: '#D4C7F5',
    borderRadius: Radii.pill,
    paddingHorizontal: 11,
    paddingVertical: 6,
    maxWidth: '100%',
  },
  chipText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 12,
    color: '#4A3E8F',
    maxWidth: 180,
  },
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10, 25, 49, 0.45)',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '78%',
    paddingBottom: 12,
  },
  dragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#DDD6C7',
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 4,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0EBDF',
    gap: 12,
  },
  sheetTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 18,
    color: Colors.navy,
  },
  sheetSubtitle: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    color: '#5F6B80',
    marginTop: 2,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.surface.tint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginVertical: 12,
    paddingHorizontal: 14,
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#DDD6C7',
    backgroundColor: '#FFFCF7',
  },
  searchInput: {
    flex: 1,
    fontFamily: 'GeneralSans-Regular',
    fontSize: 14,
    color: Colors.navy,
    paddingVertical: 8,
  },
  listContent: {
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  emptyWrap: {
    paddingVertical: 28,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 14,
    color: '#5F6B80',
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
    gap: 12,
  },
  optionRowSelected: {
    backgroundColor: '#F6F2FC',
  },
  optionRowPressed: {
    backgroundColor: '#F5EFE6',
  },
  optionCopy: {
    flex: 1,
    gap: 1,
  },
  optionLabel: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 15,
    color: Colors.navy,
  },
  optionLabelSelected: {
    fontFamily: 'GeneralSans-Semibold',
    color: '#4A3E8F',
  },
  optionState: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    color: '#5F6B80',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#C5BFE0',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  checkboxChecked: {
    backgroundColor: '#5F4DB2',
    borderColor: '#5F4DB2',
  },
  sheetFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F0EBDF',
  },
  clearAllBtn: {
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderRadius: Radii.pill,
    borderWidth: 1,
    borderColor: '#DDD6C7',
    backgroundColor: '#FFFFFF',
  },
  clearAllText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 14,
    color: '#5F6B80',
  },
  doneBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: Radii.pill,
    backgroundColor: '#5F4DB2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBtnText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 15,
    color: '#FFFFFF',
  },
});
