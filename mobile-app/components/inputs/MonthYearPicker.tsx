import { DropdownSelect, type SelectOption } from './DropdownSelect';
export { DropdownSelect } from './DropdownSelect';
import { monthYearOptions } from '@/utils/monthYearOptions';
import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
} from 'react-native';
import { CalendarBlank, CaretDown, Check, X } from 'phosphor-react-native';


const MONTH_NAMES = [
  { value: '01', label: 'January' },
  { value: '02', label: 'February' },
  { value: '03', label: 'March' },
  { value: '04', label: 'April' },
  { value: '05', label: 'May' },
  { value: '06', label: 'June' },
  { value: '07', label: 'July' },
  { value: '08', label: 'August' },
  { value: '09', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
];

export function YearDropdownPicker({
  value,
  onChange,
  placeholder = 'Select year',
  modalTitle = 'Select year',
  pastYears = 100,
  maxYear,
  minYear,
  invalid = false,
  disabled = false,
  onOpen,
}: {
  value: number | string | null | undefined;
  onChange: (year: number | null) => void;
  placeholder?: string;
  modalTitle?: string;
  pastYears?: number;
  maxYear?: number;
  minYear?: number;
  invalid?: boolean;
  disabled?: boolean;
  onOpen?: () => void;
}) {
  const currentYear = new Date().getFullYear();
  const topYear = maxYear ?? currentYear;
  const bottomYear = minYear ?? currentYear - pastYears;

  const yearOptions = useMemo<SelectOption[]>(() => {
    const list: SelectOption[] = [];
    for (let y = topYear; y >= bottomYear; y--) {
      list.push({ value: String(y), label: String(y) });
    }
    return list;
  }, [topYear, bottomYear]);

  return (
    <DropdownSelect
      value={value != null && value !== '' ? String(value) : ''}
      options={yearOptions}
      placeholder={placeholder}
      modalTitle={modalTitle}
      invalid={invalid}
      disabled={disabled}
      onOpen={onOpen}
      onChange={(nextVal) => {
        const parsed = Number(nextVal);
        onChange(Number.isFinite(parsed) ? parsed : null);
      }}
    />
  );
}

function parseYearMonthParts(raw: string): { year: string; month: string } {
  const match = /^((?:19|20)\d{2})-(0[1-9]|1[0-2])$/.exec((raw || '').trim());
  if (!match) return { year: '', month: '' };
  return { year: match[1], month: match[2] };
}

export function MonthYearPicker({
  value, onChange, invalid = false, disabled = false, onOpen,
  dateKind = 'starting', after = '',
}: {
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  onOpen?: () => void;
  dateKind?: 'starting' | 'ending';
  after?: string;
}) {
  const [selection, setSelection] = useState(() => ({baseValue: value, baseAfter: after, ...parseYearMonthParts(value)}));
  const {year: selectedYear, month: selectedMonth} = selection.baseValue === value && selection.baseAfter === after ? selection : parseYearMonthParts(value);
  const choices = monthYearOptions(selectedYear, after, new Date(), new Date().getFullYear() - 100);
  const yearOptions = choices.years.map((year) => ({value: year, label: year}));
  const monthOptions = MONTH_NAMES.filter((month) => choices.months.includes(month.value));
  const commit = (month: string, year: string) => {
    const valid = monthYearOptions(year, after, new Date(), new Date().getFullYear() - 100).months.includes(month);
    const nextMonth = valid ? month : '';
    const nextValue = nextMonth && year ? `${year}-${nextMonth}` : '';
    setSelection({baseValue: nextValue, baseAfter: after, month: nextMonth, year});
    if (nextValue !== value) onChange(nextValue);
  };
  const handleMonthChange = (month: string) => commit(month, selectedYear);
  const handleYearChange = (year: string) => commit(selectedMonth, year);

  return (
    <View style={styles.monthYearWrap}>
      <View style={styles.monthYearRow}>
        <View style={styles.halfCol}>
          <DropdownSelect
            value={selectedMonth}
            options={monthOptions}
            placeholder="Month"
            modalTitle={`Select ${dateKind} month`}
            invalid={invalid}
            disabled={disabled || !choices.years.length}
            onOpen={onOpen}
            onChange={handleMonthChange}
          />
        </View>
        <View style={styles.halfCol}>
          <DropdownSelect
            value={selectedYear}
            options={yearOptions}
            placeholder="Year"
            modalTitle={`Select ${dateKind} year`}
            invalid={invalid}
            disabled={disabled || !choices.years.length}
            onOpen={onOpen}
            onChange={handleYearChange}
          />
        </View>
      </View>

      {(value || selectedMonth || selectedYear) ? (
        <View style={styles.footerRow}>
          <View style={styles.selectedPreviewBadge}>
            <CalendarBlank size={14} color="#5F4DB2" weight="bold" />
            <Text style={styles.selectedPreviewText}>
              {MONTH_NAMES.find((m) => m.value === selectedMonth)?.label || ''}{' '}
              {selectedYear}
            </Text>
          </View>
          <Pressable
            onPress={() => {
              commit('', '');
            }}
            hitSlop={8}
          >
            <Text style={styles.clearText}>Clear date</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#DDD6C7',
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  triggerInvalid: {
    borderColor: '#A33A2B',
  },
  triggerDisabled: {
    opacity: 0.6,
    backgroundColor: '#F7F4EC',
  },
  triggerPressed: {
    backgroundColor: '#FAF7F0',
  },
  triggerText: {
    flex: 1,
    fontFamily: 'GeneralSans-Medium',
    fontSize: 16,
    color: '#0A1931',
  },
  triggerPlaceholder: {
    color: '#9AA1AE',
    fontFamily: 'GeneralSans-Regular',
  },
  monthYearWrap: {
    gap: 8,
  },
  monthYearRow: {
    flexDirection: 'row',
    gap: 10,
  },
  halfCol: {
    flex: 1,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  selectedPreviewBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  selectedPreviewText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 12,
    color: '#5F4DB2',
  },
  clearText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 12,
    color: '#5F6B80',
    textDecorationLine: 'underline',
  },
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(10, 25, 49, 0.45)',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '72%',
    paddingBottom: Platform.OS === 'ios' ? 28 : 18,
    shadowColor: '#0A1931',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.14,
    shadowRadius: 20,
    elevation: 10,
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
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E7E0D4',
  },
  sheetTitle: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 17,
    color: '#0A1931',
  },
  closeBtn: {
    padding: 4,
  },
  listContent: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRadius: 12,
  },
  optionRowSelected: {
    backgroundColor: '#F1EAF7',
  },
  optionRowPressed: {
    backgroundColor: '#FAF7F0',
  },
  optionLabel: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 15,
    color: '#0A1931',
  },
  optionLabelSelected: {
    fontFamily: 'GeneralSans-Semibold',
    color: '#5F4DB2',
  },
});

