import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';

type State = { hasError: boolean; error?: Error };

export default class ErrorBoundary extends React.Component<{
  children: React.ReactNode;
  fallbackMessage?: string;
}, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: any) {
    // eslint-disable-next-line no-console
    console.error('ErrorBoundary caught', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <ThemedView type="backgroundElement" style={styles.inner}>
            <ThemedText type="small">{this.props.fallbackMessage ?? 'Something went wrong.'}</ThemedText>
            {this.state.error && (
              <ThemedText type="small">{String(this.state.error.message)}</ThemedText>
            )}
          </ThemedView>
        </View>
      );
    }

    return this.props.children as React.ReactElement;
  }
}

const styles = StyleSheet.create({
  container: {
    width: '100%'
  },
  inner: {
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center'
  }
});
