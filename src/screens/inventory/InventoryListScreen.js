import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { groupByProductCategory } from '../../constants/categoryGroups';
import { stockStatus } from '../../constants/stockStatus';
import CollapsibleGroup from '../../components/common/CollapsibleGroup';
import { addCustomCategory, getCustomCategories } from '../../db/repositories/categoriesRepo';
import UnitDropdown from '../../components/common/UnitDropdown';
import CategoryLink from '../../components/common/CategoryLink';
import FormModal from '../../components/common/FormModal';
import ExpirationDateField from '../../components/common/ExpirationDateField';
import LoadingScreen from '../../components/common/LoadingScreen';
import ScreenShell from '../../components/common/ScreenShell';
import SectionCard from '../../components/common/SectionCard';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { typography } from '../../theme/typography';
import { useGrocerySync } from '../../state/grocerySyncStore';
import { useSession } from '../../state/sessionStore';
import { PRODUCT_CATEGORIES } from '../../constants/categories';
import { findCatalogProducts } from '../../constants/productCatalog';
import { expirationNotice, frozenFishReminderDate, isValidExpirationDate } from '../../utils/expiration';
import {
  adjustProductQuantity,
  archiveProduct,
  createProduct,
  getActiveProducts,
  returnProductUse,
  updateProduct,
} from '../../db/repositories/productsRepo';
import { validateNonNegativeNumber, validateRequiredString } from '../../utils/validators';

const initialFormState = {
  name: '',
  category: PRODUCT_CATEGORIES[0],
  quantity: '0',
  piecesPerPack: '',
  loosePieces: '0',
  unit: '',
  minThreshold: '',
  expirationDate: '',
};

