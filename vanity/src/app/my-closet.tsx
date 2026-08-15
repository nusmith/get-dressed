import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { fetchUserClosetItems, type ClosetItem } from '@/lib/api';

export default function MyClosetScreen() {
  const [items, setItems] = useState<ClosetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let isActive = true;

    const loadCloset = async () => {
      try {
        setLoading(true);
        setHasLoaded(false);
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
  }, []);

  return (
    <ThemedView style={styles.container}> 
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
              <FlatList
                data={items}
                style={{ width: '100%' }}
                keyExtractor={(item) => item.id}
                numColumns={4}
                contentContainerStyle={styles.listContent}
                columnWrapperStyle={styles.columnWrapper}
                showsVerticalScrollIndicator={false}
                renderItem={({ item }) => (
                  <View style={styles.card}>
                    {item.image_url ? (
                      <Image source={{ uri: item.image_url }} style={styles.image} resizeMode="cover" />
                    ) : (
                      <ThemedView style={styles.imagePlaceholder}>
                        <ThemedText style={styles.placeholderText}>No image</ThemedText>
                      </ThemedView>
                    )}
                  </View>
                )}
              />
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    marginTop: 120,
    marginHorizontal: 50,
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
    paddingTop: 8,
    paddingBottom: 8,
  },
  columnWrapper: {
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  card: {
    width: '23%',
    aspectRatio: 1,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#f3f4f6',
  },
  image: {
    width: '100%',
    height: '100%',
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
