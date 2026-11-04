'use strict';

// Sort key for "by name": an import keeps the name it arrived with; a generated id loses its leading run timestamp.
function libraryImageName(id, originalName) {
  return String(typeof originalName === 'string' && originalName ? originalName : id).replace(/^\d{8}-\d{6}-/, '').toLowerCase();
}

// Canonical ids start with the run timestamp, so id order is creation order. Sorts in place.
function sortLibraryIds(ids, sort, originalNameOf) {
  if (sort === 'name-asc' || sort === 'name-desc') {
    const names = new Map(ids.map(id => [id, libraryImageName(id, originalNameOf(id))]));
    ids.sort((a, b) => names.get(a).localeCompare(names.get(b), undefined, { numeric: true }) || b.localeCompare(a));
    if (sort === 'name-desc') ids.reverse();
  } else {
    ids.sort((a, b) => b.localeCompare(a));
    if (sort === 'asc') ids.reverse();
  }
  return ids;
}

module.exports = { libraryImageName, sortLibraryIds };
