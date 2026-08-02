import { useState } from 'react';
import { Alert, Image, Platform, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

export default function UploadScreen() {
  const [isActive, setIsActive] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

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
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedView style={styles.content}>
          <ThemedText type="title">Upload</ThemedText>
          <ThemedText style={styles.subtitle}>
            Choose or drag an image into the box.
          </ThemedText>

          <Pressable
            style={[styles.dropZone, (isActive || isDragActive) && styles.dropZoneActive]}
            onPress={pickImage}
            onHoverIn={() => setIsActive(true)}
            onHoverOut={() => setIsActive(false)}
            onDragOver={Platform.OS === 'web' ? handleDragOver : undefined}
            onDrop={Platform.OS === 'web' ? handleDrop : undefined}
            onDragLeave={Platform.OS === 'web' ? handleDragLeave : undefined}>
            <ThemedText type="subtitle">Drag and drop images</ThemedText>
            <ThemedText style={styles.helperText}>
              {selectedImage
                ? 'Image selected. Tap to choose another one.'
                : 'Tap this box or drop an image here.'}
            </ThemedText>
          </Pressable>

          {selectedImage ? (
            <Image source={{ uri: selectedImage }} style={styles.previewImage} resizeMode="cover" />
          ) : null}
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
  previewImage: {
    width: '100%',
    maxWidth: 360,
    height: 240,
    borderRadius: 20,
  },
});
