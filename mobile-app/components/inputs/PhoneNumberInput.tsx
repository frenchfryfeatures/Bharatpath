import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Modal,
  FlatList,
  StyleSheet,
  StyleProp,
  ViewStyle,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
} from 'react-native';
import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js';
import { CaretDown, Check, MagnifyingGlass, X } from 'phosphor-react-native';
import { Colors } from '@/theme/tokens';

export interface PhoneNumberInputProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  hint?: string;
  error?: string;
  placeholder?: string;
  disabled?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  indiaOnly?: boolean;
  style?: StyleProp<ViewStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  autoFocus?: boolean;
}

export interface CountryItem {
  code: CountryCode;
  name: string;
  dialCode: string;
  callingCodeNumber: string;
  flag: string;
}

const regionNames =
  typeof Intl !== 'undefined' && Intl.DisplayNames
    ? new Intl.DisplayNames(['en'], { type: 'region' })
    : null;

function getFlagEmoji(countryCode: string): string {
  try {
    const codePoints = [...countryCode.toUpperCase()].map(
      (c) => 127397 + c.charCodeAt(0),
    );
    return String.fromCodePoint(...codePoints);
  } catch {
    return '🌐';
  }
}

const ALL_COUNTRIES: CountryItem[] = getCountries()
  .map((code) => {
    const callingCodeNumber = getCountryCallingCode(code);
    const name = regionNames?.of(code) || code;
    return {
      code,
      name,
      dialCode: `+${callingCodeNumber}`,
      callingCodeNumber,
      flag: getFlagEmoji(code),
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

const POPULAR_CODES: CountryCode[] = [
  'IN',
  'US',
  'GB',
  'AE',
  'CA',
  'AU',
  'SG',
  'DE',
];

const POPULAR_COUNTRIES: CountryItem[] = POPULAR_CODES.map((c) =>
  ALL_COUNTRIES.find((item) => item.code === c),
).filter((c): c is CountryItem => !!c);

const ALL_COUNTRIES_LIST = [
  ...POPULAR_COUNTRIES,
  ...ALL_COUNTRIES.filter((c) => !POPULAR_CODES.includes(c.code)),
];

function countryFromValue(value: string): CountryCode | undefined {
  if (!value || !value.startsWith('+')) return undefined;
  const parsed = parsePhoneNumberFromString(value);
  if (parsed?.country) return parsed.country;
  const digits = value.slice(1).replace(/\D/g, '');
  return getCountries()
    .filter((country) => digits.startsWith(getCountryCallingCode(country)))
    .sort(
      (a, b) =>
        getCountryCallingCode(b).length - getCountryCallingCode(a).length,
    )[0];
}

function nationalFromValue(value: string, country: CountryCode): string {
  const digits = value.replace(/\D/g, '');
  const dialCode = getCountryCallingCode(country);
  return value.trim().startsWith('+') && digits.startsWith(dialCode)
    ? digits.slice(dialCode.length)
    : digits;
}

export function PhoneNumberInput({
  value,
  onChange,
  label,
  hint = 'Select your country code, then enter your mobile number.',
  error,
  placeholder = 'Mobile number',
  disabled = false,
  onFocus,
  onBlur,
  indiaOnly = false,
  style,
  containerStyle,
  accessibilityLabel = 'Mobile number',
  autoFocus = false,
}: PhoneNumberInputProps) {
  const [modalVisible, setModalVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const initialCountry = countryFromValue(value) ?? ('IN' as CountryCode);
  const [selectedCountry, setSelectedCountry] =
    useState<CountryCode>(initialCountry);
  const [nationalDigits, setNationalDigits] = useState<string>(() =>
    nationalFromValue(value, initialCountry),
  );

  // Sync state if external value changes (e.g. from resume parsing or reset)
  useEffect(() => {
    const derivedCountry = countryFromValue(value) ?? selectedCountry;
    const derivedNational = nationalFromValue(value, derivedCountry);
    setSelectedCountry(derivedCountry);
    setNationalDigits(derivedNational);
  }, [value]);

  const dialCode = getCountryCallingCode(selectedCountry);

  const emitChange = (nextCountry: CountryCode, nextDigits: string) => {
    const parsed = parsePhoneNumberFromString(nextDigits, nextCountry);
    const nextValue = nextDigits
      ? parsed?.isPossible()
        ? parsed.number
        : `+${getCountryCallingCode(nextCountry)}${nextDigits}`
      : '';
    onChange(nextValue);
  };

  const handleNationalChange = (rawText: string) => {
    // Only accept numbers, max 15 digits according to E.164
    const digits = rawText.replace(/\D/g, '').slice(0, 15);
    setNationalDigits(digits);
    emitChange(selectedCountry, digits);
  };

  const handleSelectCountry = (country: CountryItem) => {
    setSelectedCountry(country.code);
    setModalVisible(false);
    setSearchQuery('');
    emitChange(country.code, nationalDigits);
  };

  const filteredCountries = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return ALL_COUNTRIES_LIST;

    const normalizedQuery = query.startsWith('+') ? query.slice(1) : query;
    return ALL_COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(query) ||
        c.callingCodeNumber.includes(normalizedQuery) ||
        c.code.toLowerCase().includes(query),
    );
  }, [searchQuery]);

  const hasError = Boolean(error) || (indiaOnly && selectedCountry !== 'IN');

  return (
    <View style={[styles.wrapper, containerStyle]}>
      {label ? (
        <Text style={styles.label}>
          {label.endsWith('*') ? (
            <>
              {label.slice(0, -1).trim()}{' '}
              <Text style={styles.requiredStar}>*</Text>
            </>
          ) : (
            label
          )}
        </Text>
      ) : null}

      <View
        style={[
          styles.inputContainer,
          isFocused && styles.inputContainerFocused,
          hasError && styles.inputContainerError,
          disabled && styles.inputContainerDisabled,
          style,
        ]}
      >
        {/* Country Code Trigger */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Country calling code: +${dialCode}`}
          disabled={disabled}
          onPress={() => setModalVisible(true)}
          style={({ pressed }) => [
            styles.countryButton,
            pressed && styles.countryButtonPressed,
          ]}
        >
          <Text style={styles.dialCodeText}>+{dialCode}</Text>
          <CaretDown size={14} color="#5F4DB2" weight="bold" />
        </Pressable>

        {/* Divider Line */}
        <View style={styles.divider} />

        {/* National Number Input */}
        <TextInput
          ref={inputRef}
          value={nationalDigits}
          onChangeText={handleNationalChange}
          onFocus={() => {
            setIsFocused(true);
            onFocus?.();
          }}
          onBlur={() => {
            setIsFocused(false);
            onBlur?.();
          }}
          placeholder={placeholder}
          placeholderTextColor="#9AA1AE"
          keyboardType="phone-pad"
          editable={!disabled}
          autoFocus={autoFocus}
          accessibilityLabel={accessibilityLabel}
          style={styles.textInput}
        />
      </View>

      {/* Helper text or Error message */}
      {error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : indiaOnly && selectedCountry !== 'IN' ? (
        <Text style={styles.errorText}>
          This form currently accepts Indian mobile numbers only.
        </Text>
      ) : hint ? (
        <Text style={styles.hintText}>{hint}</Text>
      ) : null}

      {/* Country Code Selection Modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          setModalVisible(false);
          setSearchQuery('');
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.modalBackdrop} />
          </TouchableWithoutFeedback>

          <View style={styles.modalSheet}>
            {/* Sheet Handle */}
            <View style={styles.dragHandle} />

            {/* Header */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Country Code</Text>
              <Pressable
                onPress={() => {
                  setModalVisible(false);
                  setSearchQuery('');
                }}
                hitSlop={12}
                style={styles.closeButton}
              >
                <X size={20} color="#1E293B" weight="bold" />
              </Pressable>
            </View>

            {/* Search Bar */}
            <View style={styles.searchBarContainer}>
              <MagnifyingGlass size={18} color="#94A3B8" weight="bold" />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search country or dial code"
                placeholderTextColor="#94A3B8"
                autoCorrect={false}
                clearButtonMode="while-editing"
                style={styles.searchInput}
              />
              {searchQuery ? (
                <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
                  <X size={16} color="#94A3B8" weight="bold" />
                </Pressable>
              ) : null}
            </View>

            {/* Country List */}
            <FlatList
              data={filteredCountries}
              keyExtractor={(item, index) => `${item.code}-${index}`}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={true}
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => {
                const isSelected = item.code === selectedCountry;
                return (
                  <Pressable
                    style={({ pressed }) => [
                      styles.countryRow,
                      isSelected && styles.countryRowSelected,
                      pressed && styles.countryRowPressed,
                    ]}
                    onPress={() => handleSelectCountry(item)}
                  >
                    <Text style={styles.flagEmoji}>{item.flag}</Text>
                    <Text
                      style={[
                        styles.countryName,
                        isSelected && styles.countryNameSelected,
                      ]}
                      numberOfLines={1}
                    >
                      {item.name}
                    </Text>
                    <Text
                      style={[
                        styles.countryDialCode,
                        isSelected && styles.countryDialCodeSelected,
                      ]}
                    >
                      {item.dialCode}
                    </Text>
                    {isSelected ? (
                      <View style={styles.checkIcon}>
                        <Check size={18} color="#5F4DB2" weight="bold" />
                      </View>
                    ) : (
                      <View style={styles.checkPlaceholder} />
                    )}
                  </Pressable>
                );
              }}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyText}>No country found</Text>
                </View>
              }
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
  },
  label: {
    fontSize: 14,
    fontFamily: 'GeneralSans-Semibold',
    color: '#0B132B',
    marginBottom: 8,
  },
  requiredStar: {
    color: '#5F4DB2',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E7E0D4',
    borderRadius: 16,
    minHeight: 52,
    overflow: 'hidden',
  },
  inputContainerFocused: {
    borderColor: '#5F4DB2',
    backgroundColor: '#FFFFFF',
    ...Platform.select({
      ios: {
        shadowColor: '#5F4DB2',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.12,
        shadowRadius: 4,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  inputContainerError: {
    borderColor: '#B42318',
  },
  inputContainerDisabled: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    opacity: 0.7,
  },
  countryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 8,
    backgroundColor: 'transparent',
  },
  countryButtonPressed: {
    backgroundColor: '#F3F4F6',
  },
  dialCodeText: {
    fontSize: 16,
    fontFamily: 'GeneralSans-Bold',
    color: '#0B132B',
  },
  divider: {
    width: 1,
    height: 28,
    backgroundColor: '#E7E0D4',
  },
  textInput: {
    flex: 1,
    fontSize: 16,
    fontFamily: 'GeneralSans-Medium',
    color: '#0B132B',
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 50,
  },
  hintText: {
    fontSize: 13,
    fontFamily: 'GeneralSans-Regular',
    color: '#64748B',
    marginTop: 6,
    lineHeight: 18,
  },
  errorText: {
    fontSize: 12,
    fontFamily: 'GeneralSans-Medium',
    color: '#B42318',
    marginTop: 6,
    lineHeight: 16,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
  },
  modalBackdrop: {
    flex: 1,
  },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '82%',
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 10,
  },
  dragHandle: {
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#CBD5E1',
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: 'GeneralSans-Bold',
    color: '#0F172A',
  },
  closeButton: {
    padding: 6,
    borderRadius: 20,
    backgroundColor: '#F1F5F9',
  },
  searchBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    gap: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'GeneralSans-Medium',
    color: '#0F172A',
    padding: 0,
  },
  listContent: {
    paddingHorizontal: 12,
    paddingBottom: 16,
  },
  countryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    gap: 12,
  },
  countryRowSelected: {
    backgroundColor: '#F5F3FF',
  },
  countryRowPressed: {
    backgroundColor: '#F1F5F9',
  },
  flagEmoji: {
    fontSize: 22,
  },
  countryName: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'GeneralSans-Medium',
    color: '#334155',
  },
  countryNameSelected: {
    fontFamily: 'GeneralSans-Semibold',
    color: '#5F4DB2',
  },
  countryDialCode: {
    fontSize: 15,
    fontFamily: 'GeneralSans-Medium',
    color: '#64748B',
  },
  countryDialCodeSelected: {
    fontFamily: 'GeneralSans-Bold',
    color: '#5F4DB2',
  },
  checkIcon: {
    width: 22,
    alignItems: 'center',
  },
  checkPlaceholder: {
    width: 22,
  },
  emptyContainer: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    fontFamily: 'GeneralSans-Medium',
    color: '#94A3B8',
  },
});
