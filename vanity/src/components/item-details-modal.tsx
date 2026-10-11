import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { SearchableSelect } from '@/components/searchable-select';
import { ThemedText } from '@/components/themed-text';
import { fetchUserBrands } from '@/lib/api';
import { likelyBrandTypo, mergeBrands } from '@/lib/brands';
import { useTaxonomy, type ItemDetails } from '@/lib/taxonomy';

type ItemDetailsModalProps = {
  visible: boolean;
  imageUri?: string | null;
  initialName: string;
  initialDetails?: ItemDetails;
  /** False shows the name as read-only text (e.g. when editing an existing closet item). */
  nameEditable?: boolean;
  /** Disable Confirm until something differs from the initial values (editing existing items). */
  requireChanges?: boolean;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (name: string, details: ItemDetails) => void;
};

export function ItemDetailsModal({
  visible,
  imageUri,
  initialName,
  initialDetails,
  nameEditable = true,
  requireChanges = false,
  busy = false,
  error,
  onCancel,
  onConfirm,
}: ItemDetailsModalProps) {
  const { taxonomy, error: taxonomyError } = useTaxonomy();
  const [name, setName] = useState(initialName);
  const [brand, setBrand] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [subcategory, setSubcategory] = useState<string | null>(null);
  const [size, setSize] = useState<string | null>(null);
  const [userBrands, setUserBrands] = useState<string[]>([]);

  // Refresh each time it opens so brands added since then show up. Failures just mean no extras.
  useEffect(() => {
    if (!visible) return;
    let active = true;
    fetchUserBrands()
      .then((brands) => active && setUserBrands(brands))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [visible]);

  // The user's own brands first, so their spelling wins over a suggested one.
  const brandOptions = useMemo(() => mergeBrands(userBrands, taxonomy?.brands ?? []), [userBrands, taxonomy]);
  const brandSuggestion = brand ? likelyBrandTypo(brand, brandOptions) : null;

  // Start from the provided values each time the modal opens.
  useEffect(() => {
    if (!visible) return;
    setName(initialName);
    setBrand(initialDetails?.brand ?? null);
    setCategory(initialDetails?.category ?? null);
    setSubcategory(initialDetails?.subcategory ?? null);
    setSize(initialDetails?.size ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const categoryInfo = taxonomy?.categories.find((c) => c.name === category) ?? null;
  // A category whose only size is "One Size" (e.g. bags) has nothing to choose, so hide the field.
  // Until the taxonomy loads, assume there is a choice so nothing gets dropped.
  const hasSizeChoice = categoryInfo ? categoryInfo.sizes.length > 1 : true;

  const changeCategory = (next: string | null) => {
    setCategory(next);
    const info = taxonomy?.categories.find((c) => c.name === next);
    // Subcategory and size options depend on the category; drop values that no longer apply.
    if (!info || (subcategory && !info.subcategories.includes(subcategory))) setSubcategory(null);
    if (!info || (size && !info.sizes.includes(size))) setSize(null);
  };

  const finalDetails: ItemDetails = { brand, category, subcategory, size: hasSizeChoice ? size : null };
  const dirty =
    name.trim() !== initialName.trim() ||
    (['brand', 'category', 'subcategory', 'size'] as const).some((key) => {
      // A stored "One Size" that the form hides isn't a change the user made.
      const initial = key === 'size' && !hasSizeChoice ? null : (initialDetails?.[key] ?? null);
      return (finalDetails[key] ?? null) !== initial;
    });
  const canConfirm = name.trim().length > 0 && !busy && (!requireChanges || dirty);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <ThemedText style={styles.title}>Item details</ThemedText>
            {nameEditable ? (
              <ThemedText style={styles.subtitle}>Everything except the name is optional.</ThemedText>
            ) : null}

            {imageUri ? <Image source={{ uri: imageUri }} style={styles.preview} resizeMode="contain" /> : null}

            <View style={styles.field}>
              <ThemedText style={styles.label}>Name</ThemedText>
              {nameEditable ? (
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Name this item"
                  placeholderTextColor="#9ca3af"
                  style={styles.input}
                />
              ) : (
                <ThemedText style={styles.readOnlyName}>{name}</ThemedText>
              )}
            </View>

            {!taxonomy ? (
              taxonomyError ? (
                <ThemedText style={styles.errorText}>{taxonomyError}</ThemedText>
              ) : (
                <ActivityIndicator />
              )
            ) : (
              <>
                <View style={styles.field}>
                  <SearchableSelect
                    label="Brand"
                    value={brand}
                    options={brandOptions}
                    onChange={setBrand}
                    placeholder="Select or type a brand"
                    allowCustom
                  />
                  {brandSuggestion ? (
                    <Pressable onPress={() => setBrand(brandSuggestion)}>
                      <ThemedText style={styles.suggestion}>
                        Did you mean <ThemedText style={styles.suggestionBrand}>{brandSuggestion}</ThemedText>?
                      </ThemedText>
                    </Pressable>
                  ) : null}
                </View>
                <SearchableSelect
                  label="Category"
                  value={category}
                  options={taxonomy.categories.map((c) => c.name)}
                  onChange={changeCategory}
                />
                {categoryInfo ? (
                  <>
                    <SearchableSelect
                      label="Subcategory"
                      value={subcategory}
                      options={categoryInfo.subcategories}
                      onChange={setSubcategory}
                    />
                    {hasSizeChoice ? (
                      <SearchableSelect label="Size" value={size} options={categoryInfo.sizes} onChange={setSize} />
                    ) : null}
                  </>
                ) : null}
              </>
            )}

            {error ? <ThemedText style={styles.errorText}>{error}</ThemedText> : null}

            <View style={styles.actions}>
              <Pressable disabled={busy} style={[styles.secondaryButton, busy && styles.buttonDisabled]} onPress={onCancel}>
                <ThemedText style={styles.secondaryButtonText}>Cancel</ThemedText>
              </Pressable>
              <Pressable
                disabled={!canConfirm}
                style={[styles.primaryButton, !canConfirm && styles.buttonDisabled]}
                onPress={() => onConfirm(name.trim(), finalDetails)}>
                <ThemedText style={styles.primaryButtonText}>{busy ? 'Saving...' : 'Confirm'}</ThemedText>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(17, 24, 39, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  sheet: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '90%',
    borderRadius: 20,
    backgroundColor: 'white',
    overflow: 'hidden',
  },
  body: {
    padding: 20,
    gap: 14,
  },
  title: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600',
    color: '#111827',
  },
  subtitle: {
    marginTop: -10,
    fontSize: 12,
    lineHeight: 16,
    color: '#9ca3af',
  },
  preview: {
    width: '100%',
    height: 160,
    borderRadius: 12,
    backgroundColor: '#f9fafb',
  },
  field: {
    gap: 4,
  },
  label: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: '#374151',
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#111827',
  },
  suggestion: {
    fontSize: 13,
    lineHeight: 18,
    color: '#6b7280',
  },
  suggestionBrand: {
    fontSize: 13,
    lineHeight: 18,
    color: '#4f46e5',
    fontWeight: '600',
  },
  readOnlyName: {
    color: '#111827',
  },
  errorText: {
    color: '#dc2626',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 4,
  },
  secondaryButton: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: 'white',
  },
  secondaryButtonText: {
    color: '#374151',
    fontWeight: '600',
  },
  primaryButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#4f46e5',
  },
  primaryButtonText: {
    color: 'white',
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
