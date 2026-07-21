import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

export default function UploadScreen() {
  const [isActive, setIsActive] = useState(false);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedView style={styles.content}>
          <ThemedText type="title">Upload</ThemedText>
          <ThemedText style={styles.subtitle}>
            Drop images here to add them to your closet.
          </ThemedText>

          <Pressable
            style={[styles.dropZone, isActive && styles.dropZoneActive]}
            onPress={() => setIsActive((value) => !value)}
            onHoverIn={() => setIsActive(true)}
            onHoverOut={() => setIsActive(false)}>
            <ThemedText type="subtitle">Drag and drop images</ThemedText>
            <ThemedText style={styles.helperText}>No uploads yet — this is a placeholder.</ThemedText>
          </Pressable>
        </ThemedView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 12,
  },
  subtitle: {
    textAlign: 'center',
    maxWidth: 320,
  },
  dropZone: {
    width: '100%',
    maxWidth: 360,
    minHeight: 220,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 8,
  },
  dropZoneActive: {
    opacity: 0.8,
  },
  helperText: {
    textAlign: 'center',
    opacity: 0.7,
  },
});
