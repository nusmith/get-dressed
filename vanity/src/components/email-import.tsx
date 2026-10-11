import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { StepHeading } from '@/components/step-heading';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  connectGmail,
  disconnectEmail,
  fetchEmailStatus,
  getGmailAuthUrl,
  importProposals,
  scanEmailReceipts,
  type EmailProposal,
  type EmailStatus,
} from '@/lib/email';

// Drop Google's ?code&state&scope from the address bar once they've been used.
// router.replace() to the current route keeps query params, so edit history directly (web only).
function clearOAuthParams() {
  if (Platform.OS === 'web') {
    window.history.replaceState(window.history.state, '', window.location.pathname);
  }
}

// Google codes are single-use. Track the last one at module level so a remount (the router may still
// hold the old params after the URL is cleaned) doesn't try to redeem it again.
let handledCode: string | null = null;

export function EmailImport() {
  // Google redirects back to /upload with ?code&state (or ?error) after consent.
  const params = useLocalSearchParams<{ code?: string; state?: string; error?: string }>();
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [busy, setBusy] = useState<'connecting' | 'scanning' | 'disconnecting' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proposals, setProposals] = useState<EmailProposal[] | null>(null);
  const [adding, setAdding] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchEmailStatus()
      .then(setStatus)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load email status'));
  }, []);

  const { code, state, error: oauthError } = params;
  useEffect(() => {
    if (oauthError) {
      setError(oauthError === 'access_denied' ? 'Gmail access was not granted.' : oauthError);
      clearOAuthParams();
      return;
    }
    if (!code || !state || handledCode === code) return;
    handledCode = code;

    setBusy('connecting');
    setError(null);
    connectGmail(code, state)
      .then(setStatus)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not connect Gmail'))
      .finally(() => {
        setBusy(null);
        clearOAuthParams();
      });
  }, [code, state, oauthError]);

  const handleConnect = async () => {
    setError(null);
    try {
      const url = await getGmailAuthUrl();
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start Gmail sign-in');
    }
  };

  const handleDisconnect = async () => {
    setBusy('disconnecting');
    setError(null);
    try {
      setStatus(await disconnectEmail());
      setProposals(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not disconnect Gmail');
    } finally {
      setBusy(null);
    }
  };

  const handleScan = async () => {
    setBusy('scanning');
    setError(null);
    try {
      const result = await scanEmailReceipts();
      setProposals(result.proposals);
      setAdded(new Set(result.proposals.filter((p) => p.already_added).map((p) => p.key)));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not scan receipts';
      setError(message);
      // The backend drops the connection if Google access was revoked.
      fetchEmailStatus().then(setStatus).catch(() => {});
    } finally {
      setBusy(null);
    }
  };

  const handleAdd = async (items: EmailProposal[]) => {
    const keys = items.map((p) => p.key);
    setAdding((prev) => new Set([...prev, ...keys]));
    setError(null);
    try {
      const results = await importProposals(items.map((p) => p.token));
      setAdded((prev) => new Set([...prev, ...results.map((r) => r.key)]));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add items');
    } finally {
      setAdding((prev) => new Set([...prev].filter((k) => !keys.includes(k))));
    }
  };

  if (Platform.OS !== 'web') {
    return (
      <ThemedView style={styles.card}>
        <StepHeading step={2} title="Import from email" />
        <ThemedText style={styles.helperText}>Importing from email is available on the web app for now.</ThemedText>
      </ThemedView>
    );
  }

  const pending = proposals?.filter((p) => !added.has(p.key)) ?? [];

  return (
    <ThemedView style={styles.card}>
      <StepHeading step={2} title="Import from email" />

      {status === null || busy === 'connecting' ? (
        <ActivityIndicator />
      ) : !status.connected ? (
        <>
          <ThemedText style={styles.helperText}>Find clothes in your shopping receipts.</ThemedText>
          <ThemedText style={styles.finePrint}>
            Get Dressed asks for read-only Gmail access and only looks at order confirmations.
          </ThemedText>
          <Pressable style={styles.primaryButton} onPress={handleConnect}>
            <ThemedText style={styles.primaryButtonText}>Connect Gmail</ThemedText>
          </Pressable>
        </>
      ) : (
        <>
          <ThemedText style={styles.connectedText} numberOfLines={1}>
            Connected as {status.email ?? 'Gmail'}
          </ThemedText>
          <View style={styles.buttonRow}>
            <Pressable
              disabled={busy !== null}
              style={[styles.secondaryButton, busy !== null && styles.buttonDisabled]}
              onPress={handleDisconnect}>
              <ThemedText style={styles.secondaryButtonText}>
                {busy === 'disconnecting' ? 'Disconnecting...' : 'Disconnect'}
              </ThemedText>
            </Pressable>
            <Pressable
              disabled={busy !== null}
              style={[styles.primaryButton, busy !== null && styles.buttonDisabled]}
              onPress={handleScan}>
              <ThemedText style={styles.primaryButtonText}>
                {busy === 'scanning' ? 'Scanning receipts...' : proposals ? 'Scan again' : 'Scan receipts'}
              </ThemedText>
            </Pressable>
          </View>
        </>
      )}

      {error ? <ThemedText style={styles.errorText}>{error}</ThemedText> : null}

      {proposals && busy !== 'scanning' ? (
        proposals.length === 0 ? (
          <ThemedText style={styles.helperText}>No clothing found in recent receipts.</ThemedText>
        ) : (
          <>
            <View style={styles.row}>
              <ThemedText style={styles.connectedText}>
                Found {proposals.length} item{proposals.length === 1 ? '' : 's'}
              </ThemedText>
              {pending.length > 1 ? (
                <Pressable disabled={adding.size > 0} onPress={() => handleAdd(pending)}>
                  <ThemedText style={styles.linkText}>Add all</ThemedText>
                </Pressable>
              ) : null}
            </View>
            <View style={styles.list}>
              {proposals.map((proposal) => {
                const isAdded = added.has(proposal.key);
                const isAdding = adding.has(proposal.key);
                return (
                  <View key={proposal.key} style={styles.proposal}>
                    {proposal.image_url ? (
                      <Image source={{ uri: proposal.image_url }} style={styles.thumb} resizeMode="contain" />
                    ) : (
                      <View style={[styles.thumb, styles.thumbPlaceholder]} />
                    )}
                    <View style={styles.proposalText}>
                      <ThemedText style={styles.proposalName} numberOfLines={2}>
                        {proposal.name}
                      </ThemedText>
                      <ThemedText style={styles.proposalMeta} numberOfLines={1}>
                        {proposal.retailer}
                        {proposal.date ? ` · ${new Date(proposal.date).toLocaleDateString()}` : ''}
                      </ThemedText>
                    </View>
                    <Pressable
                      disabled={isAdded || isAdding}
                      style={[styles.addButton, isAdded && styles.addButtonDone]}
                      onPress={() => handleAdd([proposal])}>
                      <ThemedText style={[styles.addButtonText, isAdded && styles.addButtonTextDone]}>
                        {isAdded ? 'Added' : isAdding ? 'Adding...' : 'Add'}
                      </ThemedText>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          </>
        )
      ) : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    maxWidth: 360,
    gap: 10,
    paddingTop: 36,
    alignItems: 'center',
  },
  helperText: {
    textAlign: 'center',
    opacity: 0.7,
  },
  finePrint: {
    textAlign: 'center',
    fontSize: 12,
    lineHeight: 16,
    color: '#9ca3af',
  },
  row: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  connectedText: {
    flexShrink: 1,
    opacity: 0.8,
  },
  linkText: {
    color: '#4f46e5',
    fontWeight: '600',
  },
  primaryButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#4f46e5',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  secondaryButton: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: 'white',
  },
  secondaryButtonText: {
    color: '#374151',
    fontWeight: '600',
  },
  primaryButtonText: {
    color: 'white',
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  errorText: {
    color: '#dc2626',
    textAlign: 'center',
  },
  list: {
    width: '100%',
    gap: 8,
  },
  proposal: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#f3f4f6',
    backgroundColor: 'white',
  },
  thumbPlaceholder: {
    backgroundColor: '#e5e7eb',
  },
  proposalText: {
    flex: 1,
  },
  proposalName: {
    fontSize: 14,
    lineHeight: 18,
  },
  proposalMeta: {
    fontSize: 12,
    lineHeight: 16,
    opacity: 0.6,
  },
  addButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#4f46e5',
  },
  addButtonDone: {
    borderColor: '#d1d5db',
  },
  addButtonText: {
    color: '#4f46e5',
    fontWeight: '600',
    fontSize: 13,
  },
  addButtonTextDone: {
    color: '#6b7280',
  },
});
