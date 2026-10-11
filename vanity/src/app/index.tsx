import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';
import { suggestOutfit, type ClosetItem, type OutfitSuggestion, type SuggestOutfitOptions } from '@/lib/api';

const OCCASIONS = ['Everyday', 'Work', 'Going out', 'Workout'];
const MIN_CLOSET_ITEMS = 3;
const TILE_GAP = 12;
const NARROW_SCREEN = 600;
const ACCENT = '#4f46e5';

function todayLabel() {
  return new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

export default function GetDressedScreen() {
  const theme = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const [occasion, setOccasion] = useState(OCCASIONS[0]);
  const [note, setNote] = useState('');
  const [suggestion, setSuggestion] = useState<OutfitSuggestion | null>(null);
  // 'outfit' while the whole outfit is being picked; an item id while just that piece is swapped.
  const [pending, setPending] = useState<'outfit' | string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [gridWidth, setGridWidth] = useState(0);
  // Only the latest request may update the screen, so quick taps on chips don't flicker old outfits in.
  const requestId = useRef(0);

  const columns = gridWidth >= 520 ? 3 : 2;
  const tileWidth = gridWidth ? Math.floor((gridWidth - TILE_GAP * (columns - 1)) / columns) : 0;

  const load = useCallback(
    async (options: SuggestOutfitOptions, busy: 'outfit' | string, swapped?: ClosetItem) => {
      const id = ++requestId.current;
      setPending(busy);
      setError(null);
      setNotice(null);
      try {
        const result = await suggestOutfit({ occasion, note: note.trim() || undefined, ...options });
        if (id !== requestId.current) return;
        setSuggestion(result);
        // Nothing new beyond the kept pieces means the closet had nothing else to fill that spot.
        // (Not a category check: a yoga tank filed as Activewear can rightly be swapped for a Top.)
        const kept = new Set(options.keepItemIds ?? []);
        if (swapped && result.items.every((item) => kept.has(item.id))) {
          setNotice(`Nothing else in your closet could replace ${swapped.name}.`);
        }
      } catch (err) {
        if (id !== requestId.current) return;
        setError(err instanceof Error ? err.message : "Couldn't put an outfit together");
      } finally {
        if (id === requestId.current) setPending(null);
      }
    },
    [occasion, note]
  );

  // Pick an outfit the first time the tab is shown, and again after an empty closet gets more pieces.
  useFocusEffect(
    useCallback(() => {
      if (pending) return;
      if (!suggestion || suggestion.closet_count < MIN_CLOSET_ITEMS) load({}, 'outfit');
      // Deliberately runs with the state from the last render rather than re-subscribing on every change.
    }, [])
  );

  const outfitIds = suggestion?.items.map((item) => item.id) ?? [];

  const shuffle = () => load({ previousItemIds: outfitIds }, 'outfit');
  const chooseOccasion = (next: string) => {
    if (next === occasion && suggestion) return;
    setOccasion(next);
    // Passed explicitly: `load` still sees the old occasion until the next render.
    load({ occasion: next, previousItemIds: outfitIds }, 'outfit');
  };
  const swap = (item: ClosetItem) =>
    load({ keepItemIds: outfitIds.filter((id) => id !== item.id), swapItemId: item.id }, item.id, item);

  const tooFewItems = suggestion !== null && suggestion.closet_count < MIN_CLOSET_ITEMS;
  const firstLoad = pending === 'outfit' && !suggestion?.items.length;

  return (
    <ThemedView style={[styles.container, windowWidth < NARROW_SCREEN && styles.containerNarrow]}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.column}>
            <ThemedText themeColor="textSecondary" style={styles.date}>
              {todayLabel()}
            </ThemedText>
            <ThemedText style={styles.heading}>Today&apos;s outfit</ThemedText>

            <View style={styles.chips}>
              {OCCASIONS.map((label) => {
                const selected = label === occasion;
                return (
                  <Pressable
                    key={label}
                    onPress={() => chooseOccasion(label)}
                    disabled={tooFewItems}
                    style={[
                      styles.chip,
                      { backgroundColor: selected ? ACCENT : theme.backgroundElement },
                      tooFewItems && styles.disabled,
                    ]}>
                    <ThemedText style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</ThemedText>
                  </Pressable>
                );
              })}
            </View>

            <TextInput
              value={note}
              onChangeText={setNote}
              onSubmitEditing={() => !tooFewItems && load({ previousItemIds: outfitIds }, 'outfit')}
              placeholder="Anything to plan around? Rain, lots of walking…"
              placeholderTextColor={theme.textSecondary}
              returnKeyType="go"
              maxLength={200}
              editable={!tooFewItems}
              style={[styles.noteInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
            />

            {tooFewItems ? (
              <ThemedView type="backgroundElement" style={styles.card}>
                <ThemedText style={styles.emptyTitle}>Add a few more pieces to get outfit ideas</ThemedText>
                <ThemedText themeColor="textSecondary" style={styles.emptyBody}>
                  Upload at least a top, a bottom and some shoes, and we&apos;ll start putting outfits together.
                </ThemedText>
                <Pressable style={styles.primaryButton} onPress={() => router.push('/upload')}>
                  <ThemedText style={styles.primaryButtonText}>Add pieces</ThemedText>
                </Pressable>
              </ThemedView>
            ) : firstLoad ? (
              <ThemedView type="backgroundElement" style={[styles.card, styles.loadingCard]}>
                <ActivityIndicator size="large" />
                <ThemedText themeColor="textSecondary">Picking your outfit…</ThemedText>
              </ThemedView>
            ) : error && !suggestion?.items.length ? (
              <ThemedView type="backgroundElement" style={styles.card}>
                <ThemedText style={styles.errorText}>{error}</ThemedText>
                <Pressable style={styles.primaryButton} onPress={() => load({}, 'outfit')}>
                  <ThemedText style={styles.primaryButtonText}>Try again</ThemedText>
                </Pressable>
              </ThemedView>
            ) : suggestion?.items.length ? (
              <ThemedView type="backgroundElement" style={styles.card}>
                <View
                  style={[styles.grid, pending === 'outfit' && styles.dimmed]}
                  onLayout={(event) => setGridWidth(event.nativeEvent.layout.width)}>
                  {tileWidth > 0 &&
                    suggestion.items.map((item) => (
                      <OutfitTile
                        key={item.id}
                        item={item}
                        width={tileWidth}
                        swapping={pending === item.id}
                        disabled={pending !== null}
                        onSwap={() => swap(item)}
                      />
                    ))}
                </View>
                {pending === 'outfit' ? <ActivityIndicator style={styles.overlaySpinner} size="large" /> : null}
                {notice ? (
                  <ThemedText themeColor="textSecondary" style={styles.notice}>
                    {notice}
                  </ThemedText>
                ) : null}
                {error ? <ThemedText style={styles.errorText}>{error}</ThemedText> : null}

                <Pressable
                  style={[styles.primaryButton, pending !== null && styles.disabled]}
                  disabled={pending !== null}
                  onPress={shuffle}>
                  <ThemedText style={styles.primaryButtonText}>Shuffle</ThemedText>
                </Pressable>
              </ThemedView>
            ) : null}
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

type OutfitTileProps = {
  item: ClosetItem;
  width: number;
  swapping: boolean;
  disabled: boolean;
  onSwap: () => void;
};

function OutfitTile({ item, width, swapping, disabled, onSwap }: OutfitTileProps) {
  const theme = useTheme();
  const label = item.subcategory ?? item.category;

  return (
    <View style={{ width }}>
      <View style={[styles.tileImageWrap, { backgroundColor: theme.backgroundSelected }]}>
        {item.image_url ? (
          <Image source={{ uri: item.image_url }} style={[styles.tileImage, swapping && styles.dimmed]} resizeMode="cover" />
        ) : (
          <View style={styles.tilePlaceholder}>
            <ThemedText themeColor="textSecondary" style={styles.placeholderText}>
              No image
            </ThemedText>
          </View>
        )}
        {swapping ? <ActivityIndicator style={styles.overlaySpinner} /> : null}
        <Pressable
          accessibilityLabel={`Swap ${item.name}`}
          onPress={onSwap}
          disabled={disabled}
          style={({ pressed }) => [styles.swapButton, (pressed || disabled) && styles.swapButtonMuted]}>
          <ThemedText style={styles.swapButtonText}>Swap</ThemedText>
        </Pressable>
      </View>
      <ThemedText numberOfLines={1} style={styles.tileName}>
        {item.name}
      </ThemedText>
      {label ? (
        <ThemedText numberOfLines={1} themeColor="textSecondary" style={styles.tileLabel}>
          {label}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    marginTop: 120,
    marginHorizontal: 50,
  },
  containerNarrow: {
    marginHorizontal: 16,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    alignItems: 'center',
    paddingBottom: 32,
  },
  column: {
    width: '100%',
    maxWidth: 640,
    gap: 16,
  },
  date: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: -12,
  },
  heading: {
    fontSize: 32,
    lineHeight: 40,
    fontWeight: '700',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
  },
  chipText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  chipTextSelected: {
    color: 'white',
  },
  noteInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  card: {
    borderRadius: 20,
    padding: 16,
    gap: 14,
  },
  loadingCard: {
    alignItems: 'center',
    paddingVertical: 48,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: TILE_GAP,
  },
  dimmed: {
    opacity: 0.4,
  },
  overlaySpinner: {
    ...StyleSheet.absoluteFill,
  },
  tileImageWrap: {
    aspectRatio: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  tileImage: {
    width: '100%',
    height: '100%',
  },
  tilePlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    fontSize: 12,
  },
  swapButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    boxShadow: '0 1px 4px rgba(0, 0, 0, 0.18)',
  },
  swapButtonMuted: {
    opacity: 0.6,
  },
  swapButtonText: {
    color: '#111827',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  tileName: {
    marginTop: 6,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '600',
  },
  tileLabel: {
    fontSize: 12,
    lineHeight: 16,
  },
  notice: {
    fontSize: 13,
    lineHeight: 18,
  },
  emptyTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
  },
  emptyBody: {
    fontSize: 14,
    lineHeight: 20,
  },
  errorText: {
    color: '#dc2626',
  },
  primaryButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: ACCENT,
  },
  primaryButtonText: {
    color: 'white',
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.5,
  },
});