function ProductRow({ item, isAdmin, onDecrease, onIncrease, onReturn, onEdit, onArchive }) {
  const quantityUnit = item.pieces_per_pack ? 'pc/s' : item.unit;
  const notice = item.quantity > 0 ? expirationNotice(item.expiration_date) : null;
  const status = stockStatus(item.quantity);
  const stockLabel = { low: 'Low stock', out: 'Out of stock', 'in-stock': 'In stock' }[status];

  return (
    <View style={styles.productRow}>
      <View>
        <Text style={styles.productName}>{item.name}</Text>
        <Text style={[styles.productMeta, status !== 'in-stock' && styles.lowText]}>
          {item.quantity} {quantityUnit}  · {stockLabel}
        </Text>
        <Text style={styles.categoryMeta}>
          {item.category}{item.min_threshold > 0 ? ' · Restock target ' + item.min_threshold + ' ' + quantityUnit : ''}
        </Text>
        {item.expiration_date ? (
          <Text style={[styles.categoryMeta, notice && styles.lowText]}>
            Date {item.expiration_date}{notice ? ' · ' + notice : ''}
          </Text>
        ) : null}
      </View>

      <View style={styles.adjustWrap}>
        <Pressable accessibilityRole="button" accessibilityLabel={'Use one ' + item.name}
          disabled={item.quantity <= 0} style={[styles.minusButton, item.quantity <= 0 && styles.disabled]}
          onPress={() => onDecrease(item.id)}>
          <Text style={styles.minusLabel}>−</Text>
        </Pressable>
        {isAdmin ? (<>
          <Pressable accessibilityRole="button" accessibilityLabel={'Add one ' + item.name}
            style={styles.plusButton} onPress={() => onIncrease(item.id)}>
            <Text style={styles.plusLabel}>+</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={styles.actionButton} onPress={() => onEdit(item)}>
            <Text style={styles.actionButtonLabel}>Edit</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={styles.archiveButton} onPress={() => onArchive(item.id)}>
            <Text style={styles.archiveButtonLabel}>Archive</Text>
          </Pressable>
        </>) : item.return_use_id ? (
          <Pressable accessibilityRole="button" style={styles.actionButton} onPress={() => onReturn(item)}>
            <Text style={styles.actionButtonLabel}>Return last use</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export default function InventoryListScreen({ navigation, route }) {
  const category = route.params?.category;
  const stockFilter = route.params?.stockFilter;
  const title = stockFilter === 'low' ? 'Low stock' : stockFilter === 'out' ? 'Out of stock' : 'Inventory';
  const { revision } = useGrocerySync();
  const { currentUser } = useSession();
  const isAdmin = currentUser?.role === 'ADMIN';
  const returnActorId = currentUser?.role === 'MEMBER' ? currentUser.id : null;
  const [products, setProducts] = useState([]);
  const [customCategories, setCustomCategories] = useState([]);
  const [categoryModalVisible, setCategoryModalVisible] = useState(false);
  const [categoryName, setCategoryName] = useState('');
  const [savingCategory, setSavingCategory] = useState(false);
  const [searchText, setSearchText] = useState(route.params?.searchText ?? '');
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [formVisible, setFormVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingProductId, setEditingProductId] = useState(null);
  const [form, setForm] = useState(initialFormState);

  const [showSuggestions, setShowSuggestions] = useState(true);
  const catalogMatches = !editingProductId && showSuggestions ? findCatalogProducts(form.name) : [];

  const visibleProducts = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    return products.filter((item) =>
      (!category || (item.category?.trim() || 'Uncategorized') === category) &&
      (!stockFilter || stockStatus(item.quantity) === stockFilter) &&
      (!keyword || [item.name, item.category, item.unit].some((field) =>
        field.toLowerCase().includes(keyword)
      ))
    );
  }, [products, searchText, stockFilter, category]);

  const categoryOptions = useMemo(() => [...new Set([
    ...PRODUCT_CATEGORIES, ...customCategories, ...products.map((product) => product.category.trim()).filter(Boolean),
  ])], [customCategories, products]);
  const categories = useMemo(() => {
    const groups = groupByProductCategory(visibleProducts, (item) => item.category);
    if (stockFilter) return groups;
    const keyword = searchText.trim().toLowerCase();
    for (const name of customCategories) {
      if (name.toLowerCase().includes(keyword) && !groups.some((group) => group.title === name)) {
        groups.push({ title: name, data: [] });
      }
    }
    return groups;
  }, [visibleProducts, customCategories, searchText, stockFilter]);

  useFocusEffect(useCallback(() => {
    if (!currentUser?.id) return undefined;
    let active = true;
    setLoading(true);
    Promise.all([getActiveProducts(returnActorId), getCustomCategories()])
      .then(([rows, names]) => {
        if (active) {
          setProducts(rows);
          setCustomCategories(names);
        }
      })
      .catch(() => { if (active) Alert.alert('Load failed', 'Unable to load local inventory data.'); })
      .finally(() => { if (active) { setLoading(false); setLoaded(true); } });
    return () => { active = false; };
  }, [currentUser?.id, returnActorId, revision]));

  const refreshProducts = async () => {
    const rows = await getActiveProducts(returnActorId);
    setProducts(rows);
  };

  const openCreateModal = () => {
    setEditingProductId(null);
    setShowSuggestions(true);
    setForm(category && categoryOptions.includes(category) ? { ...initialFormState, category } : initialFormState);
    setFormVisible(true);
  };

  async function saveCategory() {
    if (!isAdmin || savingCategory) return;
    const name = categoryName.trim();
    if (!name || name.length > 60) {
      Alert.alert('Invalid category', 'Enter a category name of 1 to 60 characters.');
      return;
    }
    if (categoryOptions.some((existing) => existing.toLowerCase() === name.toLowerCase())) {
      Alert.alert('Category already exists');
      return;
    }
    setSavingCategory(true);
    try {
      if (!(await addCustomCategory(name))) {
        Alert.alert('Category already exists');
        return;
      }
      setCustomCategories(await getCustomCategories());
      setSearchText('');
      setCategoryModalVisible(false);
    } catch {
      Alert.alert('Save failed', 'Could not save the category on this device.');
    } finally {
      setSavingCategory(false);
    }
  }

  const openEditModal = (item) => {
    setEditingProductId(item.id);
    setForm({
      name: item.name,
      category: item.category,
      quantity: String(item.pieces_per_pack ? Math.floor(item.quantity / item.pieces_per_pack) : item.quantity),
      piecesPerPack: item.pieces_per_pack ? String(item.pieces_per_pack) : '',
      loosePieces: String(item.pieces_per_pack ? item.quantity % item.pieces_per_pack : 0),
      expectedVersion: item.server_version,
      originalQuantity: item.quantity,
      unit: item.unit.toLowerCase() === 'packs' ? 'pack' : item.unit,
      minThreshold: item.min_threshold > 0 ? String(item.min_threshold) : '',
      expirationDate: item.expiration_date ?? '',
    });
    setFormVisible(true);
  };

  const validateForm = () => {
    const nameError = validateRequiredString(form.name, 'Product name');
    if (nameError) return nameError;

    const categoryError = validateRequiredString(form.category, 'Category');
    if (categoryError) return categoryError;

    const unitError = validateRequiredString(form.unit, 'Unit');
    if (unitError) return unitError;

    const quantityError = validateNonNegativeNumber(form.quantity, 'Quantity');
    if (quantityError) return quantityError;

    if (form.unit === 'pack') {
      const packs = Number(form.quantity);
      const size = Number(form.piecesPerPack);
      const loose = Number(form.loosePieces);
      if (!Number.isSafeInteger(packs)) return 'Enter a whole number of full packs.';
      if (!Number.isInteger(size) || size < 1 || size > 2147483647) return 'Enter a valid whole number of pieces per pack.';
      if (!Number.isSafeInteger(loose) || loose < 0 || loose >= size) return 'Enter fewer loose pieces than the number of pieces per pack.';
      if (!Number.isSafeInteger(packs * size + loose)) return 'The total piece count is too large.';
    }

    const thresholdError = validateNonNegativeNumber(form.minThreshold, 'Restock target');
    if (thresholdError) return thresholdError;
    if (form.unit === 'pack' && !Number.isSafeInteger(Number(form.minThreshold))) {
      return 'Enter the restock target as a whole number of pieces.';
    }

    if (form.expirationDate.trim() && !isValidExpirationDate(form.expirationDate.trim())) {
      return 'Choose a valid expiration date.';
    }

    return null;
  };

  const handleSubmitForm = async () => {
    if (!isAdmin) {
      Alert.alert('Access denied', 'Only admins can create or edit products.');
      return;
    }

    const validationError = validateForm();
    if (validationError) {
      Alert.alert('Invalid input', validationError);
      return;
    }

    try {
      setSubmitting(true);

      const payload = {
        ...form,
        name: form.name.trim(),
        category: form.category.trim(),
        unit: form.unit.trim(),
        quantity: form.unit === 'pack'
          ? Number(form.quantity) * Number(form.piecesPerPack) + Number(form.loosePieces)
          : Number(form.quantity),
        piecesPerPack: form.unit === 'pack' ? Number(form.piecesPerPack)
          : form.piecesPerPack ? null : undefined,
        expirationDate: form.expirationDate.trim() || null,
      };

      if (editingProductId) {
        await updateProduct(editingProductId, payload, currentUser.id);
      } else {
        await createProduct(payload, currentUser.id);
      }

      await refreshProducts();
      setFormVisible(false);
      setForm(initialFormState);
      setEditingProductId(null);
    } catch (error) {
      Alert.alert('Save failed', error.message || 'Could not save product to local database.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleArchive = async (productId) => {
    if (!isAdmin) {
      Alert.alert('Access denied', 'Only admins can archive products.');
      return;
    }

    Alert.alert('Archive product', 'Do you want to archive this product?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Archive',
        style: 'destructive',
        onPress: async () => {
          try {
            await archiveProduct(productId, currentUser.id);
            await refreshProducts();
          } catch (error) {
            Alert.alert('Archive failed', 'Could not archive product locally.');
          }
        },
      },
    ]);
  };

  const handleDecrease = async (productId) => {
    try {
      const result = await adjustProductQuantity(productId, -1, currentUser.id, currentUser.role);
      if (!result.changed) {
        Alert.alert('No change', 'Quantity is already zero.');
      }
      await refreshProducts();
    } catch (error) {
      Alert.alert('Update failed', 'Could not decrease quantity.');
    }
  };

  const handleIncrease = async (productId) => {
    if (!isAdmin) {
      Alert.alert('Access denied', 'Only admins can increase quantity.');
      return;
    }

    try {
      await adjustProductQuantity(productId, 1, currentUser.id, currentUser.role);
      await refreshProducts();
    } catch (error) {
      Alert.alert('Update failed', 'Could not increase quantity.');
    }
  };

  const handleReturn = (item) => {
    if (!returnActorId || !item.return_use_id) return;
    const unit = item.pieces_per_pack ? 'pc/s' : item.unit;
    Alert.alert('Return ' + item.name + '?', 'Put ' + item.return_quantity + ' ' + unit + ' back in stock?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Return', onPress: async () => {
        try {
          await returnProductUse(item.id, item.return_use_id, returnActorId);
          await refreshProducts();
        } catch (error) {
          Alert.alert('Return unavailable', error.message || 'Could not return this item.');
        }
      } },
    ]);
  };

  if (loading && !loaded) return <LoadingScreen message="Loading inventory…" />;

  return (
    <ScreenShell>
      <View style={styles.screen}>
        <SectionCard
          title={category ?? title}
          subtitle={stockFilter === 'low' ? 'More than 0 and up to 2 left.' : undefined}
        >
          <FlatList
            automaticallyAdjustKeyboardInsets
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
            persistentScrollbar
            indicatorStyle="black"
            data={category ? visibleProducts : categories}
            ListHeaderComponent={<>
              <TextInput
                value={searchText}
                accessibilityLabel="Search inventory"
                onChangeText={setSearchText}
                placeholder="Search by name, category, or unit"
                placeholderTextColor={colors.textSecondary}
                style={styles.searchInput}
              />

              {isAdmin && !stockFilter ? (
                <Pressable style={styles.addButton} onPress={openCreateModal}>
                  <Text style={styles.addButtonLabel}>+ Add product</Text>
                </Pressable>
              ) : null}

              {isAdmin && !stockFilter && !category ? (
                <Pressable style={styles.addButton} onPress={() => { setCategoryName(''); setCategoryModalVisible(true); }}>
                  <Text style={styles.addButtonLabel}>+ Add category</Text>
                </Pressable>
              ) : null}

              {loading ? <LoadingScreen compact message="Refreshing inventory…" /> : null}
            </>}
            keyExtractor={(item) => category ? item.id : item.title}
            ItemSeparatorComponent={() => <View style={styles.categorySpacing} />}
            renderItem={({ item }) => {
              const renderProduct = (product) => (
                <ProductRow
                  key={product.id}
                  item={product}
                  isAdmin={isAdmin}
                  onDecrease={handleDecrease}
                  onIncrease={handleIncrease}
                  onReturn={handleReturn}
                  onEdit={openEditModal}
                  onArchive={handleArchive}
                />
              );
              if (category) return renderProduct(item);
              if (stockFilter) {
                return (
                  <CollapsibleGroup title={item.title} count={item.data.length}>
                    {item.data.map(renderProduct)}
                  </CollapsibleGroup>
                );
              }
              return (
                <CategoryLink
                  title={item.title}
                  onPress={() => navigation.navigate('InventoryCategory', { category: item.title, searchText })}
                />
              );
            }}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              !loading ? <Text style={styles.infoText}>No matching products.</Text> : null
            }
          />
        </SectionCard>
      </View>

      <FormModal visible={categoryModalVisible} onClose={() => setCategoryModalVisible(false)}>
        <Text style={styles.modalTitle}>Add category</Text>
        <TextInput
          accessibilityLabel="Category name"
          value={categoryName}
          onChangeText={setCategoryName}
          placeholder="Category name"
          maxLength={60}
          style={styles.input}
        />
        <Pressable disabled={savingCategory} style={styles.addButton} onPress={saveCategory}>
          <Text style={styles.addButtonLabel}>{savingCategory ? 'Saving...' : 'Save category'}</Text>
        </Pressable>
        <Pressable disabled={savingCategory} style={styles.addButton} onPress={() => setCategoryModalVisible(false)}>
          <Text style={styles.addButtonLabel}>Cancel</Text>
        </Pressable>
      </FormModal>

      <FormModal visible={formVisible} onClose={() => setFormVisible(false)}>
        <Text style={styles.modalTitle}>{editingProductId ? 'Edit product' : 'Add product'}</Text>

        <TextInput
          value={form.name}
          onChangeText={(text) => {
            setShowSuggestions(true);
            setForm((prev) => ({ ...prev, name: text }));
          }}
          accessibilityLabel="Product name"
          placeholder={editingProductId ? 'Product name' : 'Search groceries or type a new name'}
          style={styles.input}
        />

        {catalogMatches.map(({ name, category, unit }) => (
          <Pressable
            key={name}
            accessibilityRole="button"
            style={styles.catalogOption}
            onPress={() => {
              setShowSuggestions(false);
              setForm((prev) => ({
                ...prev, name, category, unit,
                expirationDate: prev.expirationDate || (name === 'Frozen Fish' ? frozenFishReminderDate() : ''),
              }));
            }}
          >
            <Text style={styles.inputLabel}>{name} · {category}</Text>
          </Pressable>
        ))}

        <Text style={styles.inputLabel}>Category</Text>
        <View style={styles.chipsWrap}>
          {categoryOptions.map((category) => {
            const selected = form.category === category;
            return (
              <Pressable
                key={category}
                style={[styles.categoryChip, selected && styles.categoryChipSelected]}
                onPress={() => setForm((prev) => ({ ...prev, category }))}
              >
                <Text style={[styles.categoryChipLabel, selected && styles.categoryChipLabelSelected]}>
                  {category}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <UnitDropdown value={form.unit} onChange={(unit) => setForm((prev) => ({ ...prev, unit }))} />

        <Text style={styles.inputLabel}>{form.unit === 'pack' ? 'Full packs remaining' : 'Quantity'}</Text>
        <TextInput
          value={form.quantity}
          onChangeText={(quantity) => setForm((prev) => ({ ...prev, quantity }))}
          keyboardType="numeric"
          style={styles.input}
        />

        {form.unit === 'pack' ? (
          <>
            <Text style={styles.inputLabel}>Pieces per full pack</Text>
            <TextInput value={form.piecesPerPack}
              onChangeText={(piecesPerPack) => setForm((prev) => ({ ...prev, piecesPerPack }))}
              keyboardType="number-pad" style={styles.input} />
            <Text style={styles.inputLabel}>Loose pieces remaining</Text>
            <TextInput value={form.loosePieces}
              onChangeText={(loosePieces) => setForm((prev) => ({ ...prev, loosePieces }))}
              keyboardType="number-pad" style={styles.input} />
          </>
        ) : null}

        <Text style={styles.inputLabel}>Restock target{form.unit === 'pack' ? ' in pieces' : ''} (optional)</Text>
        <TextInput
          value={form.minThreshold}
          onChangeText={(text) => setForm((prev) => ({ ...prev, minThreshold: text }))}
          keyboardType="numeric"
          accessibilityLabel="Restock target (optional)"
          placeholder="Suggested amount to buy"
          style={styles.input}
        />

        {formVisible ? (
          <ExpirationDateField
            value={form.expirationDate}
            onChange={(expirationDate) => setForm((prev) => ({ ...prev, expirationDate }))}
          />
        ) : null}
        {form.category === 'Frozen goods' && /\bfish\b/i.test(form.name) ? (
          <Pressable
            accessibilityRole="button"
            style={styles.catalogOption}
            onPress={() => setForm((prev) => ({ ...prev, expirationDate: frozenFishReminderDate() }))}
          >
            <Text style={styles.inputLabel}>Set a 14-day frozen fish reminder</Text>
          </Pressable>
        ) : null}

        <View style={styles.modalActions}>
          <Pressable style={styles.cancelButton} onPress={() => setFormVisible(false)}>
            <Text style={styles.cancelButtonLabel}>Cancel</Text>
          </Pressable>
          <Pressable
            style={[styles.saveButton, submitting && styles.saveButtonDisabled]}
            onPress={handleSubmitForm}
            disabled={submitting}
          >
            <Text style={styles.saveButtonLabel}>{submitting ? 'Saving...' : 'Save'}</Text>
          </Pressable>
        </View>
      </FormModal>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 760,
    padding: spacing.md,
  },
  listContent: { paddingBottom: spacing.xs },
  categorySpacing: { marginBottom: spacing.sm },
  searchInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
    backgroundColor: colors.input,
  },
  addButton: {
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    paddingVertical: 10,
    marginBottom: spacing.sm,
  },
  addButtonLabel: {
    ...typography.body,
    color: '#FFFFFF',
    fontWeight: '700',
  },
  infoText: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  productRow: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: spacing.sm,
    gap: spacing.sm,
    backgroundColor: colors.input,
  },
  productName: {
    ...typography.body,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  productMeta: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  categoryMeta: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  lowText: {
    color: colors.warning,
  },
  adjustWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    alignItems: 'center',
  },
  minusButton: {
    minWidth: 44,
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: colors.surfaceAlt,
    justifyContent: 'center',
    alignItems: 'center',
  },
  plusButton: {
    minWidth: 44,
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  disabled: { opacity: 0.45 },
  minusLabel: {
    fontSize: 24,
    lineHeight: 26,
    color: colors.primaryDark,
  },
  plusLabel: {
    fontSize: 22,
    lineHeight: 24,
    color: '#FFFFFF',
  },
  actionButton: {
    minHeight: 44,
    maxWidth: '100%',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: colors.surfaceAlt,
  },
  actionButtonLabel: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  archiveButton: {
    minHeight: 44,
    maxWidth: '100%',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: colors.dangerSurface,
  },
  archiveButtonLabel: {
    ...typography.caption,
    color: colors.danger,
    fontWeight: '700',
  },
  catalogOption: { paddingVertical: spacing.sm },
  modalTitle: {
    ...typography.heading,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  inputLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
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
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  categoryChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.surfaceAlt,
  },
  categoryChipSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.surfaceAlt,
  },
  categoryChipLabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  categoryChipLabelSelected: {
    color: colors.primaryDark,
    fontWeight: '700',
  },
  modalActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  cancelButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: colors.input,
  },
  cancelButtonLabel: {
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
  saveButtonDisabled: {
    backgroundColor: colors.textSecondary,
  },
  saveButtonLabel: {
    ...typography.caption,
    color: '#FFFFFF',
    fontWeight: '700',
  },
});
