import { useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { supabase } from '@/lib/supabase';

export default function AuthScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const signUp = async () => {
    if (!email || !password) {
      setErrorMessage('Please provide email and password');
      Alert.alert('Missing fields', 'Please provide email and password');
      return;
    }
    try {
      setLoading(true);
      setErrorMessage('');
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      Alert.alert('Check your email', 'A confirmation link was sent if required.');
      if (data.session) {
        router.replace('/');
      }
    } catch (err: any) {
      const message = err?.message || 'Unable to sign up right now.';
      setErrorMessage(message);
      Alert.alert('Sign up failed', message);
    } finally {
      setLoading(false);
    }
  };

  const signIn = async () => {
    if (!email || !password) {
      setErrorMessage('Please provide email and password');
      Alert.alert('Missing fields', 'Please provide email and password');
      return;
    }
    try {
      setLoading(true);
      setErrorMessage('');
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      Alert.alert('Signed in', 'You are now signed in.');
      if (data.session) {
        router.replace('/');
      }
    } catch (err: any) {
      const message = err?.message || 'Unable to sign in right now.';
      setErrorMessage(message);
      Alert.alert('Sign in failed', message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedView style={styles.content}>
          <ThemedText style={styles.title}>Sign in / Sign up</ThemedText>

          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            keyboardType="email-address"
            autoCapitalize="none"
            style={styles.input}
          />

          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            secureTextEntry
            style={styles.input}
          />

          {errorMessage ? <ThemedText style={styles.errorText}>{errorMessage}</ThemedText> : null}

          <View style={styles.row}>
            <Pressable style={styles.button} onPress={signIn} disabled={loading}>
              <ThemedText style={styles.buttonText}>{loading ? 'Working...' : 'Sign In'}</ThemedText>
            </Pressable>
            <Pressable style={styles.buttonOutline} onPress={signUp} disabled={loading}>
              <ThemedText style={styles.buttonOutlineText}>{loading ? 'Working...' : 'Sign Up'}</ThemedText>
            </Pressable>
          </View>
        </ThemedView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },
  title: { fontSize: 20, marginBottom: 8 },
  input: { width: '100%', maxWidth: 360, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, padding: 10 },
  row: { flexDirection: 'row', gap: 8, marginTop: 12 },
  errorText: { color: '#dc2626', fontSize: 14, textAlign: 'center', maxWidth: 360 },
  button: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, backgroundColor: '#4f46e5' },
  buttonText: { color: 'white', fontWeight: '600' },
  buttonOutline: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: '#4f46e5' },
  buttonOutlineText: { color: '#4f46e5', fontWeight: '600' },
});
