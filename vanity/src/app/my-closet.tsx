import { useCallback, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { fetchUserClosetItems, type ClosetItem } from '@/lib/api';

const MIN_COLUMNS = 2;
const MAX_COLUMNS = 6;
const MIN_CARD_WIDTH = 160;
const GRID_GAP = 8;
const NARROW_SCREEN = 600;

// 2 to 6 per row, each card stretched to share the row; fewer columns on narrower screens.
function cardWidthFor(gridWidth: number) {
  const fit = Math.floor((gridWidth + GRID_GAP) / (MIN_CARD_WIDTH + GRID_GAP));
  const columns = Math.max(MIN_COLUMNS, Math.min(MAX_COLUMNS, fit));
  return Math.floor((gridWidth - GRID_GAP * (columns - 1)) / columns);
}

export default function MyClosetScreen() {
  const [items, setItems] = useState<ClosetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gridWidth, setGridWidth] = useState(0);
  const { width: windowWidth } = useWindowDimensions();
  // Touch screens have no hover, so tapping a card reveals its name (one card at a time).
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const cardWidth = gridWidth ? cardWidthFor(gridWidth) : MIN_CARD_WIDTH;
  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      const loadCloset = async () => {
        try {
          setLoading(true);
          setError(null);
          const closetItems = await fetchUserClosetItems();
          if (isActive) {
            setItems(closetItems);
          }
        } catch (err) {
          if (isActive) {
            setError(err instanceof Error ? err.message : 'Could not load your closet');
          }
        } finally {
          if (isActive) {
            setHasLoaded(true);
            setLoading(false);
          }
        }
      };

      loadCloset();

      return () => {
        isActive = false;
      };
    }, [])
  );

  return (
    <ThemedView style={[styles.container, windowWidth < NARROW_SCREEN && styles.containerNarrow]}> 
      <SafeAreaView style={styles.safeArea}>
        <ThemedView style={styles.content}>
          {!hasLoaded && loading ? (
            <ActivityIndicator size="large" style={styles.spinner} />
          ) : error ? (
            <ThemedText style={styles.errorText}>{error}</ThemedText>
          ) : items.length === 0 ? (
            <ThemedText style={styles.emptyText}>
              Nothing in your closet yet.{' '}
              <ThemedText style={styles.emptyLinkText} onPress={() => router.push('/upload')}>
                Upload images here!
              </ThemedText>
            </ThemedText>
          ) : (
            <>
              <ScrollView
                style={{ width: '100%' }}
                contentContainerStyle={styles.listContent}
                onLayout={(event) => setGridWidth(event.nativeEvent.layout.width)}
                showsVerticalScrollIndicator={false}>
                {items.map((item) => (
                  <ClosetCard
                    key={item.id}
                    item={item}
                    width={cardWidth}
                    revealed={revealedId === item.id}
                    onToggleReveal={() => setRevealedId((id) => (id === item.id ? null : item.id))}
                    onHoverOut={() => setRevealedId((id) => (id === item.id ? null : id))}
                  />
                ))}
              </ScrollView>
              <Pressable style={styles.footerLink} onPress={() => router.push('/upload')}>
                <ThemedText style={styles.footerLinkText}>Add More</ThemedText>
              </Pressable>
          </>
          )}

          
        </ThemedView>
      </SafeAreaView>
    </ThemedView>
  );
}

type ClosetCardProps = {
  item: ClosetItem;
  width: number;
  revealed: boolean;
  onToggleReveal: () => void;
  onHoverOut: () => void;
};

function ClosetCard({ item, width, revealed, onToggleReveal, onHoverOut }: ClosetCardProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <Pressable
      style={[styles.card, { width }]}
      onPress={onToggleReveal}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => {
        setHovered(false);
        // A click on desktop shouldn't leave the name pinned after the mouse leaves.
        onHoverOut();
      }}>
      {item.image_url ? (
        <Image source={{ uri: item.image_url }} style={styles.image} resizeMode="cover" />
      ) : (
        <ThemedView style={styles.imagePlaceholder}>
          <ThemedText style={styles.placeholderText}>No image</ThemedText>
        </ThemedView>
      )}
      {hovered || revealed ? (
        <View style={styles.hoverOverlay} pointerEvents="none">
          <ThemedText style={styles.hoverTitle} numberOfLines={2}>
            {item.name}
          </ThemedText>
        </View>
      ) : null}
    </Pressable>
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
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'flex-start',
    height: '100%',
    flexGrow: 1,
    minHeight: 200,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 16,
  },
  spinner: {
    marginTop: 24,
  },
  errorText: {
    marginTop: 24,
    color: '#dc2626',
    textAlign: 'center',
  },
  emptyText: {
    marginTop: 24,
    opacity: 1,
    textAlign: 'center',
  },
  emptyLinkText: {
    color: '#4f46e5',
    fontWeight: '600',
  },
  listContent: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    gap: GRID_GAP,
    paddingTop: 8,
    paddingBottom: 8,
  },
  card: {
    aspectRatio: 1,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#f3f4f6',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  hoverOverlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'flex-end',
    padding: 10,
    // Soft gray shading around every edge, deeper along the bottom so the title is readable.
    boxShadow: 'inset 0 0 28px rgba(0, 0, 0, 0.25), inset 0 -56px 40px -24px rgba(0, 0, 0, 0.6)',
  },
  hoverTitle: {
    color: 'white',
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '600',
  },
  imagePlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#e5e7eb',
  },
  placeholderText: {
    fontSize: 10,
    opacity: 0.7,
  },
  footerLink: {
    marginTop: 'auto',
    paddingTop: 12,
    alignItems: 'center',
  },
  footerLinkText: {
    color: '#4f46e5',
    fontWeight: '600',
  },
});
