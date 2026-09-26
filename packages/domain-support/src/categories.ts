/**
 * Category operations over the injected store (pure).
 */
import type { SupportCategory } from "./types";
import type { SaveCategoryInput, SupportStore } from "./store";

/** List the categories of the owner the store is bound to. */
export async function listCategories(store: SupportStore): Promise<SupportCategory[]> {
  return store.listCategories();
}

/** Create (no id) or update (id present) a category. */
export async function saveCategory(
  store: SupportStore,
  input: SaveCategoryInput,
): Promise<SupportCategory> {
  return store.saveCategory(input);
}

/** Delete a category by id. */
export async function deleteCategory(store: SupportStore, categoryId: string): Promise<void> {
  return store.deleteCategory(categoryId);
}
