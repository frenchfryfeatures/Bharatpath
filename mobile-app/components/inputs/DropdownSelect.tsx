import React, { useMemo, useState } from 'react';
import { AppModal as Modal } from '@/components/layout/AppModal';
import {
  View,
  Text,
  Pressable,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
  TextInput,
} from 'react-native';
import { CaretDown, Check, X } from 'phosphor-react-native';

export interface SelectOption {
  value: string;
  label: string;
}

export function DropdownSelect({
  value,
  options,
  placeholder = 'Select',
  modalTitle = 'Select an option',
  onChange,
  invalid = false,
  disabled = false,
  onOpen,
  searchable = false,
  selectedLabel: savedLabel,
}: {
  value: string;
  options: SelectOption[];
  placeholder?: string;
  modalTitle?: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  onOpen?: () => void;
  searchable?: boolean;
  selectedLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selectedLabel = useMemo(() => {
    const found = options.find((opt) => String(opt.value) === String(value));
    return found ? found.label : '';
  }, [options, value]);

  const handleOpen = () => {
    if (disabled) return;
    Keyboard.dismiss();
    onOpen?.();
    setQuery('');
    setOpen(true);
  };

  return (
    <>
      <Pressable
        disabled={disabled}
        onPress={handleOpen}
        accessibilityRole="button"
        accessibilityLabel={modalTitle}
        style={({ pressed }) => [
          styles.trigger,
          invalid && styles.triggerInvalid,
          disabled && styles.triggerDisabled,
          pressed && styles.triggerPressed,
        ]}
      >
        <Text
          style={[
            styles.triggerText,
            !selectedLabel && !savedLabel && styles.triggerPlaceholder,
          ]}
          numberOfLines={1}
        >
          {selectedLabel || savedLabel || placeholder}
        </Text>
        <CaretDown size={16} color="#5F6B80" weight="bold" />
      </Pressable>

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
              <Text style={styles.sheetTitle}>{modalTitle}</Text>
              <Pressable
                onPress={() => setOpen(false)}
                hitSlop={12}
                style={styles.closeBtn}
              >
                <X size={20} color="#0A1931" weight="bold" />
              </Pressable>
            </View>

            {searchable && <TextInput accessibilityLabel={`Search ${modalTitle}`} placeholder="Type to search" value={query} onChangeText={setQuery}
              autoCorrect={false} style={[styles.trigger, {margin: 14}]} />}
            <FlatList
              data={searchable ? options.filter((o) => o.value === '__other__' || o.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) : options}
              keyExtractor={(item) => item.value}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => {
                const isSelected = String(item.value) === String(value);
                return (
                  <Pressable
                    onPress={() => {
                      onChange(item.value);
                      setOpen(false);
                    }}
                    style={({ pressed }) => [
                      styles.optionRow,
                      isSelected && styles.optionRowSelected,
                      pressed && styles.optionRowPressed,
                    ]}
                  >
                    <Text
                      style={[
                        styles.optionLabel,
                        isSelected && styles.optionLabelSelected,
                      ]}
                    >
                      {item.label}
                    </Text>
                    {isSelected && (
                      <Check size={18} color="#5F4DB2" weight="bold" />
                    )}
                  </Pressable>
                );
              }}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
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
    fontFamily: 'GeneralSans-Semibold',
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
