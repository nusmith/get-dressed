import { useState } from 'react';
import { Alert, Image, Platform, Pressable, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { uploadImage } from '@/lib/api';

export default function UploadScreen() {
  const [isActive, setIsActive] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [uploading, setUploading] = useState(false);

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
      setConfirmed(false);
    }
  };

  const handleDragOver = (event: any) => {
    event.preventDefault();
    setIsDragActive(true);
  };

  const handleDragLeave = () => {
    setIsDragActive(false);
  };

  const handleDrop = (event: any) => {
    event.preventDefault();
    setIsDragActive(false);

    const files = event.nativeEvent?.dataTransfer?.files;
    if (!files?.length) {
      return;
    }

    const file = files[0];
    if (!file.type.startsWith('image/')) {
      Alert.alert('Invalid file', 'Please drop an image file.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setSelectedImage(reader.result);
        setConfirmed(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const webDropZoneProps =
    Platform.OS === 'web'
      ? ({
          onDragEnter: handleDragOver,
          onDragOver: handleDragOver,
          onDrop: handleDrop,
          onDragLeave: handleDragLeave,
        } as any)
      : {};

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedView style={styles.content}>
          <ThemedText style={styles.subtitle}>
            Upload images from your closet
          </ThemedText>
          {selectedImage ? (
            <>
              <ThemedView style={styles.previewWrapper}>
                <Image source={{ uri: selectedImage }} style={styles.previewImage} resizeMode="cover" />
                <Pressable
                  disabled={!name.trim() || uploading}
                  style={styles.removeButton}
                  onPress={() => {
                    setSelectedImage(null);
                    setName('');
                    setConfirmed(false);
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
                onPress={async () => {
                  if (!selectedImage || !name.trim()) {
                    return;
                  }

                  try {
                    setUploading(true);
                    const filename = `upload-${Date.now()}.jpg`;
                    await uploadImage(selectedImage, filename, name.trim());
                    setConfirmed(true);
                    Alert.alert('Success', 'Image uploaded');
                  } catch (error) {
                    Alert.alert('Upload failed', error instanceof Error ? error.message : 'Unknown error');
                  } finally {
                    setUploading(false);
                  }
                }}>
                <ThemedText style={styles.confirmButtonText}>
                  {uploading ? 'Uploading...' : confirmed ? 'Confirmed' : 'Confirm'}
                </ThemedText>
              </Pressable>
            </>
          ) : (
            <Pressable
              {...webDropZoneProps}
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
