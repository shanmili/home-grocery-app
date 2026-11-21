import React, { useCallback, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { groupByProductCategory } from '../../constants/categoryGroups';
import UnitDropdown from '../../components/common/UnitDropdown';
import CollapsibleGroup from '../../components/common/CollapsibleGroup';
import FormModal from '../../components/common/FormModal';
import LoadingScreen from '../../components/common/LoadingScreen';
import ScreenShell from '../../components/common/ScreenShell';
import SectionCard from '../../components/common/SectionCard';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { typography } from '../../theme/typography';
import { useGrocerySync } from '../../state/grocerySyncStore';
import { useSession } from '../../state/sessionStore';
import {
  addManualShoppingItem,
  confirmShoppingItemPurchased,
  getOpenShoppingItems,
  syncAutoShoppingItems,
} from '../../db/repositories/shoppingRepo';
import { validateNonNegativeNumber, validateRequiredString } from '../../utils/validators';

const manualInitial = {
  label: '',
  requestedQuantity: '1',
  unit: '',
};

const purchaseInitial = {
  itemId: null,
  label: '',
  quantity: '',
  unitPrice: '0',
};

function ShoppingItemRow({ item, isAdmin, onMarkPurchased }) {
  return (
    <View style={styles.itemRow}>
      <Text style={styles.itemName}>{item.product_name || item.label}</Text>
      {item.suggested_quantity != null ? (
        <Text style={styles.purchaseLabel}>
          {item.product_id ? 'Suggested' : 'Requested'} {item.suggested_quantity} {item.display_unit ?? item.unit}
        </Text>
      ) : null}

      {isAdmin ? (
        <Pressable style={styles.purchaseButton} onPress={() => onMarkPurchased(item)}>
          <Text style={styles.purchaseButtonLabel}>Mark purchased</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export default function ShoppingListScreen() {
  const { revision } = useGrocerySync();
  const { currentUser } = useSession();
  const isAdmin = currentUser?.role === 'ADMIN';
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [manualVisible, setManualVisible] = useState(false);
  const [manualForm, setManualForm] = useState(manualInitial);
  const [purchaseVisible, setPurchaseVisible] = useState(false);
  const [purchaseForm, setPurchaseForm] = useState(purchaseInitial);
  const [saving, setSaving] = useState(false);

  const loadShopping = useCallback(async () => {
    if (!currentUser?.id) {
      return;
    }

    try {
      setLoading(true);
      await syncAutoShoppingItems();
      const rows = await getOpenShoppingItems();
      setItems(rows);
    } catch (error) {
      Alert.alert('Load failed', 'Unable to load shopping list from local database.');
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [currentUser?.id, revision]);

  useFocusEffect(
    useCallback(() => {
      loadShopping();
    }, [loadShopping])
  );

  const openManualModal = () => {
    setManualForm(manualInitial);
    setManualVisible(true);
  };

  const saveManualItem = async () => {
    if (!isAdmin) {
      Alert.alert('Access denied', 'Only admins can add shopping items.');
      return;
    }

    const labelError = validateRequiredString(manualForm.label, 'Item label');
    if (labelError) {
      Alert.alert('Invalid input', labelError);
      return;
    }

    const unitError = validateRequiredString(manualForm.unit, 'Unit');
    if (unitError) {
      Alert.alert('Invalid input', unitError);
      return;
    }

    const quantityError = validateNonNegativeNumber(manualForm.requestedQuantity, 'Requested quantity');
    if (quantityError) {
      Alert.alert('Invalid input', quantityError);
      return;
    }

    try {
      setSaving(true);
      await addManualShoppingItem({
        label: manualForm.label,
        requestedQuantity: manualForm.requestedQuantity,
        unit: manualForm.unit,
      }, currentUser.id);
      setManualVisible(false);
      await loadShopping();
    } catch (error) {
      Alert.alert('Save failed', 'Could not add manual shopping item.');
    } finally {
      setSaving(false);
    }
  };

  const openPurchaseModal = (item) => {
    setPurchaseForm({
      itemId: item.id,
      label: item.product_name || item.label,
      unit: item.display_unit ?? item.unit,
      quantity: item.suggested_quantity > 0 ? String(item.suggested_quantity) : '',
      unitPrice: '0',
    });
    setPurchaseVisible(true);
  };

  const purchaseTotal = Number(purchaseForm.quantity || 0) * Number(purchaseForm.unitPrice || 0);

  const confirmPurchased = async () => {
    if (!isAdmin) {
      Alert.alert('Access denied', 'Only admins can confirm purchased items.');
      return;
    }

    const quantityError = validateNonNegativeNumber(purchaseForm.quantity, 'Purchased quantity');
    if (quantityError) {
      Alert.alert('Invalid input', quantityError);
      return;
    }

    if (Number(purchaseForm.quantity) <= 0) {
      Alert.alert('Purchased quantity', 'Enter the amount you bought.');
      return;
    }

    const priceError = validateNonNegativeNumber(purchaseForm.unitPrice, 'Unit price');
    if (priceError) {
      Alert.alert('Invalid input', priceError);
      return;
    }

    if (Number(purchaseForm.unitPrice) <= 0) {
      Alert.alert('Invalid input', 'Unit price must be greater than 0.');
      return;
    }

    try {
      setSaving(true);
      await confirmShoppingItemPurchased(
        purchaseForm.itemId,
        purchaseForm.quantity,
        purchaseForm.unitPrice,
        currentUser.id
      );
      setPurchaseVisible(false);
      await loadShopping();
    } catch (error) {
      Alert.alert('Purchase failed', error.message || 'Could not mark item as purchased.');
    } finally {
      setSaving(false);
    }
  };

  const sections = [{
    title: 'To buy',
    rows: items.filter((item) => item.product_id),
    empty: 'No out-of-stock products.',
  }];
  const manualItems = items.filter((item) => !item.product_id);
  if (manualItems.length) sections.push({ title: 'Manually added', rows: manualItems });

  if (loading && !loaded) return <LoadingScreen message="Loading shopping list…" />;

  return (
    <ScreenShell>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.screenContent}
        showsVerticalScrollIndicator
        persistentScrollbar
        indicatorStyle="black"
      >
        <SectionCard
          title="Shopping List"
        >
          {loading ? <LoadingScreen compact message="Refreshing shopping list…" /> : null}

          <Pressable
            style={[styles.actionButton, !isAdmin && styles.disabledButton]}
            onPress={openManualModal}
            disabled={!isAdmin}
          >
            <Text style={[styles.actionLabel, !isAdmin && styles.disabledLabel]}>
              {isAdmin ? 'Add manual shopping item' : 'Only admins can add items'}
            </Text>
          </Pressable>

          <Pressable style={styles.refreshButton} onPress={loadShopping}>
            <Text style={styles.refreshLabel}>Refresh</Text>
          </Pressable>
        </SectionCard>

        <View style={styles.stockGroups}>
          {sections.map(({ title, rows, empty }) => (
            <CollapsibleGroup key={title} title={title} count={rows.length}>
              {groupByProductCategory(rows, (item) => item.product_category).map(({ title: category, data }) => (
                <CollapsibleGroup key={category} title={category} count={data.length}>
                  {data.map((item) => (
                    <ShoppingItemRow key={item.id} item={item} isAdmin={isAdmin} onMarkPurchased={openPurchaseModal} />
                  ))}
                </CollapsibleGroup>
              ))}
              {!loading && !rows.length ? <Text style={styles.infoText}>{empty}</Text> : null}
            </CollapsibleGroup>
          ))}
        </View>
      </ScrollView>

      <FormModal visible={manualVisible} onClose={() => setManualVisible(false)}>
        <Text style={styles.modalTitle}>Add manual shopping item</Text>
        <TextInput
          value={manualForm.label}
          onChangeText={(text) => setManualForm((prev) => ({ ...prev, label: text }))}
          placeholder="Item label"
          style={styles.input}
        />
        <Text style={styles.fieldLabel}>Requested quantity</Text>
        <TextInput
          value={manualForm.requestedQuantity}
          onChangeText={(text) => setManualForm((prev) => ({ ...prev, requestedQuantity: text }))}
          keyboardType="numeric"
          placeholder="Qty"
          style={styles.input}
        />
        <UnitDropdown value={manualForm.unit}
          onChange={(unit) => setManualForm((prev) => ({ ...prev, unit }))} />

        <View style={styles.modalActions}>
          <Pressable style={styles.cancelButton} onPress={() => setManualVisible(false)}>
            <Text style={styles.cancelLabel}>Cancel</Text>
          </Pressable>
          <Pressable
            style={[styles.saveButton, saving && styles.saveDisabled]}
            onPress={saveManualItem}
            disabled={saving}
          >
            <Text style={styles.saveLabel}>{saving ? 'Saving...' : 'Save'}</Text>
          </Pressable>
        </View>
      </FormModal>

      <FormModal visible={purchaseVisible} onClose={() => setPurchaseVisible(false)}>
        <Text style={styles.modalTitle}>Confirm purchase</Text>
        <Text style={styles.purchaseLabel}>{purchaseForm.label} ({purchaseForm.unit})</Text>
        <Text style={styles.fieldLabel}>Purchased quantity</Text>
        <TextInput
          value={purchaseForm.quantity}
          onChangeText={(text) => setPurchaseForm((prev) => ({ ...prev, quantity: text }))}
          keyboardType="numeric"
          accessibilityLabel="Purchased quantity"
          placeholder="Enter the amount you bought"
          style={styles.input}
        />
        <Text style={styles.fieldLabel}>Unit price</Text>
        <TextInput
          value={purchaseForm.unitPrice}
          onChangeText={(text) => setPurchaseForm((prev) => ({ ...prev, unitPrice: text }))}
          keyboardType="decimal-pad"
          placeholder="Unit price"
          accessibilityLabel="Unit price"
          style={styles.input}
        />

        <Text style={styles.totalText}>Total cost: {purchaseTotal.toFixed(2)}</Text>

        <View style={styles.modalActions}>
          <Pressable style={styles.cancelButton} onPress={() => setPurchaseVisible(false)}>
            <Text style={styles.cancelLabel}>Cancel</Text>
          </Pressable>
          <Pressable
            style={[styles.saveButton, saving && styles.saveDisabled]}
            onPress={confirmPurchased}
            disabled={saving}
          >
            <Text style={styles.saveLabel}>{saving ? 'Saving...' : 'Confirm'}</Text>
          </Pressable>
        </View>
      </FormModal>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  stockGroups: { gap: spacing.sm },
  screen: {
    flex: 1,
  },
  screenContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  infoText: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  itemRow: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: spacing.sm,
    backgroundColor: colors.input,
  },
  itemName: {
    ...typography.body,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  purchaseButton: {
    marginTop: spacing.sm,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    paddingVertical: 8,
    alignItems: 'center',
  },
  purchaseButtonLabel: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  actionButton: {
    marginTop: spacing.sm,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: colors.primary,
  },
  disabledButton: {
    backgroundColor: colors.surfaceAlt,
  },
  actionLabel: {
    ...typography.body,
    color: '#FFFFFF',
    fontWeight: '700',
  },
  disabledLabel: {
    color: colors.textSecondary,
  },
  refreshButton: {
    marginTop: spacing.sm,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: colors.input,
  },
  refreshLabel: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  totalText: {
    ...typography.body,
    color: colors.primaryDark,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  fieldLabel: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.xs },
  modalTitle: {
    ...typography.heading,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  purchaseLabel: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
    backgroundColor: colors.input,
  },
  modalActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  cancelButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: colors.input,
  },
  cancelLabel: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  saveButton: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: colors.primary,
  },
  saveDisabled: {
    backgroundColor: colors.textSecondary,
  },
  saveLabel: {
    ...typography.caption,
    color: '#FFFFFF',
    fontWeight: '700',
  },
});
