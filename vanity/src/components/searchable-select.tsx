import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { brandKey } from '@/lib/brands';

type SearchableSelectProps = {
  label: string;
  value: string | null;
  options: string[];
  onChange: (value: string | null) => void;
  placeholder?: string;
  /** Let the user keep what they typed when it isn't one of the options. */
  allowCustom?: boolean;
  disabled?: boolean;
  /** Show a spinner while a value is being filled in. The field stays usable meanwhile. */
  loading?: boolean;
};

export function SearchableSelect({
  label,
  value,
  options,
  onChange,
  placeholder = 'Select',
  allowCustom = false,
  disabled = false,
  loading = false,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const trimmed = query.trim();
  const filtered = useMemo(() => {
    // Match loosely so punctuation, spacing and accents don't matter ("levis" finds "Levi's").
    const q = brandKey(trimmed);
    if (!trimmed) return options;
    return options.filter((option) =>
      q ? brandKey(option).includes(q) : option.toLowerCase().includes(trimmed.toLowerCase()),
    );
  }, [options, trimmed]);
  // Offer the typed text only when it isn't just another spelling of an existing option.
  const showCustom =
    allowCustom && trimmed.length > 0 && !options.some((option) => brandKey(option) === brandKey(trimmed));

  const choose = (next: string | null) => {
    onChange(next);
    setOpen(false);
    setQuery('');
  };

  return (
    <View style={styles.field}>
      <ThemedText style={styles.label}>{label}</ThemedText>
      <Pressable
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value ?? placeholder}`}
        style={[styles.trigger, open && styles.triggerOpen, disabled && styles.disabled]}
        onPress={() => setOpen((o) => !o)}>
        <ThemedText style={[styles.triggerText, !value && styles.placeholder]} numberOfLines={1}>
          {value ?? (loading ? 'Filling in…' : placeholder)}
        </ThemedText>
        {loading ? (
          <ActivityIndicator size="small" color="#6b7280" style={styles.chevron} />
        ) : (
          <ThemedText style={styles.chevron}>{open ? '▴' : '▾'}</ThemedText>
        )}
      </Pressable>

      {open ? (
        <View style={styles.dropdown}>
          <TextInput
            autoFocus
            value={query}
            onChangeText={setQuery}
            placeholder={`Search ${label.toLowerCase()}`}
            placeholderTextColor="#9ca3af"
            style={styles.search}
            onSubmitEditing={() => {
              if (filtered.length === 1) choose(filtered[0]);
              else if (showCustom) choose(trimmed);
            }}
          />
          <ScrollView style={styles.options} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
            {value ? (
              <Pressable style={styles.option} onPress={() => choose(null)}>
                <ThemedText style={styles.clearText}>Clear</ThemedText>
              </Pressable>
            ) : null}
            {showCustom ? (
              <Pressable style={styles.option} onPress={() => choose(trimmed)}>
                <ThemedText style={styles.optionText}>Use “{trimmed}”</ThemedText>
              </Pressable>
            ) : null}
            {filtered.map((option) => (
              <Pressable
                key={option}
                style={[styles.option, option === value && styles.optionSelected]}
                onPress={() => choose(option)}>
                <ThemedText style={styles.optionText}>{option}</ThemedText>
              </Pressable>
            ))}
            {filtered.length === 0 && !showCustom ? (
              <ThemedText style={styles.empty}>No matches</ThemedText>
            ) : null}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    width: '100%',
    gap: 4,
  },
  label: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: '#374151',
  },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'white',
  },
  triggerOpen: {
    borderColor: '#4f46e5',
  },
  disabled: {
    opacity: 0.5,
  },
  triggerText: {
    flexShrink: 1,
    color: '#111827',
  },
  placeholder: {
    color: '#9ca3af',
  },
  chevron: {
    color: '#6b7280',
    marginLeft: 8,
  },
  dropdown: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    backgroundColor: 'white',
    overflow: 'hidden',
  },
  search: {
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#111827',
  },
  options: {
    maxHeight: 200,
  },
  option: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  optionSelected: {
    backgroundColor: '#eef2ff',
  },
  optionText: {
    color: '#111827',
  },
  clearText: {
    color: '#6b7280',
  },
  empty: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#9ca3af',
  },
});
