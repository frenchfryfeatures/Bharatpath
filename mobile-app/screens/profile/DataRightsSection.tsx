/**
 * BharatPath - DataRightsSection
 *
 * Implements the "Your data" section from the BharatPath web portal privacy page.
 * Allows candidates to:
 * - Request a data export (DSR export)
 * - Request account deletion (DSR deletion) with confirmation modal
 * - View history of requests under "YOUR REQUESTS" with status badges
 * - Download completed exports or withdraw pending deletion requests
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Modal,
  Linking,
} from 'react-native';
import {
  DownloadSimple,
  Trash,
  CheckCircle,
  Clock,
  WarningCircle,
  X,
  FileText,
} from 'phosphor-react-native';
import { Colors, Spacing, Radii } from '@/theme/tokens';
import {
  fetchPrivacyRequests,
  requestPrivacyExport,
  requestPrivacyDeletion,
  withdrawPrivacyRequest,
  getPrivacyDownload,
  PrivacyRequest,
} from '@/services/api/privacy';
import { AppAlert } from '@/components/feedback/AppAlert';

function formatDate(isoString: string | null | undefined): string {
  if (!isoString) return 'Recently';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return 'Recently';
  
  const day = date.getDate();
  const monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];
  const month = monthNames[date.getMonth()];
  const year = date.getFullYear();
  return `${day} ${month} ${year}`;
}

const TYPE_LABELS: Record<PrivacyRequest['type'], string> = {
  EXPORT: 'Data export',
  DELETE: 'Account deletion',
};

const STATE_CONFIG: Record<
  string,
  { label: string; bg: string; fg: string }
> = {
  RECEIVED: { label: 'REQUESTED', bg: '#F5F1FA', fg: '#5F4DB2' },
  PROCESSING: { label: 'IN PROGRESS', bg: '#FEF3C7', fg: '#B45309' },
  COMPLETED: { label: 'COMPLETED', bg: '#E6F1EA', fg: '#1F6B45' },
  REJECTED: { label: 'DECLINED', bg: '#FEE2E2', fg: '#991B1B' },
};

export function DataRightsSection() {
  const [requests, setRequests] = useState<PrivacyRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRequests = useCallback(async () => {
    try {
      setError(null);
      const items = await fetchPrivacyRequests();
      setRequests(items);
    } catch (err: any) {
      console.warn('[DataRightsSection] load error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  const handleRequestExport = async () => {
    setError(null);
    setExporting(true);
    try {
      const newReq = await requestPrivacyExport();
      setRequests((prev) => [newReq, ...prev.filter((r) => r.id !== newReq.id)]);
      AppAlert.alert(
        'Export Requested',
        'Your data export request has been submitted. You can check status under Your Requests.',
        [{ text: 'OK' }]
      );
    } catch (err: any) {
      setError(err?.message || 'Could not request data export. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const handleConfirmDeletion = async () => {
    setError(null);
    setDeleting(true);
    try {
      const newReq = await requestPrivacyDeletion();
      setRequests((prev) => [newReq, ...prev.filter((r) => r.id !== newReq.id)]);
      setDeleteModalVisible(false);
      AppAlert.alert(
        'Deletion Requested',
        'Your account deletion request has been submitted. You can withdraw your request before processing completes.',
        [{ text: 'OK' }]
      );
    } catch (err: any) {
      setError(err?.message || 'Could not request account deletion. Please try again.');
    } finally {
      setDeleting(false);
    }
  };

  const handleWithdraw = async (id: string) => {
    setBusyRequestId(id);
    try {
      await withdrawPrivacyRequest(id);
      await loadRequests();
      AppAlert.alert('Request Withdrawn', 'Your request has been withdrawn successfully.', [{ text: 'OK' }]);
    } catch (err: any) {
      AppAlert.alert('Error', err?.message || 'Could not withdraw request.', [{ text: 'OK' }]);
    } finally {
      setBusyRequestId(null);
    }
  };

  const handleDownload = async (id: string) => {
    setBusyRequestId(id);
    try {
      const res = await getPrivacyDownload(id);
      if (res?.url) {
        await Linking.openURL(res.url);
      } else {
        AppAlert.alert('Download Error', 'Download URL is not available right now.', [{ text: 'OK' }]);
      }
    } catch (err: any) {
      AppAlert.alert('Download Error', err?.message || 'Could not open download link.', [{ text: 'OK' }]);
    } finally {
      setBusyRequestId(null);
    }
  };

  return (
    <View style={styles.card}>
      {/* Header Row */}
      <View style={styles.headerRow}>
        <View style={styles.iconContainer}>
          <DownloadSimple size={22} color="#5F4DB2" weight="duotone" />
        </View>
        <View style={styles.headerTextGroup}>
          <Text style={styles.cardTitle}>Your data</Text>
          <Text style={styles.cardSubtitle}>
            Request a copy of your data or ask to delete your account.
          </Text>
        </View>
      </View>

      {/* Error display */}
      {error ? (
        <View style={styles.errorBox}>
          <WarningCircle size={16} color={Colors.red.fg} weight="fill" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {/* Action Buttons Row */}
      <View style={styles.buttonsRow}>
        <Pressable
          style={({ pressed }) => [
            styles.exportButton,
            pressed && styles.pressed,
            exporting && styles.btnDisabled,
          ]}
          onPress={handleRequestExport}
          disabled={exporting || deleting}
          accessibilityRole="button"
          accessibilityLabel="Request export"
        >
          {exporting ? (
            <ActivityIndicator size="small" color={Colors.navy} />
          ) : (
            <Text
              style={styles.exportButtonText}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.85}
            >
              Request export
            </Text>
          )}
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.deleteButton,
            pressed && styles.pressed,
            deleting && styles.btnDisabled,
          ]}
          onPress={() => {
            setError(null);
            setDeleteModalVisible(true);
          }}
          disabled={exporting || deleting}
          accessibilityRole="button"
          accessibilityLabel="Request deletion"
        >
          {deleting ? (
            <ActivityIndicator size="small" color="#993A22" />
          ) : (
            <Text
              style={styles.deleteButtonText}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.85}
            >
              Request deletion
            </Text>
          )}
        </Pressable>
      </View>

      {/* YOUR REQUESTS Section */}
      <View style={styles.requestsSection}>
        <Text style={styles.requestsEyebrow}>YOUR REQUESTS</Text>

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="small" color={Colors.brandAccent} />
          </View>
        ) : requests.length > 0 ? (
          <View style={styles.requestsList}>
            {requests.map((item, idx) => {
              const stateInfo = STATE_CONFIG[item.state] || {
                label: item.state,
                bg: '#F5F1FA',
                fg: '#5F4DB2',
              };
              const dateStr = formatDate(item.created_at);

              return (
                <View
                  key={item.id || idx}
                  style={[
                    styles.requestItem,
                    idx > 0 && styles.itemBorderTop,
                  ]}
                >
                  <View style={styles.itemMainRow}>
                    <View style={styles.itemTypeAndStatus}>
                      <Text style={styles.itemTitle}>
                        {TYPE_LABELS[item.type] || item.type}
                      </Text>
                      <View
                        style={[
                          styles.statusBadge,
                          { backgroundColor: stateInfo.bg },
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusBadgeText,
                            { color: stateInfo.fg },
                          ]}
                        >
                          {stateInfo.label}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.itemDate}>Requested {dateStr}</Text>
                  </View>

                  {item.erasable_at ? (
                    <Text style={styles.erasableText}>
                      Earliest erasure: {formatDate(item.erasable_at)}
                    </Text>
                  ) : null}

                  {/* Actions (Download / Withdraw) */}
                  {item.download_available ||
                  (item.type === 'DELETE' && item.state === 'RECEIVED') ? (
                    <View style={styles.itemActionsRow}>
                      {item.download_available ? (
                        <Pressable
                          style={({ pressed }) => [
                            pressed && styles.pressed,
                          ]}
                          onPress={() => handleDownload(item.id)}
                          disabled={busyRequestId === item.id}
                        >
                          <Text style={styles.actionLinkText}>
                            Download export
                          </Text>
                        </Pressable>
                      ) : null}

                      {item.type === 'DELETE' && item.state === 'RECEIVED' ? (
                        <Pressable
                          style={({ pressed }) => [
                            pressed && styles.pressed,
                          ]}
                          onPress={() => handleWithdraw(item.id)}
                          disabled={busyRequestId === item.id}
                        >
                          <Text style={styles.actionLinkText}>
                            Withdraw deletion request
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : (
          <Text style={styles.emptyRequestsText}>
            You have not requested an export or a deletion yet.
          </Text>
        )}
      </View>

      {/* Account Deletion Confirmation Modal */}
      <Modal
        visible={deleteModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!deleting) setDeleteModalVisible(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Request account deletion?</Text>
              <Pressable
                onPress={() => setDeleteModalVisible(false)}
                disabled={deleting}
                style={styles.modalCloseBtn}
              >
                <X size={18} color={Colors.navy} weight="bold" />
              </Pressable>
            </View>

            <Text style={styles.modalDesc}>
              This requests deletion of your account and personal data. You can
              withdraw your request before the listed erasure time.
            </Text>

            <View style={styles.modalWarningBox}>
              <Trash size={20} color="#993A22" weight="bold" />
              <Text style={styles.modalWarningText}>
                Review your request carefully before continuing.
              </Text>
            </View>

            <View style={styles.modalActionsRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.modalCancelBtn,
                  pressed && styles.pressed,
                ]}
                onPress={() => setDeleteModalVisible(false)}
                disabled={deleting}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [
                  styles.modalConfirmBtn,
                  pressed && styles.pressed,
                  deleting && styles.btnDisabled,
                ]}
                onPress={handleConfirmDeletion}
                disabled={deleting}
              >
                {deleting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalConfirmText}>Request deletion</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#E7E0D4',
    padding: 20,
    gap: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F5F1FA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextGroup: {
    flex: 1,
    gap: 2,
  },
  cardTitle: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 16,
    lineHeight: 20,
    color: Colors.navy,
  },
  cardSubtitle: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 18,
    color: '#5F6B80',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.red.bg,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#F0C4B8',
  },
  errorText: {
    flex: 1,
    fontFamily: 'GeneralSans-Medium',
    fontSize: 12,
    lineHeight: 16,
    color: Colors.red.fg,
  },
  buttonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  exportButton: {
    flex: 1,
    height: 44,
    borderRadius: Radii.pill,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  exportButtonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 13,
    lineHeight: 18,
    color: Colors.navy,
    textAlign: 'center',
  },
  deleteButton: {
    flex: 1,
    height: 44,
    borderRadius: Radii.pill,
    backgroundColor: '#F8E6E0',
    borderWidth: 1,
    borderColor: '#EBC7BA',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  deleteButtonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 13,
    lineHeight: 18,
    color: '#993A22',
    textAlign: 'center',
  },
  btnDisabled: {
    opacity: 0.6,
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  requestsSection: {
    borderTopWidth: 1,
    borderTopColor: '#F0EBDF',
    paddingTop: 16,
    gap: 8,
  },
  requestsEyebrow: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.2,
    color: '#5F6B80',
    textTransform: 'uppercase',
  },
  loadingBox: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  requestsList: {
    gap: 0,
  },
  requestItem: {
    paddingVertical: 10,
    gap: 6,
  },
  itemBorderTop: {
    borderTopWidth: 1,
    borderTopColor: '#F0EBDF',
  },
  itemMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  itemTypeAndStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  itemTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 13,
    lineHeight: 18,
    color: Colors.navy,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  statusBadgeText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 10,
    lineHeight: 14,
  },
  itemDate: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 11,
    lineHeight: 15,
    color: '#5F6B80',
  },
  erasableText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 11,
    lineHeight: 15,
    color: '#5F6B80',
  },
  itemActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginTop: 2,
  },
  actionLinkText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 12,
    color: Colors.brandAccent,
    textDecorationLine: 'underline',
  },
  emptyRequestsText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    lineHeight: 17,
    color: '#5F6B80',
    marginTop: 2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(10, 25, 49, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 20,
    gap: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 16,
    lineHeight: 20,
    color: Colors.navy,
    flex: 1,
  },
  modalCloseBtn: {
    padding: 4,
  },
  modalDesc: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 18,
    color: '#5F6B80',
  },
  modalWarningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F8E6E0',
    borderRadius: 14,
    padding: 12,
  },
  modalWarningText: {
    flex: 1,
    fontFamily: 'GeneralSans-Medium',
    fontSize: 12,
    lineHeight: 16,
    color: '#993A22',
  },
  modalActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  modalCancelBtn: {
    flex: 1,
    height: 42,
    borderRadius: Radii.pill,
    backgroundColor: '#F5F1FA',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 13,
    color: Colors.navy,
  },
  modalConfirmBtn: {
    flex: 1.2,
    height: 42,
    borderRadius: Radii.pill,
    backgroundColor: '#993A22',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalConfirmText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 13,
    color: '#FFFFFF',
  },
});
