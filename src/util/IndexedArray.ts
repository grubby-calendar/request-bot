export class IndexedArray<T> {
  // The dataset
  array: T[] = [];

  // An index of the key to the position in the array
  index: {[key: string|number]: number} = {};

  // Function to determine the key for an item
  indexer: ((item: T) => string|number);

  constructor(indexer: ((item: T) => string|number)) {
    this.indexer = indexer;
  }

  all(): T[] {
    return this.array;
  }

  size(): number {
    return this.array.length
  }

  notEmpty(): boolean {
    return this.array.length > 0
  }

  push(item: T) {
    // Update the index first with the arr position
    // The length is always +1 from the last item's index
    // So if we do it first we avoid needing to -1
    this.index[this.indexer(item)] = this.array.length

    // Push the item at the end
    this.array.push(item);
  }

  delete(key: string) {
    const index = this.index[key];
    if (index === undefined) {
      return;
    }

    // Remove the item
    // May be slow-ish for items near the start
    this.array.splice(index, 1);

    // Since this item is gone, we no longer need the index
    delete(this.index[key]);

    // Update the index for all the items following the removed one
    // May be slow-ish for items near the start
    for (let i = index; i < this.array.length; i++) {
      this.index[this.indexer(this.array[i])]--;
    }
  }

  // Finds an item using the index, fast lookup
  find(key: string): T|null {
    const index = this.index[key];
    if (index === undefined) {
      return null;
    }
    return this.array[index] ?? null;
  }

  // Assumes the ID of the item didn't change
  // Overwrites the whole item stored at the same index
  update(key: string, item: T) {
    const index = this.index[key];
    if (index === undefined) {
      return;
    }
    this.array[index] = item;
  }

  // Replaces all the contents with the new items list
  massUpdate(items: T[]) {
    this.array = [];
    this.index = {};
    for (const item of items) {
      this.push(item);
    }
  }
}
