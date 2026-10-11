import { useEffect, useRef, useState } from 'react';
import { Alert, Image, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';

import { EmailImport } from '@/components/email-import';
import { ItemDetailsModal } from '@/components/item-details-modal';
import { StepHeading } from '@/components/step-heading';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { uploadImage } from '@/lib/api';
import type { ItemDetails } from '@/lib/taxonomy';

export default function UploadScreen() {
  const [isActive, setIsActive] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleUpload = async (finalName: string, details: ItemDetails) => {
    if (!selectedImage) return;
    try {
      setUploading(true);
      setUploadError(null);
      const filename = `upload-${Date.now()}.jpg`;
      await uploadImage(selectedImage, filename, finalName, details);
      setDetailsOpen(false);
      setSelectedImage(null);
      setName('');
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const pickImage = async () => {
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permissionResult.granted) {
      Alert.alert('Permission required', 'Please allow access to your photo library.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
      allowsEditing: true,
    });

    if (!result.canceled && result.assets?.[0]?.uri) {
      setSelectedImage(result.assets[0].uri);
    }
  };

  const dropZoneRef = useRef<View>(null);

  // react-native-web doesn't forward drag events from props to the DOM, so wire them up directly.
  // Re-run when selectedImage changes because the drop zone unmounts while a preview is shown.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = dropZoneRef.current as unknown as HTMLElement | null;
    if (!node) return;

    const handleDragOver = (event: DragEvent) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      setIsDragActive(true);
    };

    const handleDragLeave = (event: DragEvent) => {
      // dragleave also fires when moving over the zone's own children; ignore those.
      if (event.relatedTarget instanceof Node && node.contains(event.relatedTarget)) return;
      setIsDragActive(false);
    };

    const handleDrop = (event: DragEvent) => {
      event.preventDefault();
      setIsDragActive(false);

      const file = event.dataTransfer?.files?.[0];
      if (!file) {
        return;
      }

      if (!file.type.startsWith('image/')) {
        Alert.alert('Invalid file', 'Please drop an image file.');
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          setSelectedImage(reader.result);
        }
      };
      reader.readAsDataURL(file);
    };

    node.addEventListener('dragenter', handleDragOver);
    node.addEventListener('dragover', handleDragOver);
    node.addEventListener('dragleave', handleDragLeave);
    node.addEventListener('drop', handleDrop);
    return () => {
      node.removeEventListener('dragenter', handleDragOver);
      node.removeEventListener('dragover', handleDragOver);
      node.removeEventListener('dragleave', handleDragLeave);
      node.removeEventListener('drop', handleDrop);
    };
  }, [selectedImage]);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <StepHeading step={1} title="Upload images from your closet" />
          {selectedImage ? (
            <>
              <ThemedView style={styles.previewWrapper}>
                <Image source={{ uri: selectedImage }} style={styles.previewImage} resizeMode="cover" />
                <Pressable
                  disabled={uploading}
                  accessibilityLabel="Remove image"
                  style={[styles.removeButton, uploading && styles.confirmButtonDisabled]}
                  onPress={() => {
                    setSelectedImage(null);
                    setName('');
                  }}>
                  <ThemedText style={styles.removeButtonText}>✕</ThemedText>
                </Pressable>
              </ThemedView>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Name this item"
                style={styles.nameInput}
              />
              <Pressable
                disabled={!name.trim() || uploading}
                style={[styles.confirmButton, (!name.trim() || uploading) && styles.confirmButtonDisabled]}
                onPress={() => {
                  setUploadError(null);
                  setDetailsOpen(true);
                }}>
                <ThemedText style={styles.confirmButtonText}>
                  {uploading ? 'Uploading...' : 'Confirm'}
                </ThemedText>
              </Pressable>
            </>
          ) : (
            <Pressable
              ref={dropZoneRef}
              style={[styles.dropZone, (isActive || isDragActive) && styles.dropZoneActive]}
              onPress={pickImage}
              onHoverIn={() => setIsActive(true)}
              onHoverOut={() => setIsActive(false)}>
              <ThemedText style={styles.helperText}>
                {selectedImage
                  ? 'Image selected. Tap to choose another one.'
                  : 'Tap or drop here.'}
              </ThemedText>
            </Pressable>
          )}
          <ItemDetailsModal
            visible={detailsOpen}
            imageUri={selectedImage}
            initialName={name.trim()}
            autofill
            busy={uploading}
            error={uploadError}
            onCancel={() => setDetailsOpen(false)}
            onConfirm={handleUpload}
          />
          <EmailImport />
          <ThemedView style={styles.comingSoon}>
            <StepHeading step={3} title="Import from Instagram" note="Coming soon" disabled />
          </ThemedView>
        </ScrollView>
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
    flexGrow: 1,
    justifyContent: 'flex-start',
    alignItems: 'center',
    padding: 24,
    // The web tab bar (~80px) floats over the top of the page (see app-tabs.web.tsx).
    paddingTop: Platform.OS === 'web' ? 104 : 24,
    paddingBottom: 80,
    gap: 12,
  },
  comingSoon: {
    width: '100%',
    maxWidth: 360,
    paddingTop: 36,
  },
  sessionHint: {
    textAlign: 'center',
    opacity: 0.75,
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
    borderColor: '#4f46e5',
  },
  helperText: {
    textAlign: 'center',
    opacity: 0.7,
  },
  previewWrapper: {
    position: 'relative',
    width: '100%',
    maxWidth: 360,
  },
  nameInput: {
    width: '100%',
    maxWidth: 360,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  previewImage: {
    width: '100%',
    maxWidth: 360,
    height: 240,
    borderRadius: 20,
  },
  removeButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 30,
    height: 30,
    borderRadius: 999,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  removeButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 16,
  },
  confirmButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#4f46e5',
  },
  confirmButtonDisabled: {
    opacity: 0.5,
  },
  confirmButtonText: {
    color: 'white',
    fontWeight: '600',
  },
});
