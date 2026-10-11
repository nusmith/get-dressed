import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';
import { fetchClosetAnalysis, type ClosetAnalysis, type NamedCount } from '@/lib/api';

const NARROW_SCREEN = 600;
const ACCENT = '#4f46e5';
// More colors than this fold into "Other" so the palette bar stays readable.
const MAX_COLORS = 8;
const MIN_DESCRIBED = 3;

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export default function MyStyleScreen() {
  const theme = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const [analysis, setAnalysis] = useState<ClosetAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reload on every visit: new uploads and freshly described photos change the picture.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      fetchClosetAnalysis()
        .then((result) => {
          if (!active) return;
          setAnalysis(result);
          setError(null);
        })
        .catch((err) => active && setError(err instanceof Error ? err.message : 'Could not load your style'));
      return () => {
        active = false;
      };
    }, [])
  );

  const pending = analysis ? analysis.item_count - analysis.described_count : 0;

  return (
    <ThemedView style={[styles.container, windowWidth < NARROW_SCREEN && styles.containerNarrow]}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.column}>
            <ThemedText style={styles.heading}>My Style</ThemedText>
            {analysis && analysis.item_count > 0 ? (
              <ThemedText themeColor="textSecondary" style={styles.subheading}>
                Based on {analysis.item_count} pieces
                {pending > 0 ? ` · ${pending} still being looked at` : ''}
              </ThemedText>
            ) : null}

            {!analysis && !error ? (
              <ActivityIndicator size="large" style={styles.spinner} />
            ) : error && !analysis ? (
              <ThemedText style={styles.errorText}>{error}</ThemedText>
            ) : analysis && analysis.described_count < MIN_DESCRIBED ? (
              <ThemedView type="backgroundElement" style={styles.card}>
                <ThemedText style={styles.cardTitle}>
                  {analysis.item_count >= MIN_DESCRIBED ? 'Looking at your photos…' : 'Add a few pieces to see your style'}
                </ThemedText>
                <ThemedText themeColor="textSecondary" style={styles.body}>
                  {analysis.item_count >= MIN_DESCRIBED
                    ? 'Your colors will show up here in a minute or two.'
                    : 'Once your closet has a few pieces, this is where you’ll see your colors and brands.'}
                </ThemedText>
                {analysis.item_count < MIN_DESCRIBED ? (
                  <Pressable style={styles.primaryButton} onPress={() => router.push('/upload')}>
                    <ThemedText style={styles.primaryButtonText}>Add pieces</ThemedText>
                  </Pressable>
                ) : null}
              </ThemedView>
            ) : analysis ? (
              <>
                <Section title="Your colors">
                  <Palette colors={analysis.colors} outline={theme.backgroundSelected} />
                </Section>

                {analysis.brands.length ? (
                  <Section title="Top brands">
                    <Bars data={analysis.brands} />
                  </Section>
                ) : null}

              </>
            ) : null}
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText style={styles.cardTitle}>{title}</ThemedText>
      {children}
    </ThemedView>
  );
}

/** Share of the closet by main color: one proportional strip, then a labeled key. */
function Palette({ colors, outline }: { colors: ClosetAnalysis['colors']; outline: string }) {
  const shown = colors.slice(0, MAX_COLORS);
  const otherCount = colors.slice(MAX_COLORS).reduce((sum, c) => sum + c.count, 0);
  const segments = otherCount ? [...shown, { name: 'other', hex: '#B8B8BE', count: otherCount }] : shown;
  const total = segments.reduce((sum, c) => sum + c.count, 0);

  return (
    <View style={styles.paletteWrap}>
      <View
        style={styles.paletteStrip}
        accessibilityLabel={segments.map((c) => `${c.name} ${Math.round((c.count / total) * 100)}%`).join(', ')}>
        {segments.map((c) => (
          <View
            key={c.name}
            style={[styles.paletteSegment, { flexGrow: c.count, backgroundColor: c.hex, borderColor: outline }]}
          />
        ))}
      </View>
      <View style={styles.paletteKey}>
        {segments.map((c) => (
          <View key={c.name} style={styles.keyItem}>
            <View style={[styles.swatch, { backgroundColor: c.hex, borderColor: outline }]} />
            <ThemedText style={styles.keyName}>{capitalize(c.name)}</ThemedText>
            <ThemedText themeColor="textSecondary" style={styles.keyCount}>
              {Math.round((c.count / total) * 100)}%
            </ThemedText>
          </View>
        ))}
      </View>
    </View>
  );
}

/** One horizontal bar per entry, all on the same scale, with the count written at the end. */
function Bars({ data }: { data: NamedCount[] }) {
  const theme = useTheme();
  const max = Math.max(1, ...data.map((d) => d.count));

  return (
    <View style={styles.bars}>
      {data.map((d) => (
        <View key={d.name} style={styles.barRow} accessibilityLabel={`${d.name}: ${d.count}`}>
          <ThemedText numberOfLines={1} style={styles.barLabel}>
            {d.name}
          </ThemedText>
          <View style={[styles.barTrack, { backgroundColor: theme.backgroundSelected }]}>
            {d.count ? <View style={[styles.barFill, { width: `${(d.count / max) * 100}%` }]} /> : null}
          </View>
          <ThemedText themeColor="textSecondary" style={styles.barCount}>
            {d.count}
          </ThemedText>
        </View>
      ))}
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
  heading: {
    fontSize: 32,
    lineHeight: 40,
    fontWeight: '700',
  },
  subheading: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: -12,
  },
  spinner: {
    marginTop: 24,
  },
  errorText: {
    color: '#dc2626',
  },
  card: {
    borderRadius: 20,
    padding: 16,
    gap: 14,
  },
  cardTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '700',
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
  },
  paletteWrap: {
    gap: 14,
  },
  paletteStrip: {
    flexDirection: 'row',
    height: 28,
    gap: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
  paletteSegment: {
    flexBasis: 0,
    borderWidth: StyleSheet.hairlineWidth,
  },
  paletteKey: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 16,
    rowGap: 8,
  },
  keyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  swatch: {
    width: 14,
    height: 14,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
  },
  keyName: {
    fontSize: 14,
    lineHeight: 20,
  },
  keyCount: {
    fontSize: 13,
    lineHeight: 20,
  },
  bars: {
    gap: 8,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  barLabel: {
    width: 110,
    fontSize: 14,
    lineHeight: 20,
  },
  barTrack: {
    flex: 1,
    height: 10,
    borderRadius: 4,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: ACCENT,
  },
  barCount: {
    width: 28,
    textAlign: 'right',
    fontSize: 13,
    lineHeight: 20,
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
});
